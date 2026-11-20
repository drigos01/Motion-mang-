import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  computeProportionalCropRect,
  detectMotionSignature,
  inspectAnimatedImageBytes,
  MOTION_DURATION_EPSILON,
  MOTION_MAX_BYTES,
  MOTION_MAX_DURATION_SECONDS,
  MotionAlignment,
  normalizeMotionAlignment,
} from '../shared/motionMedia.ts';
import {
  normalizeMediaKey,
  readMediaFileBuffer,
  sanitizeSegment,
} from './storage.ts';

const execFileAsync = promisify(execFile);

const FFPROBE_BIN = '/usr/bin/ffprobe';
const FFMPEG_BIN = '/usr/bin/ffmpeg';
const CONVERT_BIN = '/usr/bin/convert';
const MEDIA_CMD_TIMEOUT_MS = 90_000;
const MEDIA_CMD_MAX_BUFFER = 10 * 1024 * 1024;

export class MotionValidationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'MotionValidationError';
    this.statusCode = statusCode;
  }
}

export interface ProcessMotionParams {
  buffer: Buffer;
  originalName: string;
  declaredMimeType: string;
  userId: string;
  originalUrl?: string;
  targetWidth?: number;
  targetHeight?: number;
  alignment?: string;
  readStoredMedia?: (key: string) => Promise<Buffer | null>;
}

export interface ProcessMotionResult {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  isAnimated: boolean;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  cropped: boolean;
  alignment: MotionAlignment;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: {
    attached_pic?: number;
  };
}

interface FfprobeOutput {
  format?: {
    format_name?: string;
    duration?: string;
  };
  streams?: FfprobeStream[];
}

async function runFfprobe(filePath: string): Promise<FfprobeOutput> {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    {
      timeout: MEDIA_CMD_TIMEOUT_MS,
      maxBuffer: MEDIA_CMD_MAX_BUFFER,
    }
  );
  return JSON.parse(stdout || '{}') as FfprobeOutput;
}

function getImageDimensionsFromHeader(bytes: Uint8Array): { width: number; height: number } | null {
  const animatedOrStandard = inspectAnimatedImageBytes(bytes);
  if (animatedOrStandard && animatedOrStandard.width > 0 && animatedOrStandard.height > 0) {
    return { width: animatedOrStandard.width, height: animatedOrStandard.height };
  }

  // JPEG SOF parsing
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) {
        offset++;
      }
      if (offset >= bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        continue;
      }
      if (offset + 2 > bytes.length) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && segmentLength >= 7) {
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
      offset += segmentLength;
    }
  }

  return null;
}

async function resolveOriginalPageDimensions(params: {
  userId: string;
  originalUrl?: string;
  targetWidth?: number;
  targetHeight?: number;
  readStoredMedia: (key: string) => Promise<Buffer | null>;
  tmpDir: string;
}): Promise<{ width: number; height: number } | null> {
  const rawUrl = (params.originalUrl || '').trim();
  if (rawUrl && (rawUrl.startsWith('/api/media/file/') || !rawUrl.startsWith('http'))) {
    const cleanKey = normalizeMediaKey(rawUrl);
    if (!cleanKey) {
      throw new MotionValidationError('Referência da imagem original da página é inválida.', 400);
    }
    const ownerPrefix = `users/${sanitizeSegment(params.userId)}/`;
    if (!cleanKey.startsWith(ownerPrefix)) {
      throw new MotionValidationError(
        'Você não tem permissão para vincular Motion à imagem original de outro usuário.',
        403
      );
    }

    const origBuffer = await params.readStoredMedia(cleanKey);
    if (origBuffer && origBuffer.length > 0) {
      const headerDims = getImageDimensionsFromHeader(origBuffer);
      if (headerDims) {
        return headerDims;
      }
      const probePath = path.join(params.tmpDir, 'original_page_probe');
      fs.writeFileSync(probePath, origBuffer);
      try {
        const probe = await runFfprobe(probePath);
        const stream = probe.streams?.find((s) => (s.width || 0) > 0 && (s.height || 0) > 0);
        if (stream?.width && stream?.height) {
          return { width: stream.width, height: stream.height };
        }
      } catch {
        // Fallback to numeric targetWidth/targetHeight below if valid
      }
    }
  }

  if (
    typeof params.targetWidth === 'number' &&
    typeof params.targetHeight === 'number' &&
    Number.isFinite(params.targetWidth) &&
    Number.isFinite(params.targetHeight) &&
    params.targetWidth > 0 &&
    params.targetHeight > 0 &&
    params.targetWidth <= 20_000 &&
    params.targetHeight <= 20_000
  ) {
    return {
      width: Math.round(params.targetWidth),
      height: Math.round(params.targetHeight),
    };
  }

  return null;
}

