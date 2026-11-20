import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type StorageDriver = 's3' | 'local';
export type RuntimePlatform = 'vercel' | 'aistudio' | 'node';

export interface FirebaseAppletConfig {
  apiKey?: string;
  projectId?: string;
  appId?: string;
  authDomain?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
}

export interface StorageConfig {
  requestedDriver: string;
  driver: StorageDriver;
  configured: boolean;
  endpoint: string;
  endpointHost: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  endpointConfigured: boolean;
  bucketConfigured: boolean;
  accessKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  publicUrlConfigured: boolean;
  proxyMode: boolean;
  localUploadDir: string;
  missingVars: string[];
  errors: string[];
  warnings: string[];
}

export interface GeminiConfig {
  configured: boolean;
  usedByBackendRoutes: boolean;
}

export interface FirebaseConfigSummary {
  configured: boolean;
  projectId: string | null;
  databaseId: string;
  authDomain: string | null;
  apiKeyConfigured: boolean;
  errors: string[];
}

export interface RuntimeConfig {
  nodeEnv: string;
  isProduction: boolean;
  isVercel: boolean;
  vercelEnv: string | null;
  platform: RuntimePlatform;
  port: number;
  appUrlConfigured: boolean;
  disableHmr: boolean;
}

export interface ResolvedAppConfig {
  runtime: RuntimeConfig;
  storage: StorageConfig;
  gemini: GeminiConfig;
  firebase: FirebaseConfigSummary;
  firebaseRaw: FirebaseAppletConfig;
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface SafeConfigReport {
  ok: boolean;
  platform: RuntimePlatform;
  nodeEnv: string;
  isVercel: boolean;
  vercelEnv: string | null;
  storage: {
    requestedDriver: string;
    driver: StorageDriver;
    configured: boolean;
    proxyMode: boolean;
    endpointConfigured: boolean;
    endpointHost: string | null;
    region: string;
    bucketConfigured: boolean;
    bucketName: string | null;
    accessKeyConfigured: boolean;
    secretKeyConfigured: boolean;
    publicUrlConfigured: boolean;
    localUploadDir: string;
    missingVars: string[];
    errors: string[];
    warnings: string[];
  };
  firebase: FirebaseConfigSummary;
  gemini: GeminiConfig;
  errors: string[];
  warnings: string[];
}

const PLACEHOLDER_VALUES = new Set([
  'MY_GEMINI_API_KEY',
  'MY_APP_URL',
  'CHANGEME',
  'YOUR_API_KEY',
]);

function cleanEnvValue(raw: string | undefined): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER_VALUES.has(trimmed)) {
    return '';
  }
  return trimmed;
}

function validateHttpUrl(raw: string): { valid: boolean; url?: URL; error?: string } {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'deve usar protocolo http:// ou https://' };
    }
    if (!parsed.hostname) {
      return { valid: false, error: 'hostname ausente' };
    }
    return { valid: true, url: parsed };
  } catch {
    return { valid: false, error: 'URL inválida' };
  }
}

export function resolveFirebaseConfigPath(): string | null {
  const candidates: string[] = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
  ];

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(currentDir, '..', 'firebase-applet-config.json'));
    candidates.push(path.resolve(currentDir, '..', '..', 'firebase-applet-config.json'));
  } catch {
    // Fallback cleanly if import.meta.url is unavailable
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  const configPath = resolveFirebaseConfigPath();
  if (!configPath) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FirebaseAppletConfig;
  } catch {
    return {};
  }
}

