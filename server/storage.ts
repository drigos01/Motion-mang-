import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export type StorageDriver = 's3' | 'local';

export interface StorageConfigStatus {
  driver: StorageDriver;
  bucketConfigured: boolean;
  publicUrlConfigured: boolean;
  endpointConfigured: boolean;
  proxyMode: boolean;
  localUploadDir: string;
}

const LOCAL_MEDIA_ROOT = path.resolve(process.cwd(), 'storage', 'media');

function ensureLocalDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getStorageConfigStatus(): StorageConfigStatus {
  const hasS3Creds = Boolean(
    process.env.STORAGE_DRIVER === 's3' &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );

  return {
    driver: hasS3Creds ? 's3' : 'local',
    bucketConfigured: Boolean(process.env.S3_BUCKET),
    publicUrlConfigured: Boolean(process.env.S3_PUBLIC_URL),
    endpointConfigured: Boolean(process.env.S3_ENDPOINT),
    proxyMode: true,
    localUploadDir: 'storage/media',
  };
}

function getS3Client(): S3Client | null {
  const status = getStorageConfigStatus();
  if (status.driver !== 's3') return null;

  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
}

export function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(0, 80) || 'item';
}

export function normalizeMediaKey(input: string): string | null {
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    // Keep raw string if malformed URI sequences are passed
  }
  const cleanKey = decoded
    .replace(/^\/api\/media\/file\//, '')
    .replace(/^\/+/, '');
  if (!cleanKey || cleanKey.includes('..') || cleanKey.includes('\\') || cleanKey.includes('\0')) {
    return null;
  }
  return cleanKey;
}

function isS3NotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.$metadata?.httpStatusCode === 404 ||
    e.name === 'NoSuchKey' ||
    e.name === 'NotFound' ||
    e.Code === 'NoSuchKey'
  );
}

function isS3InvalidRangeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.$metadata?.httpStatusCode === 416 ||
    e.name === 'InvalidRange' ||
    e.Code === 'InvalidRange'
  );
}

function toNodeReadable(body: unknown): Readable | null {
  if (!body) return null;
  if (body instanceof Readable) return body;
  if (typeof (body as { transformToWebStream?: () => unknown }).transformToWebStream === 'function') {
    const webStream = (body as { transformToWebStream: () => NodeWebReadableStream }).transformToWebStream();
    return Readable.fromWeb(webStream);
  }
  if (typeof (body as { getReader?: unknown }).getReader === 'function') {
    return Readable.fromWeb(body as NodeWebReadableStream);
  }
  if (typeof (body as { pipe?: unknown }).pipe === 'function') {
    return body as Readable;
  }
  return null;
}

export interface StoredFileResult {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  driver: StorageDriver;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyS3ObjectAfterPut(params: {
  sendHead: () => Promise<{ ContentLength?: number }>;
  expectedSize: number;
  key: string;
  retryDelaysMs?: number[];
}): Promise<void> {
  const delays = params.retryDelaysMs ?? [150, 350, 700];
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const head = await params.sendHead();
      if (
        typeof head.ContentLength === 'number' &&
        params.expectedSize > 0 &&
        head.ContentLength !== params.expectedSize
      ) {
        throw new Error(
          `Falha na verificação do arquivo no armazenamento (esperado ${params.expectedSize} bytes, armazenado ${head.ContentLength} bytes).`
        );
      }
      return;
    } catch (err) {
      if (!isS3NotFoundError(err)) {
        throw err;
      }
      lastErr = err;
      if (attempt < delays.length) {
        await sleep(delays[attempt]);
      }
    }
  }

  console.warn(
    `[storage] HeadObject retornou NotFound após PutObject bem-sucedido para "${params.key}"; prosseguindo com confirmação do PutObject.`,
    lastErr instanceof Error ? lastErr.name : ''
  );
}

export async function saveMediaFile(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folder: string;
}): Promise<StoredFileResult> {
  const ext = path.extname(params.originalName).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin';
  const uniqueId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const cleanFolder = params.folder
    .split('/')
    .map((seg) => sanitizeSegment(seg))
    .filter(Boolean)
    .join('/');
  const key = `${cleanFolder}/${uniqueId}${ext}`;

  const s3 = getS3Client();
  if (s3 && process.env.S3_BUCKET) {
    const bucket = process.env.S3_BUCKET;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );

    // Confirm the object is persisted with brief backoff for edge/eventual consistency
    await verifyS3ObjectAfterPut({
      sendHead: () =>
        s3.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        ),
      expectedSize: params.buffer.length,
      key,
    });

    return {
      key,
      url: `/api/media/file/${key}`,
      mimeType: params.mimeType,
      size: params.buffer.length,
      driver: 's3',
    };
  }

  // Fallback: managed local server storage
  ensureLocalDir(LOCAL_MEDIA_ROOT);
  const fullPath = path.resolve(LOCAL_MEDIA_ROOT, key);
  if (!fullPath.startsWith(LOCAL_MEDIA_ROOT)) {
    throw new Error('Caminho de armazenamento inválido.');
  }
  ensureLocalDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, params.buffer);

  if (!fs.existsSync(fullPath)) {
    throw new Error('Falha ao confirmar gravação local do arquivo.');
  }

  return {
    key,
    url: `/api/media/file/${key}`,
    mimeType: params.mimeType,
    size: params.buffer.length,
    driver: 'local',
  };
}

export interface MediaHeadResult {
  exists: boolean;
  contentType: string;
  contentLength?: number;
  etag?: string;
}

