import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type express from 'express';
import multer from 'multer';
import { MOTION_MAX_BYTES } from '../shared/motionMedia.ts';
import {
  checkIsAdminUser,
  VerifiedFirebaseUser,
  verifyFirebaseIdToken,
} from './firestoreRest.ts';
import {
  MotionValidationError,
  validateAndProcessMotionUpload,
} from './motionProcessor.ts';
import {
  readMediaFileBuffer,
  saveMediaFile,
  sanitizeSegment,
  StorageConfigError,
  type StoredFileResult,
} from './storage.ts';

const execFileAsync = promisify(execFile);
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_MOTION_DECLARED_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'image/gif',
  'image/webp',
  'image/apng',
  'image/png', // Some browsers label .apng as image/png; server signature verification still enforces real APNG
  'application/octet-stream',
  '',
]);
const ALLOWED_RECEIPT_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const MAX_UPLOAD_BYTES = 26 * 1024 * 1024; // Covers 25 MB images and catches >20 MB Motion cleanly

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
  },
});

function parseSingleUpload(req: express.Request, res: express.Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function parseOptionalDimension(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.round(num);
}

type DetectedImageKind =
  | { mime: 'image/jpeg'; ext: '.jpg'; needsConvert: false }
  | { mime: 'image/png'; ext: '.png'; needsConvert: false }
  | { mime: 'image/webp'; ext: '.webp'; needsConvert: false }
  | { mime: 'image/heif' | 'image/gif'; ext: '.heic' | '.gif'; needsConvert: true };

function detectStandardImageKind(buf: Buffer): DetectedImageKind | null {
  if (buf.length < 12) return null;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: '.jpg', needsConvert: false };
  }
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: '.png', needsConvert: false };
  }
  // WebP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: '.webp', needsConvert: false };
  }
  // GIF
  const gifSig = buf.subarray(0, 6).toString('ascii');
  if (gifSig === 'GIF87a' || gifSig === 'GIF89a') {
    return { mime: 'image/gif', ext: '.gif', needsConvert: true };
  }
  // HEIC / HEIF / AVIF (ISO BMFF ftyp)
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'].includes(brand)) {
      return { mime: 'image/heif', ext: '.heic', needsConvert: true };
    }
  }
  return null;
}