function formatDurationSeconds(seconds: number): string {
  return seconds.toFixed(1).replace('.', ',');
}

function parseFiniteDuration(raw?: string): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function buildOutputBaseName(originalName: string): string {
  const base = path.basename(originalName || 'motion', path.extname(originalName || ''));
  return base.replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(0, 60) || 'motion';
}

export async function validateAndProcessMotionUpload(
  params: ProcessMotionParams
): Promise<ProcessMotionResult> {
  const { buffer, originalName } = params;
  const alignment = normalizeMotionAlignment(params.alignment);

  if (!buffer || buffer.length === 0) {
    throw new MotionValidationError('Arquivo Motion vazio.', 400);
  }

  if (buffer.length > MOTION_MAX_BYTES) {
    throw new MotionValidationError(
      'O arquivo Motion excede o limite máximo de 20 MB.',
      413
    );
  }

  const detectedFormat = detectMotionSignature(buffer);
  if (!detectedFormat || detectedFormat === 'png') {
    throw new MotionValidationError(
      'Formato Motion inválido ou incompatível com a assinatura real do arquivo. Envie MP4, WebM, GIF, WebP ou APNG.',
      400
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-motion-'));
  try {
    const readStoredMedia = params.readStoredMedia ?? readMediaFileBuffer;
    const baseName = buildOutputBaseName(originalName);
    const inputPath = path.join(tmpDir, `input.${detectedFormat}`);
    fs.writeFileSync(inputPath, buffer);

    const targetDims = await resolveOriginalPageDimensions({
      userId: params.userId,
      originalUrl: params.originalUrl,
      targetWidth: params.targetWidth,
      targetHeight: params.targetHeight,
      readStoredMedia,
      tmpDir,
    });

    if (detectedFormat === 'mp4' || detectedFormat === 'webm') {
      let probe: FfprobeOutput;
      try {
        probe = await runFfprobe(inputPath);
      } catch {
        throw new MotionValidationError(
          'Não foi possível ler os metadados reais do vídeo enviado.',
          400
        );
      }

      const formatName = (probe.format?.format_name || '').toLowerCase();
      if (detectedFormat === 'mp4' && !formatName.includes('mp4') && !formatName.includes('mov')) {
        throw new MotionValidationError('O arquivo MP4 não possui um contêiner MP4 válido.', 400);
      }
      if (detectedFormat === 'webm' && !formatName.includes('webm') && !formatName.includes('matroska')) {
        throw new MotionValidationError('O arquivo WebM não possui um contêiner WebM válido.', 400);
      }

      const videoStream = probe.streams?.find(
        (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1
      );
      if (!videoStream || !videoStream.width || !videoStream.height) {
        throw new MotionValidationError(
          'O arquivo enviado não contém uma trilha de vídeo válida.',
          400
        );
      }

      const formatDuration = parseFiniteDuration(probe.format?.duration);
      const streamDuration = parseFiniteDuration(videoStream.duration);
      const durationSeconds =
        formatDuration !== null && streamDuration !== null
          ? Math.max(formatDuration, streamDuration)
          : (formatDuration ?? streamDuration);

      if (durationSeconds === null) {
        throw new MotionValidationError(
          'Não foi possível verificar a duração real do vídeo.',
          400
        );
      }

      if (durationSeconds > MOTION_MAX_DURATION_SECONDS + MOTION_DURATION_EPSILON) {
        throw new MotionValidationError(
          `O vídeo Motion tem ${formatDurationSeconds(durationSeconds)}s e excede o limite máximo de ${MOTION_MAX_DURATION_SECONDS} segundos.`,
          400
        );
      }

      const sourceWidth = videoStream.width;
      const sourceHeight = videoStream.height;
      const crop = targetDims
        ? computeProportionalCropRect({
            mediaWidth: sourceWidth,
            mediaHeight: sourceHeight,
            targetWidth: targetDims.width,
            targetHeight: targetDims.height,
            alignment,
            requireEvenDimensions: true,
          })
        : {
            needsCrop: false,
            cropWidth: sourceWidth,
            cropHeight: sourceHeight,
            cropX: 0,
            cropY: 0,
            mediaAspect: sourceWidth / sourceHeight,
            targetAspect: sourceWidth / sourceHeight,
          };

      if (!crop.needsCrop) {
        return {
          buffer,
          fileName: `${baseName}.${detectedFormat}`,
          mimeType: detectedFormat === 'mp4' ? 'video/mp4' : 'video/webm',
          durationSeconds,
          isAnimated: true,
          sourceWidth,
          sourceHeight,
          outputWidth: sourceWidth,
          outputHeight: sourceHeight,
          cropped: false,
          alignment,
        };
      }

      const outputPath = path.join(tmpDir, 'output.mp4');
      const hasAudio = Boolean(probe.streams?.some((s) => s.codec_type === 'audio'));
      const ffmpegArgs = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        `crop=${crop.cropWidth}:${crop.cropHeight}:${crop.cropX}:${crop.cropY},setsar=1`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-movflags',
        '+faststart',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        outputPath,
      ];

      try {
        await execFileAsync(FFMPEG_BIN, ffmpegArgs, {
          timeout: MEDIA_CMD_TIMEOUT_MS,
          maxBuffer: MEDIA_CMD_MAX_BUFFER,
        });
      } catch (err) {
        throw new MotionValidationError(
          `Falha ao recortar o vídeo Motion no servidor: ${
            err instanceof Error ? err.message : 'erro desconhecido'
          }`,
          500
        );
      }

      if (!fs.existsSync(outputPath)) {
        throw new MotionValidationError('Arquivo MP4 recortado não foi gerado.', 500);
      }

      const outBuffer = fs.readFileSync(outputPath);
      if (outBuffer.length === 0) {
        throw new MotionValidationError('Arquivo MP4 recortado está vazio.', 500);
      }
      if (outBuffer.length > MOTION_MAX_BYTES) {
        throw new MotionValidationError(
          'O vídeo MP4 gerado após o recorte excedeu o limite máximo de 20 MB.',
          413
        );
      }

      const outProbe = await runFfprobe(outputPath);
      const outVideo = outProbe.streams?.find(
        (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1
      );
      const outDuration =
        parseFiniteDuration(outProbe.format?.duration) ??
        parseFiniteDuration(outVideo?.duration) ??
        durationSeconds;

      if (!outVideo?.width || !outVideo?.height) {
        throw new MotionValidationError('O MP4 processado não contém vídeo válido.', 500);
      }
      if (outDuration > MOTION_MAX_DURATION_SECONDS + MOTION_DURATION_EPSILON) {
        throw new MotionValidationError(
          `O vídeo processado excede o limite de ${MOTION_MAX_DURATION_SECONDS} segundos.`,
          400
        );
      }

      return {
        buffer: outBuffer,
        fileName: `${baseName}.mp4`,
        mimeType: 'video/mp4',
        durationSeconds: outDuration,
        isAnimated: true,
        sourceWidth,
        sourceHeight,
        outputWidth: outVideo.width,
        outputHeight: outVideo.height,
        cropped: true,
        alignment,
      };
    }

    // Animated / static image formats: GIF, WebP, APNG
    const imgInfo = inspectAnimatedImageBytes(buffer);
    if (!imgInfo || imgInfo.width <= 0 || imgInfo.height <= 0) {
      throw new MotionValidationError(
        'Não foi possível ler as dimensões reais do arquivo GIF/WebP/APNG.',
        400
      );
    }

    // Only enforce the 10s duration limit when the file is genuinely animated (do NOT break static images)
    if (
      imgInfo.isAnimated &&
      imgInfo.durationSeconds > MOTION_MAX_DURATION_SECONDS + MOTION_DURATION_EPSILON
    ) {
      const label = detectedFormat.toUpperCase();
      throw new MotionValidationError(
        `A animação ${label} tem ${formatDurationSeconds(imgInfo.durationSeconds)}s e excede o limite máximo de ${MOTION_MAX_DURATION_SECONDS} segundos.`,
        400
      );
    }

    const mimeByFormat: Record<'gif' | 'webp' | 'apng', string> = {
      gif: 'image/gif',
      webp: 'image/webp',
      apng: 'image/apng',
    };

    const crop = targetDims
      ? computeProportionalCropRect({
          mediaWidth: imgInfo.width,
          mediaHeight: imgInfo.height,
          targetWidth: targetDims.width,
          targetHeight: targetDims.height,
          alignment,
          requireEvenDimensions: false,
        })
      : {
          needsCrop: false,
          cropWidth: imgInfo.width,
          cropHeight: imgInfo.height,
          cropX: 0,
          cropY: 0,
          mediaAspect: imgInfo.width / imgInfo.height,
          targetAspect: imgInfo.width / imgInfo.height,
        };

    if (!crop.needsCrop) {
      return {
        buffer,
        fileName: `${baseName}.${detectedFormat}`,
        mimeType: mimeByFormat[detectedFormat],
        durationSeconds: imgInfo.durationSeconds,
        isAnimated: imgInfo.isAnimated,
        sourceWidth: imgInfo.width,
        sourceHeight: imgInfo.height,
        outputWidth: imgInfo.width,
        outputHeight: imgInfo.height,
        cropped: false,
        alignment,
      };
    }

    const outputPath = path.join(tmpDir, `output.${detectedFormat}`);
    try {
      if (detectedFormat === 'gif') {
        const paletteFilter = imgInfo.isAnimated
          ? `crop=${crop.cropWidth}:${crop.cropHeight}:${crop.cropX}:${crop.cropY},setsar=1,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer`
          : `crop=${crop.cropWidth}:${crop.cropHeight}:${crop.cropX}:${crop.cropY},setsar=1,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
        await execFileAsync(
          FFMPEG_BIN,
          ['-y', '-i', inputPath, '-vf', paletteFilter, outputPath],
          { timeout: MEDIA_CMD_TIMEOUT_MS, maxBuffer: MEDIA_CMD_MAX_BUFFER }
        );
      } else if (detectedFormat === 'apng') {
        await execFileAsync(
          FFMPEG_BIN,
          [
            '-y',
            '-i',
            inputPath,
            '-vf',
            `crop=${crop.cropWidth}:${crop.cropHeight}:${crop.cropX}:${crop.cropY},setsar=1`,
            '-f',
            'apng',
            '-plays',
            String(imgInfo.plays ?? 0),
            outputPath,
          ],
          { timeout: MEDIA_CMD_TIMEOUT_MS, maxBuffer: MEDIA_CMD_MAX_BUFFER }
        );
      } else {
        // WebP (static or animated): FFmpeg 4.4.2 does not support animated WebP decoding; ImageMagick preserves all frames and delays
        await execFileAsync(
          CONVERT_BIN,
          [
            inputPath,
            '-coalesce',
            '-crop',
            `${crop.cropWidth}x${crop.cropHeight}+${crop.cropX}+${crop.cropY}`,
            '+repage',
            outputPath,
          ],
          { timeout: MEDIA_CMD_TIMEOUT_MS, maxBuffer: MEDIA_CMD_MAX_BUFFER }
        );
      }
    } catch (err) {
      throw new MotionValidationError(
        `Falha ao recortar ${detectedFormat.toUpperCase()} no servidor: ${
          err instanceof Error ? err.message : 'erro desconhecido'
        }`,
        500
      );
    }

    if (!fs.existsSync(outputPath)) {
      throw new MotionValidationError(
        `Arquivo ${detectedFormat.toUpperCase()} recortado não foi gerado.`,
        500
      );
    }

    const outBuffer = fs.readFileSync(outputPath);
    if (outBuffer.length === 0) {
      throw new MotionValidationError(
        `Arquivo ${detectedFormat.toUpperCase()} recortado está vazio.`,
        500
      );
    }
    if (outBuffer.length > MOTION_MAX_BYTES) {
      throw new MotionValidationError(
        `O arquivo ${detectedFormat.toUpperCase()} gerado após o recorte excedeu o limite máximo de 20 MB.`,
        413
      );
    }

    const outInfo = inspectAnimatedImageBytes(outBuffer);
    if (!outInfo || outInfo.width <= 0 || outInfo.height <= 0) {
      throw new MotionValidationError(
        `O arquivo ${detectedFormat.toUpperCase()} processado é inválido.`,
        500
      );
    }

    return {
      buffer: outBuffer,
      fileName: `${baseName}.${detectedFormat}`,
      mimeType: mimeByFormat[detectedFormat],
      durationSeconds: outInfo.durationSeconds,
      isAnimated: outInfo.isAnimated,
      sourceWidth: imgInfo.width,
      sourceHeight: imgInfo.height,
      outputWidth: outInfo.width,
      outputHeight: outInfo.height,
      cropped: true,
      alignment,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