export async function headMediaFile(relativeKey: string): Promise<MediaHeadResult | null> {
  const cleanKey = normalizeMediaKey(relativeKey);
  if (!cleanKey) return null;

  const s3 = getS3Client();
  if (s3 && process.env.S3_BUCKET) {
    try {
      const head = await s3.send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: cleanKey,
        })
      );
      const extMime = getMimeFromExtension(cleanKey);
      const contentType =
        head.ContentType && head.ContentType !== 'application/octet-stream'
          ? head.ContentType
          : extMime;

      return {
        exists: true,
        contentType,
        contentLength: head.ContentLength,
        etag: head.ETag,
      };
    } catch (err) {
      if (isS3NotFoundError(err)) return null;
      throw err;
    }
  }

  const fullPath = resolveLocalMediaPath(cleanKey);
  if (!fullPath) return null;
  const stat = fs.statSync(fullPath);
  return {
    exists: true,
    contentType: getMimeFromExtension(fullPath),
    contentLength: stat.size,
  };
}

export type MediaStreamOutcome =
  | {
      kind: 'ok';
      statusCode: 200 | 206;
      stream: Readable;
      contentType: string;
      contentLength?: number;
      contentRange?: string;
      etag?: string;
    }
  | { kind: 'not_found' }
  | { kind: 'invalid_range'; totalSize?: number };

export async function getMediaFileStream(
  relativeKey: string,
  rangeHeader?: string
): Promise<MediaStreamOutcome> {
  const cleanKey = normalizeMediaKey(relativeKey);
  if (!cleanKey) return { kind: 'not_found' };

  const normalizedRange = rangeHeader?.trim();
  if (normalizedRange && !/^bytes=(\d+-\d*|-\d+)$/i.test(normalizedRange)) {
    return { kind: 'invalid_range' };
  }

  const s3 = getS3Client();
  if (s3 && process.env.S3_BUCKET) {
    const bucket = process.env.S3_BUCKET;
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: cleanKey,
          ...(normalizedRange ? { Range: normalizedRange } : {}),
        })
      );

      const stream = toNodeReadable(response.Body);
      if (!stream) {
        throw new Error('Bunny Storage retornou corpo vazio ou stream incompatível.');
      }

      const extMime = getMimeFromExtension(cleanKey);
      const contentType =
        response.ContentType && response.ContentType !== 'application/octet-stream'
          ? response.ContentType
          : extMime;

      const isPartial = Boolean(response.ContentRange);
      return {
        kind: 'ok',
        statusCode: isPartial ? 206 : 200,
        stream,
        contentType,
        contentLength: response.ContentLength,
        contentRange: response.ContentRange,
        etag: response.ETag,
      };
    } catch (err) {
      if (isS3NotFoundError(err)) {
        return { kind: 'not_found' };
      }
      if (isS3InvalidRangeError(err)) {
        let totalSize: number | undefined;
        try {
          const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: cleanKey }));
          totalSize = head.ContentLength;
        } catch {
          // Ignore secondary head error
        }
        return { kind: 'invalid_range', totalSize };
      }
      throw err;
    }
  }

  // Local fallback streaming
  const fullPath = resolveLocalMediaPath(cleanKey);
  if (!fullPath) return { kind: 'not_found' };

  const stat = fs.statSync(fullPath);
  const fileSize = stat.size;
  const contentType = getMimeFromExtension(fullPath);

  if (normalizedRange) {
    const parts = normalizedRange.replace(/^bytes=/i, '').split('-');
    let start: number;
    let end: number;

    if (parts[0] === '') {
      const suffixLength = parseInt(parts[1], 10);
      if (isNaN(suffixLength) || suffixLength <= 0) {
        return { kind: 'invalid_range', totalSize: fileSize };
      }
      start = Math.max(0, fileSize - suffixLength);
      end = fileSize - 1;
    } else {
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    }

    if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
      return { kind: 'invalid_range', totalSize: fileSize };
    }

    const chunkSize = end - start + 1;
    return {
      kind: 'ok',
      statusCode: 206,
      stream: fs.createReadStream(fullPath, { start, end }),
      contentType,
      contentLength: chunkSize,
      contentRange: `bytes ${start}-${end}/${fileSize}`,
    };
  }

  return {
    kind: 'ok',
    statusCode: 200,
    stream: fs.createReadStream(fullPath),
    contentType,
    contentLength: fileSize,
  };
}

export async function deleteMediaFile(key: string): Promise<void> {
  const cleanKey = normalizeMediaKey(key);
  if (!cleanKey) {
    throw new Error('Chave de arquivo inválida para exclusão.');
  }

  const s3 = getS3Client();
  if (s3 && process.env.S3_BUCKET) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: cleanKey,
        })
      );
    } catch (err) {
      if (isS3NotFoundError(err)) return;
      throw err;
    }
    return;
  }

  const fullPath = path.resolve(LOCAL_MEDIA_ROOT, cleanKey);
  if (fullPath.startsWith(LOCAL_MEDIA_ROOT) && fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

export async function readMediaFileBuffer(
  relativeKey: string,
  maxBytes: number = 30 * 1024 * 1024
): Promise<Buffer | null> {
  const outcome = await getMediaFileStream(relativeKey);
  if (outcome.kind !== 'ok') {
    return null;
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = outcome.stream;

    stream.on('data', (chunk: Buffer | Uint8Array | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        stream.destroy(new Error('Arquivo de mídia excede o limite de leitura em memória.'));
        return;
      }
      chunks.push(buf);
    });

    stream.on('end', () => {
      resolve(Buffer.concat(chunks, total));
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

export function resolveLocalMediaPath(relativeKey: string): string | null {
  const cleanKey = normalizeMediaKey(relativeKey);
  if (!cleanKey) return null;
  const fullPath = path.resolve(LOCAL_MEDIA_ROOT, cleanKey);
  if (!fullPath.startsWith(LOCAL_MEDIA_ROOT)) return null;
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  return fullPath;
}

export function getMimeFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.apng':
      return 'image/apng';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