export function getAppConfig(
  env: NodeJS.ProcessEnv = process.env,
  firebaseOverride?: FirebaseAppletConfig
): ResolvedAppConfig {
  const nodeEnv = cleanEnvValue(env.NODE_ENV) || 'development';
  const isVercel = cleanEnvValue(env.VERCEL) === '1' || Boolean(cleanEnvValue(env.VERCEL_ENV));
  const vercelEnv = cleanEnvValue(env.VERCEL_ENV) || null;
  const appUrlRaw = cleanEnvValue(env.APP_URL);
  const disableHmr = cleanEnvValue(env.DISABLE_HMR) === 'true';
  const parsedPort = Number(cleanEnvValue(env.PORT));
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? Math.round(parsedPort) : 3000;

  const platform: RuntimePlatform = isVercel
    ? 'vercel'
    : appUrlRaw || cleanEnvValue(env.DISABLE_HMR) !== ''
      ? 'aistudio'
      : 'node';

  const runtime: RuntimeConfig = {
    nodeEnv,
    isProduction: nodeEnv === 'production' || vercelEnv === 'production',
    isVercel,
    vercelEnv,
    platform,
    port,
    appUrlConfigured: Boolean(appUrlRaw),
    disableHmr,
  };

  // --- Storage / Bunny S3 configuration ---
  const rawDriver = cleanEnvValue(env.STORAGE_DRIVER).toLowerCase();
  const requestedDriver = rawDriver || 'local';
  const rawEndpoint = cleanEnvValue(env.S3_ENDPOINT).replace(/\/+$/, '');
  const region = cleanEnvValue(env.S3_REGION) || 'us-east-1';
  const bucket = cleanEnvValue(env.S3_BUCKET);
  const accessKeyId = cleanEnvValue(env.S3_ACCESS_KEY_ID);
  const secretAccessKey = cleanEnvValue(env.S3_SECRET_ACCESS_KEY);
  const rawPublicUrl = cleanEnvValue(env.S3_PUBLIC_URL).replace(/\/+$/, '');

  const storageErrors: string[] = [];
  const storageWarnings: string[] = [];
  const missingVars: string[] = [];

  let driver: StorageDriver = 'local';
  if (requestedDriver !== 'local' && requestedDriver !== 's3') {
    storageErrors.push(
      `STORAGE_DRIVER inválido ("${requestedDriver}"). Valores aceitos: "s3" ou "local".`
    );
  } else {
    driver = requestedDriver;
  }

  let endpointHost: string | null = null;
  if (rawEndpoint) {
    const check = validateHttpUrl(rawEndpoint);
    if (!check.valid || !check.url) {
      storageErrors.push(`S3_ENDPOINT inválido (${check.error}). Exemplo Bunny S3: https://br-s3.storage.bunnycdn.com`);
    } else {
      endpointHost = check.url.hostname;
      if (
        check.url.hostname === 'storage.bunnycdn.com' ||
        (check.url.hostname.endsWith('.storage.bunnycdn.com') && !check.url.hostname.includes('-s3.storage.bunnycdn.com'))
      ) {
        storageErrors.push(
          'S3_ENDPOINT aponta para a API nativa do Bunny ("storage.bunnycdn.com"), mas o backend utiliza o protocolo S3 compatível. Use o endpoint S3 da região (ex.: https://br-s3.storage.bunnycdn.com ou https://de-s3.storage.bunnycdn.com).'
        );
      }
      if (check.url.pathname && check.url.pathname !== '/') {
        storageWarnings.push(
          'S3_ENDPOINT contém caminho extra além do domínio. Informe apenas a origem (ex.: https://br-s3.storage.bunnycdn.com) e defina o nome da Storage Zone em S3_BUCKET.'
        );
      }
    }
  }

  if (rawPublicUrl) {
    const checkPub = validateHttpUrl(rawPublicUrl);
    if (!checkPub.valid) {
      storageWarnings.push(`S3_PUBLIC_URL informado parece inválido (${checkPub.error}), mas não é obrigatório porque o app serve mídia via /api/media/file/*.`);
    }
  }

  if (driver === 's3') {
    if (!bucket) missingVars.push('S3_BUCKET');
    if (!accessKeyId) missingVars.push('S3_ACCESS_KEY_ID');
    if (!secretAccessKey) missingVars.push('S3_SECRET_ACCESS_KEY');

    if (missingVars.length > 0) {
      storageErrors.push(
        `STORAGE_DRIVER=s3 requer as variáveis obrigatórias ausentes: ${missingVars.join(', ')}.`
      );
    }

    if (!rawEndpoint) {
      storageWarnings.push(
        'S3_ENDPOINT não está definido. Para Bunny Storage (ou R2/B2), S3_ENDPOINT é obrigatório (ex.: https://br-s3.storage.bunnycdn.com).'
      );
    }
  } else if (isVercel) {
    storageErrors.push(
      'Ambiente Vercel detectado com STORAGE_DRIVER=local. O sistema de arquivos do Vercel é somente leitura e efêmero; defina STORAGE_DRIVER=s3 e configure S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY.'
    );
  }

  const storageConfigured =
    storageErrors.length === 0 &&
    (driver === 'local'
      ? !isVercel
      : Boolean(bucket && accessKeyId && secretAccessKey));

  const storage: StorageConfig = {
    requestedDriver,
    driver,
    configured: storageConfigured,
    endpoint: rawEndpoint,
    endpointHost,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicUrl: rawPublicUrl,
    endpointConfigured: Boolean(rawEndpoint),
    bucketConfigured: Boolean(bucket),
    accessKeyConfigured: Boolean(accessKeyId),
    secretKeyConfigured: Boolean(secretAccessKey),
    publicUrlConfigured: Boolean(rawPublicUrl),
    proxyMode: true,
    localUploadDir: 'storage/media',
    missingVars,
    errors: storageErrors,
    warnings: storageWarnings,
  };

  // --- Firebase configuration ---
  const firebaseRaw = firebaseOverride ?? loadFirebaseAppletConfig();
  const firebaseErrors: string[] = [];
  if (!cleanEnvValue(firebaseRaw.projectId)) {
    firebaseErrors.push('firebase-applet-config.json sem projectId.');
  }
  if (!cleanEnvValue(firebaseRaw.apiKey)) {
    firebaseErrors.push('firebase-applet-config.json sem apiKey.');
  }

  const firebase: FirebaseConfigSummary = {
    configured: firebaseErrors.length === 0,
    projectId: cleanEnvValue(firebaseRaw.projectId) || null,
    databaseId: cleanEnvValue(firebaseRaw.firestoreDatabaseId) || '(default)',
    authDomain: cleanEnvValue(firebaseRaw.authDomain) || null,
    apiKeyConfigured: Boolean(cleanEnvValue(firebaseRaw.apiKey)),
    errors: firebaseErrors,
  };

  // --- Gemini configuration (optional, currently unused by backend routes) ---
  const geminiKey = cleanEnvValue(env.GEMINI_API_KEY);
  const gemini: GeminiConfig = {
    configured: Boolean(geminiKey),
    usedByBackendRoutes: false,
  };

  const errors = [...storage.errors, ...firebase.errors];
  const warnings = [...storage.warnings];

  return {
    runtime,
    storage,
    gemini,
    firebase,
    firebaseRaw,
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function getS3CredentialsFingerprint(storage: StorageConfig): string {
  return crypto
    .createHash('sha256')
    .update(
      `${storage.endpoint}|${storage.region}|${storage.bucket}|${storage.accessKeyId}|${storage.secretAccessKey}`
    )
    .digest('hex');
}

export function getSafeConfigReport(
  env: NodeJS.ProcessEnv = process.env,
  firebaseOverride?: FirebaseAppletConfig
): SafeConfigReport {
  const cfg = getAppConfig(env, firebaseOverride);
  return {
    ok: cfg.ok,
    platform: cfg.runtime.platform,
    nodeEnv: cfg.runtime.nodeEnv,
    isVercel: cfg.runtime.isVercel,
    vercelEnv: cfg.runtime.vercelEnv,
    storage: {
      requestedDriver: cfg.storage.requestedDriver,
      driver: cfg.storage.driver,
      configured: cfg.storage.configured,
      proxyMode: cfg.storage.proxyMode,
      endpointConfigured: cfg.storage.endpointConfigured,
      endpointHost: cfg.storage.endpointHost,
      region: cfg.storage.region,
      bucketConfigured: cfg.storage.bucketConfigured,
      bucketName: cfg.storage.bucket || null,
      accessKeyConfigured: cfg.storage.accessKeyConfigured,
      secretKeyConfigured: cfg.storage.secretKeyConfigured,
      publicUrlConfigured: cfg.storage.publicUrlConfigured,
      localUploadDir: cfg.storage.localUploadDir,
      missingVars: cfg.storage.missingVars,
      errors: cfg.storage.errors,
      warnings: cfg.storage.warnings,
    },
    firebase: cfg.firebase,
    gemini: cfg.gemini,
    errors: cfg.errors,
    warnings: cfg.warnings,
  };
}

export function formatStartupConfigSummary(report: SafeConfigReport): string {
  const lines: string[] = [
    `[config] Plataforma: ${report.platform} (NODE_ENV=${report.nodeEnv}${report.vercelEnv ? `, VERCEL_ENV=${report.vercelEnv}` : ''})`,
    `[config] Firebase: ${report.firebase.configured ? `OK (projeto=${report.firebase.projectId}, banco=${report.firebase.databaseId})` : `ERRO (${report.firebase.errors.join('; ')})`}`,
    `[config] Storage: driver=${report.storage.driver} (solicitado=${report.storage.requestedDriver}), configurado=${report.storage.configured ? 'sim' : 'não'}, proxy=/api/media/file/*${report.storage.endpointHost ? `, endpoint=${report.storage.endpointHost}` : ''}${report.storage.bucketName ? `, bucket=${report.storage.bucketName}` : ''}, pullZone=${report.storage.publicUrlConfigured ? 'configurada (opcional)' : 'não configurada (opcional)'}`,
  ];

  for (const warn of report.warnings) {
    lines.push(`[config][aviso] ${warn}`);
  }
  for (const err of report.errors) {
    lines.push(`[config][erro] ${err}`);
  }
  return lines.join('\n');
}
