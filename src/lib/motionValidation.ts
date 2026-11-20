import {
  detectMotionSignature,
  inspectAnimatedImageBytes,
  MOTION_DURATION_EPSILON,
  MOTION_MAX_BYTES,
  MOTION_MAX_DURATION_SECONDS,
} from '../../shared/motionMedia';

export interface MotionInspectionResult {
  file: File;
  format: 'mp4' | 'webm' | 'gif' | 'webp' | 'apng';
  isVideo: boolean;
  isAnimated: boolean;
  width: number;
  height: number;
  durationSeconds: number;
  sizeBytes: number;
}

export function formatMotionSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
}

function readVideoMetadataInMemory(file: File): Promise<{
  durationSeconds: number;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
    };

    video.onloadedmetadata = () => {
      const durationSeconds = Number(video.duration);
      const width = video.videoWidth;
      const height = video.videoHeight;
      cleanup();
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || width <= 0 || height <= 0) {
        reject(new Error('Não foi possível ler a duração ou as dimensões deste vídeo no navegador.'));
        return;
      }
      resolve({ durationSeconds, width, height });
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('O navegador não conseguiu decodificar os metadados deste arquivo de vídeo.'));
    };

    video.src = objectUrl;
  });
}

export function getImageDimensionsInBrowser(
  source: File | string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const isFile = typeof source !== 'string';
    const srcUrl = isFile ? URL.createObjectURL(source) : source;
    const img = new Image();

    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
      if (isFile) {
        URL.revokeObjectURL(srcUrl);
      }
    };

    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      cleanup();
      if (width <= 0 || height <= 0) {
        reject(new Error('Não foi possível identificar as dimensões da imagem original.'));
        return;
      }
      resolve({ width, height });
    };

    img.onerror = () => {
      cleanup();
      reject(new Error('Falha ao carregar a imagem original para leitura de dimensões.'));
    };

    img.src = srcUrl;
  });
}

async function materializeMotionFileInMemory(file: File): Promise<File> {
  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength <= 0) {
      throw new Error('O arquivo Motion selecionado está vazio.');
    }
    return new File([buffer], file.name, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('vazio')) {
      throw err;
    }
    throw new Error(
      `Não foi possível ler o arquivo "${file.name}". Se o navegador foi minimizado, selecione o arquivo novamente.`
    );
  }
}

export async function inspectMotionFileInBrowser(file: File): Promise<MotionInspectionResult> {
  if (!file || file.size <= 0) {
    throw new Error('O arquivo Motion selecionado está vazio.');
  }

  if (file.size > MOTION_MAX_BYTES) {
    throw new Error(
      `O arquivo "${file.name}" (${formatMotionSize(file.size)}) ultrapassa o limite máximo de 20 MB.`
    );
  }

  // Snapshot bytes in memory (<= 20 MB) so mobile browsers revoking file URIs after minimizing do not break later upload
  const safeFile = await materializeMotionFileInMemory(file);
  const fullBytes = new Uint8Array(await safeFile.arrayBuffer());
  const detectedHead = detectMotionSignature(fullBytes.subarray(0, 64));

  if (detectedHead === 'mp4' || detectedHead === 'webm') {
    const meta = await readVideoMetadataInMemory(safeFile);
    if (meta.durationSeconds > MOTION_MAX_DURATION_SECONDS + MOTION_DURATION_EPSILON) {
      throw new Error(
        `O vídeo "${safeFile.name}" tem ${meta.durationSeconds.toFixed(1).replace('.', ',')}s e ultrapassa o limite máximo de ${MOTION_MAX_DURATION_SECONDS} segundos.`
      );
    }

    return {
      file: safeFile,
      format: detectedHead,
      isVideo: true,
      isAnimated: true,
      width: meta.width,
      height: meta.height,
      durationSeconds: meta.durationSeconds,
      sizeBytes: safeFile.size,
    };
  }

  const detected = detectMotionSignature(fullBytes);

  if (detected === 'mp4' || detected === 'webm') {
    const meta = await readVideoMetadataInMemory(safeFile);
    if (meta.durationSeconds > MOTION_MAX_DURATION_SECONDS + MOTION_DURATION_EPSILON) {
      throw new Error(
        `O vídeo "${safeFile.name}" tem ${meta.durationSeconds.toFixed(1).replace('.', ',')}s e ultrapassa o limite máximo de ${MOTION_MAX_DURATION_SECONDS} segundos.`
      );
    }
    return {
      file: safeFile,
      format: detected,
      isVideo: true,
      isAnimated: true,
      width: meta.width,
      height: meta.height,
      durationSeconds: meta.durationSeconds,
      sizeBytes: safeFile.size,
    };
  }

  if (detected === 'gif' || detected === 'webp' || detected === 'apng') {
    const imgInfo = inspectAnimatedImageBytes(fullBytes);
    if (!imgInfo || imgInfo.width <= 0 || imgInfo.height <= 0) {
      throw new Error(
        `Não foi possível ler as dimensões do arquivo "${safeFile.name}".`
      );
    }

    // Do NOT apply the 10-second video limit to static files; enforce only when genuinely animated
    if (
      imgInfo.isAnimated &&
      imgInfo.durationSeconds > MOTION_MAX_DURATION_SECONDS + MOTION_DURATION_EPSILON
    ) {
      throw new Error(
        `A animação ${detected.toUpperCase()} "${safeFile.name}" tem ${imgInfo.durationSeconds
          .toFixed(1)
          .replace('.', ',')}s e ultrapassa o limite máximo de ${MOTION_MAX_DURATION_SECONDS} segundos.`
      );
    }

    return {
      file: safeFile,
      format: detected,
      isVideo: false,
      isAnimated: imgInfo.isAnimated,
      width: imgInfo.width,
      height: imgInfo.height,
      durationSeconds: imgInfo.durationSeconds,
      sizeBytes: safeFile.size,
    };
  }

  throw new Error(
    `Formato inválido para "${safeFile.name}". Envie MP4, WebM, GIF, WebP ou APNG (máx. 10s e 20 MB).`
  );
}