async function normalizeAvatarImageBuffer(
  buffer: Buffer,
  originalName: string
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const detected = detectStandardImageKind(buffer);
  if (!detected) {
    throw new MotionValidationError(
      'Formato de foto inválido. Envie JPG, PNG, WebP, HEIC, AVIF ou GIF.',
      400
    );
  }
  const baseName = path.basename(originalName || 'avatar', path.extname(originalName || '')) || 'avatar';
  if (!detected.needsConvert) {
    return {
      buffer,
      fileName: `${baseName}${detected.ext}`,
      mimeType: detected.mime,
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-conv-'));
  try {
    const inPath = path.join(tmpDir, `in${detected.ext}`);
    const outPath = path.join(tmpDir, 'out.webp');
    fs.writeFileSync(inPath, buffer);
    await execFileAsync('/usr/bin/convert', [`${inPath}[0]`, '-auto-orient', '-quality', '90', outPath], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const outBuf = fs.readFileSync(outPath);
    if (outBuf.length === 0) {
      throw new Error('Conversão de avatar retornou arquivo vazio.');
    }
    return {
      buffer: outBuf,
      fileName: `${baseName}.webp`,
      mimeType: 'image/webp',
    };
  } catch (err) {
    if (err instanceof MotionValidationError) throw err;
    const isMissingConvert =
      Boolean(err && typeof err === 'object' && 'code' in err && (err as { code?: unknown }).code === 'ENOENT');
    if (isMissingConvert) {
      throw new MotionValidationError(
        'Conversão automática de HEIC/AVIF/GIF indisponível neste ambiente. Envie sua foto em JPG, PNG ou WebP.',
        422
      );
    }
    throw new MotionValidationError(
      'Não foi possível processar esta foto no servidor. Tente enviar em JPG, PNG ou WebP.',
      400
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export interface MediaUploadHandlerDeps {
  verifyToken?: (authHeader?: string) => Promise<VerifiedFirebaseUser | null>;
  checkAdmin?: (uid: string, email: string | undefined, idToken: string) => Promise<boolean>;
  saveFile?: (params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    folder: string;
  }) => Promise<StoredFileResult>;
  readFile?: (relativeKey: string) => Promise<Buffer | null>;
}

export function createMediaUploadHandler(deps: MediaUploadHandlerDeps = {}) {
  const verifyToken = deps.verifyToken ?? verifyFirebaseIdToken;
  const checkAdmin = deps.checkAdmin ?? checkIsAdminUser;
  const saveFile = deps.saveFile ?? saveMediaFile;
  const readFile = deps.readFile ?? readMediaFileBuffer;

  return async function handleMediaUpload(req: express.Request, res: express.Response) {
    try {
      const user = await verifyToken(req.headers.authorization);
      if (!user || !user.emailVerified) {
        res.status(401).json({
          error: 'Autenticação verificada obrigatória para enviar arquivos.',
        });
        return;
      }

      try {
        await parseSingleUpload(req, res);
      } catch (uploadErr) {
        if (uploadErr instanceof multer.MulterError) {
          if (uploadErr.code === 'LIMIT_FILE_SIZE') {
            const isMotion = String(req.body?.kind || '') === 'motion';
            res.status(413).json({
              error: isMotion
                ? 'O arquivo Motion excede o limite máximo de 20 MB.'
                : 'O arquivo excede o limite máximo permitido (20 MB para Motion e 25 MB para imagens).',
            });
            return;
          }
          res.status(400).json({ error: `Erro no envio do arquivo: ${uploadErr.message}` });
          return;
        }
        throw uploadErr;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado.' });
        return;
      }

      const kind = String(req.body.kind || 'original');
      const mangaId = sanitizeSegment(String(req.body.mangaId || 'general'));
      const chapterId = sanitizeSegment(String(req.body.chapterId || 'assets'));

      let finalBuffer = file.buffer;
      let finalOriginalName = file.originalname;
      let finalMimeType = file.mimetype;
      let motionMetadata:
        | {
            durationSeconds: number;
            isAnimated: boolean;
            sourceWidth: number;
            sourceHeight: number;
            outputWidth: number;
            outputHeight: number;
            cropped: boolean;
            alignment: 'left' | 'center' | 'right';
          }
        | undefined;

      if (kind === 'receipt') {
        const isAdmin = await checkAdmin(user.uid, user.email, user.idToken);
        if (!isAdmin) {
          res.status(403).json({
            error: 'Apenas administradores podem enviar comprovantes de pagamento.',
          });
          return;
        }
        if (!ALLOWED_RECEIPT_MIMES.has(file.mimetype)) {
          res.status(400).json({
            error: 'Formato de comprovante inválido. Envie JPG, PNG, WebP ou PDF.',
          });
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          res.status(413).json({ error: 'Comprovante excede o limite de 15 MB.' });
          return;
        }
      } else if (kind === 'motion') {
        if (file.size > MOTION_MAX_BYTES || file.buffer.length > MOTION_MAX_BYTES) {
          res.status(413).json({
            error: 'O arquivo Motion excede o limite máximo de 20 MB.',
          });
          return;
        }
        if (!ALLOWED_MOTION_DECLARED_MIMES.has(file.mimetype || '')) {
          res.status(400).json({
            error: 'Formato Motion inválido. Envie MP4, WebM, GIF, APNG ou WebP.',
          });
          return;
        }

        const processed = await validateAndProcessMotionUpload({
          buffer: file.buffer,
          originalName: file.originalname,
          declaredMimeType: file.mimetype,
          userId: user.uid,
          originalUrl: req.body.originalUrl ? String(req.body.originalUrl) : undefined,
          targetWidth: parseOptionalDimension(req.body.targetWidth),
          targetHeight: parseOptionalDimension(req.body.targetHeight),
          alignment: req.body.alignment ? String(req.body.alignment) : undefined,
          readStoredMedia: readFile,
        });

        finalBuffer = processed.buffer;
        finalOriginalName = processed.fileName;
        finalMimeType = processed.mimeType;
        motionMetadata = {
          durationSeconds: processed.durationSeconds,
          isAnimated: processed.isAnimated,
          sourceWidth: processed.sourceWidth,
          sourceHeight: processed.sourceHeight,
          outputWidth: processed.outputWidth,
          outputHeight: processed.outputHeight,
          cropped: processed.cropped,
          alignment: processed.alignment,
        };
      } else if (kind === 'avatar') {
        if (file.size > 25 * 1024 * 1024 || file.buffer.length > 25 * 1024 * 1024) {
          res.status(413).json({ error: 'A foto de perfil excede o limite máximo de 25 MB.' });
          return;
        }
        const normalized = await normalizeAvatarImageBuffer(file.buffer, file.originalname);
        finalBuffer = normalized.buffer;
        finalOriginalName = normalized.fileName;
        finalMimeType = normalized.mimeType;
      } else {
        const normalizedMime = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
        if (!ALLOWED_IMAGE_MIMES.has(normalizedMime)) {
          res.status(400).json({
            error: 'Formato de imagem inválido. Envie JPG, PNG ou WebP.',
          });
          return;
        }
        finalMimeType = normalizedMime;
        if (file.size > 25 * 1024 * 1024) {
          res.status(413).json({ error: 'Imagem excede o limite de 25 MB.' });
          return;
        }
      }

      let folder = `users/${sanitizeSegment(user.uid)}/misc`;
      if (kind === 'receipt') {
        const receiptFolderId = sanitizeSegment(String(req.body.requestId || mangaId || 'general'));
        folder = `admin/monetization/receipts/${receiptFolderId}`;
      } else if (kind === 'avatar') {
        folder = `users/${sanitizeSegment(user.uid)}/avatar`;
      } else if (kind === 'cover' || kind === 'banner') {
        folder = `users/${sanitizeSegment(user.uid)}/mangas/${mangaId}/brand`;
      } else if (kind === 'original' || kind === 'motion') {
        folder = `users/${sanitizeSegment(user.uid)}/mangas/${mangaId}/chapters/${chapterId}/${kind}`;
      }

      const stored = await saveFile({
        buffer: finalBuffer,
        originalName: finalOriginalName,
        mimeType: finalMimeType,
        folder,
      });

      res.status(201).json(motionMetadata ? { ...stored, motion: motionMetadata } : stored);
    } catch (err) {
      if (err instanceof MotionValidationError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      if (err instanceof StorageConfigError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('Upload error:', err);
      const rawMessage = err instanceof Error ? err.message : '';
      const message =
        rawMessage && rawMessage !== 'UnknownError'
          ? rawMessage
          : 'Falha ao armazenar e verificar arquivo no armazenamento.';
      res.status(500).json({ error: message });
    }
  };
}
