import type { MotionAlignment } from '../../shared/motionMedia';
import { auth } from './firebase';

export interface UploadedMediaResult {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  driver: 's3' | 'local';
  motion?: {
    durationSeconds: number;
    isAnimated: boolean;
    sourceWidth: number;
    sourceHeight: number;
    outputWidth: number;
    outputHeight: number;
    cropped: boolean;
    alignment: MotionAlignment;
  };
}

export interface StorageStatusResponse {
  driver: 's3' | 'local';
  requestedDriver?: string;
  configured?: boolean;
  bucketConfigured: boolean;
  publicUrlConfigured: boolean;
  endpointConfigured: boolean;
  endpointHost?: string | null;
  proxyMode?: boolean;
  localUploadDir: string;
  missingVars?: string[];
  errors?: string[];
  warnings?: string[];
  platform?: 'vercel' | 'aistudio' | 'node';
  isVercel?: boolean;
  firebaseConfigured: boolean;
  firebaseProjectId: string | null;
  firebaseDatabaseId?: string;
  geminiConfigured?: boolean;
}

export async function fetchStorageStatus(): Promise<StorageStatusResponse> {
  const res = await fetch('/api/storage/status');
  if (!res.ok) {
    throw new Error('Não foi possível consultar o status de armazenamento.');
  }
  return (await res.json()) as StorageStatusResponse;
}

let needsTokenRefreshOnNextUpload = false;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      needsTokenRefreshOnNextUpload = true;
    }
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureMediaServerAwake(): Promise<{ sessionExpiredHtml: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && contentType.includes('application/json')) {
        return { sessionExpiredHtml: false };
      }
      if (contentType.includes('text/html') && (res.status === 200 || res.status === 401 || res.status === 403)) {
        return { sessionExpiredHtml: true };
      }
    } catch {
      // Transient network wake-up error; retry briefly
    }
    if (attempt === 0) {
      await waitMs(450);
    }
  }
  return { sessionExpiredHtml: false };
}

class MediaUploadAttemptError extends Error {
  public readonly retryable: boolean;
  public readonly status: number;

  constructor(message: string, options: { retryable: boolean; status: number }) {
    super(message);
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

function buildUploadFormData(params: {
  file: File;
  kind: 'cover' | 'banner' | 'avatar' | 'original' | 'motion' | 'receipt';
  mangaId?: string;
  chapterId?: string;
  motionOptions?: {
    alignment?: MotionAlignment;
    originalUrl?: string;
    targetWidth?: number;
    targetHeight?: number;
  };
}): FormData {
  const formData = new FormData();
  formData.append('kind', params.kind);
  if (params.mangaId) formData.append('mangaId', params.mangaId);
  if (params.chapterId) formData.append('chapterId', params.chapterId);
  if (params.kind === 'motion' && params.motionOptions) {
    if (params.motionOptions.alignment) {
      formData.append('alignment', params.motionOptions.alignment);
    }
    if (params.motionOptions.originalUrl) {
      formData.append('originalUrl', params.motionOptions.originalUrl);
    }
    if (params.motionOptions.targetWidth && params.motionOptions.targetWidth > 0) {
      formData.append('targetWidth', String(Math.round(params.motionOptions.targetWidth)));
    }
    if (params.motionOptions.targetHeight && params.motionOptions.targetHeight > 0) {
      formData.append('targetHeight', String(Math.round(params.motionOptions.targetHeight)));
    }
  }
  formData.append('file', params.file);
  return formData;
}

function sendUploadRequest(params: {
  token: string;
  formData: FormData;
  onProgress?: (percent: number) => void;
}): Promise<UploadedMediaResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload');
    xhr.timeout = 120_000;
    xhr.setRequestHeader('Authorization', `Bearer ${params.token}`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && params.onProgress) {
        params.onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      const rawText = xhr.responseText || '';
      const contentType = (xhr.getResponseHeader('content-type') || '').toLowerCase();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(rawText || '{}') as Record<string, unknown>;
      } catch {
        parsed = null;
      }

      if (parsed && xhr.status >= 200 && xhr.status < 300) {
        const result = parsed as unknown as UploadedMediaResult;
        if (!result.url || !result.url.startsWith('/api/media/file/')) {
          reject(
            new MediaUploadAttemptError(
              'URL de mídia retornada pelo servidor não está no formato esperado.',
              { retryable: false, status: xhr.status }
            )
          );
          return;
        }
        resolve(result);
        return;
      }

      if (parsed && typeof parsed.error === 'string' && parsed.error.trim().length > 0) {
        const isTransientStatus = [408, 429, 502, 503, 504].includes(xhr.status);
        reject(
          new MediaUploadAttemptError(parsed.error, {
            retryable: isTransientStatus || xhr.status === 401,
            status: xhr.status,
          })
        );
        return;
      }

      const isHtml = contentType.includes('text/html') || /^\s*</.test(rawText);
      if (isHtml && (xhr.status === 200 || xhr.status === 401 || xhr.status === 403)) {
        reject(
          new MediaUploadAttemptError(
            'A sessão da página expirou após minimizar o navegador. Recarregue a página e tente novamente.',
            { retryable: false, status: xhr.status }
          )
        );
        return;
      }

      if (xhr.status === 413) {
        reject(
          new MediaUploadAttemptError('O arquivo excede o tamanho máximo aceito pelo servidor.', {
            retryable: false,
            status: 413,
          })
        );
        return;
      }

      const transientGateway = xhr.status === 0 || [408, 429, 502, 503, 504].includes(xhr.status);
      reject(
        new MediaUploadAttemptError(
          xhr.status
            ? `O servidor de mídia retornou uma resposta inesperada (HTTP ${xhr.status}). Tente novamente.`
            : 'Falha de comunicação com o servidor de mídia. Tente novamente.',
          { retryable: transientGateway || !parsed, status: xhr.status }
        )
      );
    };

    xhr.onerror = () => {
      reject(
        new MediaUploadAttemptError(
          'Falha de rede durante o upload do arquivo. Verifique sua conexão e tente novamente.',
          { retryable: true, status: 0 }
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new MediaUploadAttemptError(
          'O servidor demorou muito para responder ao processamento do arquivo. Tente novamente.',
          { retryable: true, status: 504 }
        )
      );
    };

    xhr.send(params.formData);
  });
}

export async function uploadMediaAsset(params: {
  file: File;
  kind: 'cover' | 'banner' | 'avatar' | 'original' | 'motion' | 'receipt';
  mangaId?: string;
  chapterId?: string;
  motionOptions?: {
    alignment?: MotionAlignment;
    originalUrl?: string;
    targetWidth?: number;
    targetHeight?: number;
  };
  onProgress?: (percent: number) => void;
}): Promise<UploadedMediaResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Faça login para enviar arquivos.');
  }

  // Re-verify file readability before contacting backend (catches invalidated OS handles on mobile resume)
  if (params.file.size <= 0) {
    throw new Error('O arquivo selecionado está vazio ou não está mais acessível.');
  }

  const health = await ensureMediaServerAwake();
  if (health.sessionExpiredHtml) {
    throw new Error(
      'A sessão da página expirou enquanto o navegador estava minimizado. Recarregue a página e tente novamente.'
    );
  }

  let forceTokenRefresh = needsTokenRefreshOnNextUpload;
  needsTokenRefreshOnNextUpload = false;

  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const token = await user.getIdToken(forceTokenRefresh);
      forceTokenRefresh = false;
      const formData = buildUploadFormData(params);
      return await sendUploadRequest({
        token,
        formData,
        onProgress: params.onProgress,
      });
    } catch (err) {
      lastError = err;
      const attemptErr = err instanceof MediaUploadAttemptError ? err : null;
      const canRetry = attempt < maxAttempts - 1 && (attemptErr ? attemptErr.retryable : false);
      if (!canRetry) {
        throw err instanceof Error ? err : new Error('Erro no envio do arquivo.');
      }
      if (attemptErr?.status === 401) {
        forceTokenRefresh = true;
      }
      if (params.onProgress) {
        params.onProgress(0);
      }
      await waitMs(700 * (attempt + 1));
      await ensureMediaServerAwake();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Erro no envio do arquivo.');
}

export async function deleteMediaAsset(urlOrKey: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || !urlOrKey || !urlOrKey.includes('/api/media/file/')) return;
  const token = await user.getIdToken();
  const res = await fetch('/api/media/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ key: urlOrKey }),
  });
  if (!res.ok) {
    let msg = 'Erro ao remover arquivo do armazenamento.';
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      // Ignore JSON parse error
    }
    throw new Error(msg);
  }
}
