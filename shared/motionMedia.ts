export const MOTION_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
export const MOTION_MAX_DURATION_SECONDS = 10;
export const MOTION_DURATION_EPSILON = 0.005;

export type MotionAlignment = 'left' | 'center' | 'right';

export type DetectedMotionFormat = 'mp4' | 'webm' | 'gif' | 'webp' | 'apng' | 'png';

export interface AnimatedImageInfo {
  format: 'gif' | 'webp' | 'apng' | 'png';
  isAnimated: boolean;
  frameCount: number;
  durationSeconds: number;
  width: number;
  height: number;
  plays?: number;
}

export interface CropRectResult {
  needsCrop: boolean;
  cropWidth: number;
  cropHeight: number;
  cropX: number;
  cropY: number;
  mediaAspect: number;
  targetAspect: number;
}

export function normalizeMotionAlignment(input?: string | null): MotionAlignment {
  if (input === 'left' || input === 'right' || input === 'center') {
    return input;
  }
  return 'center';
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = '';
  for (let i = 0; i < len && start + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}

function skipGifSubBlocks(bytes: Uint8Array, offset: number): number {
  let pos = offset;
  while (pos < bytes.length) {
    const blockSize = bytes[pos++];
    if (blockSize === 0) break;
    pos += blockSize;
  }
  return Math.min(pos, bytes.length);
}

export function inspectGifBytes(bytes: Uint8Array): AnimatedImageInfo | null {
  if (bytes.length < 14) return null;
  const header = readAscii(bytes, 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') return null;

  const width = readUint16LE(bytes, 6);
  const height = readUint16LE(bytes, 8);
  const packed = bytes[10];
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = hasGct ? 3 * (1 << ((packed & 0x07) + 1)) : 0;

  let pos = 13 + gctSize;
  let frameCount = 0;
  let totalDelayCs = 0;
  let pendingDelayCs = 0;

  while (pos < bytes.length) {
    const introducer = bytes[pos++];
    if (introducer === 0x3b) {
      // Trailer
      break;
    } else if (introducer === 0x21) {
      // Extension block
      if (pos >= bytes.length) break;
      const label = bytes[pos++];
      if (label === 0xf9 && pos < bytes.length) {
        const blockSize = bytes[pos++];
        if (blockSize === 4 && pos + 4 <= bytes.length) {
          pendingDelayCs = readUint16LE(bytes, pos + 1);
        }
        pos += blockSize;
        pos = skipGifSubBlocks(bytes, pos);
      } else {
        pos = skipGifSubBlocks(bytes, pos);
      }
    } else if (introducer === 0x2c) {
      // Image Descriptor
      if (pos + 9 > bytes.length) break;
      const imgPacked = bytes[pos + 8];
      const hasLct = (imgPacked & 0x80) !== 0;
      const lctSize = hasLct ? 3 * (1 << ((imgPacked & 0x07) + 1)) : 0;
      pos += 9 + lctSize;
      if (pos >= bytes.length) break;
      pos++; // LZW minimum code size
      pos = skipGifSubBlocks(bytes, pos);

      frameCount++;
      totalDelayCs += pendingDelayCs;
      pendingDelayCs = 0;
    } else {
      break;
    }
  }

  const isAnimated = frameCount > 1;
  // In animated GIFs, browsers clamp 0cs frame delays to 10cs (100ms) only if non-zero delays are absent,
  // otherwise sum exact centiseconds.
  const effectiveCs =
    isAnimated && totalDelayCs === 0 ? frameCount * 10 : totalDelayCs;

  return {
    format: 'gif',
    isAnimated,
    frameCount: Math.max(1, frameCount),
    durationSeconds: isAnimated ? effectiveCs / 100 : 0,
    width,
    height,
  };
}

export function inspectWebpBytes(bytes: Uint8Array): AnimatedImageInfo | null {
  if (bytes.length < 16) return null;
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') {
    return null;
  }

  let pos = 12;
  let width = 0;
  let height = 0;
  let hasAnimFlag = false;
  let frameCount = 0;
  let totalDurationMs = 0;

  while (pos + 8 <= bytes.length) {
    const fourcc = readAscii(bytes, pos, 4);
    const size = readUint32LE(bytes, pos + 4);
    const payloadStart = pos + 8;
    if (payloadStart > bytes.length) break;

    if (fourcc === 'VP8X' && payloadStart + 10 <= bytes.length) {
      const flags = bytes[payloadStart];
      hasAnimFlag = (flags & 0x02) !== 0;
      width = 1 + readUint24LE(bytes, payloadStart + 4);
      height = 1 + readUint24LE(bytes, payloadStart + 7);
    } else if (fourcc === 'VP8 ' && width === 0 && payloadStart + 10 <= bytes.length) {
      // Lossy keyframe header: 3 bytes frame tag + 0x9d 0x01 0x2a + 2 bytes w + 2 bytes h
      if (
        bytes[payloadStart + 3] === 0x9d &&
        bytes[payloadStart + 4] === 0x01 &&
        bytes[payloadStart + 5] === 0x2a
      ) {
        width = readUint16LE(bytes, payloadStart + 6) & 0x3fff;
        height = readUint16LE(bytes, payloadStart + 8) & 0x3fff;
      }
    } else if (fourcc === 'VP8L' && width === 0 && payloadStart + 5 <= bytes.length) {
      if (bytes[payloadStart] === 0x2f) {
        const b1 = bytes[payloadStart + 1];
        const b2 = bytes[payloadStart + 2];
        const b3 = bytes[payloadStart + 3];
        const b4 = bytes[payloadStart + 4];
        width = 1 + (((b2 & 0x3f) << 8) | b1);
        height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
      }
    } else if (fourcc === 'ANMF' && payloadStart + 16 <= bytes.length) {
      const frameDurationMs = readUint24LE(bytes, payloadStart + 12);
      frameCount++;
      totalDurationMs += frameDurationMs;
    }

    const paddedSize = size + (size % 2);
    pos = payloadStart + paddedSize;
  }

  const isAnimated = frameCount > 1 || (hasAnimFlag && frameCount > 1);
  return {
    format: 'webp',
    isAnimated,
    frameCount: Math.max(1, frameCount),
    durationSeconds: isAnimated ? totalDurationMs / 1000 : 0,
    width,
    height,
  };
}

export function inspectPngOrApngBytes(bytes: Uint8Array): AnimatedImageInfo | null {
  if (bytes.length < 33) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return null;
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let actlFrames = 0;
  let plays = 0;
  let fctlCount = 0;
  let totalDurationSeconds = 0;

  while (pos + 12 <= bytes.length) {
    const length = readUint32BE(bytes, pos);
    const type = readAscii(bytes, pos + 4, 4);
    const dataStart = pos + 8;
    if (dataStart + length > bytes.length) break;

    if (type === 'IHDR' && length >= 8) {
      width = readUint32BE(bytes, dataStart);
      height = readUint32BE(bytes, dataStart + 4);
    } else if (type === 'acTL' && length >= 8) {
      actlFrames = readUint32BE(bytes, dataStart);
      plays = readUint32BE(bytes, dataStart + 4);
    } else if (type === 'fcTL' && length >= 26) {
      const delayNum = readUint16BE(bytes, dataStart + 20);
      let delayDen = readUint16BE(bytes, dataStart + 22);
      if (delayDen === 0) delayDen = 100;
      totalDurationSeconds += delayNum / delayDen;
      fctlCount++;
    } else if (type === 'IEND') {
      break;
    }

    pos = dataStart + length + 4; // skip CRC
  }

  const effectiveFrames = Math.max(actlFrames, fctlCount);
  const isAnimated = actlFrames > 1 || fctlCount > 1;
  return {
    format: actlFrames > 0 || fctlCount > 0 ? 'apng' : 'png',
    isAnimated,
    frameCount: Math.max(1, effectiveFrames),
    durationSeconds: isAnimated ? totalDurationSeconds : 0,
    width,
    height,
    plays,
  };
}

export function inspectAnimatedImageBytes(bytes: Uint8Array): AnimatedImageInfo | null {
  return inspectGifBytes(bytes) ?? inspectWebpBytes(bytes) ?? inspectPngOrApngBytes(bytes);
}

export function detectMotionSignature(bytes: Uint8Array): DetectedMotionFormat | null {
  if (bytes.length < 12) return null;

  const gif = inspectGifBytes(bytes);
  if (gif) return 'gif';

  const webp = inspectWebpBytes(bytes);
  if (webp) return 'webp';

  const png = inspectPngOrApngBytes(bytes);
  if (png) return png.format;

  // MP4 / ISO BMFF: bytes 4..7 == 'ftyp'
  if (readAscii(bytes, 4, 4) === 'ftyp') {
    return 'mp4';
  }

  // WebM / Matroska EBML header: 0x1A 0x45 0xDF 0xA3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return 'webm';
  }

  return null;
}

export function computeProportionalCropRect(params: {
  mediaWidth: number;
  mediaHeight: number;
  targetWidth: number;
  targetHeight: number;
  alignment?: MotionAlignment;
  requireEvenDimensions?: boolean;
}): CropRectResult {
  const alignment = normalizeMotionAlignment(params.alignment);
  const mediaWidth = Math.max(1, Math.round(params.mediaWidth));
  const mediaHeight = Math.max(1, Math.round(params.mediaHeight));
  const targetWidth = Math.max(1, Math.round(params.targetWidth));
  const targetHeight = Math.max(1, Math.round(params.targetHeight));

  const mediaAspect = mediaWidth / mediaHeight;
  const targetAspect = targetWidth / targetHeight;

  const idealCropWidth = Math.round(mediaHeight * targetAspect);
  // Only crop when the Motion media is noticeably wider than the page proportion (at least 2px wider)
  if (idealCropWidth >= mediaWidth - 1 || mediaAspect <= targetAspect * 1.005) {
    return {
      needsCrop: false,
      cropWidth: mediaWidth,
      cropHeight: mediaHeight,
      cropX: 0,
      cropY: 0,
      mediaAspect,
      targetAspect,
    };
  }

  let cropWidth = Math.max(2, Math.min(mediaWidth, idealCropWidth));
  let cropHeight = mediaHeight;

  if (params.requireEvenDimensions) {
    cropWidth = Math.max(2, cropWidth & ~1);
    cropHeight = Math.max(2, cropHeight & ~1);
    if (cropWidth > mediaWidth) cropWidth = Math.max(2, mediaWidth & ~1);
    if (cropHeight > mediaHeight) cropHeight = Math.max(2, mediaHeight & ~1);
  }

  const maxX = Math.max(0, mediaWidth - cropWidth);
  let cropX = 0;
  if (alignment === 'left') {
    cropX = 0;
  } else if (alignment === 'right') {
    cropX = maxX;
  } else {
    cropX = Math.floor(maxX / 2);
  }

  if (params.requireEvenDimensions) {
    cropX = Math.min(maxX, cropX & ~1);
  }

  return {
    needsCrop: cropWidth < mediaWidth,
    cropWidth,
    cropHeight,
    cropX,
    cropY: 0,
    mediaAspect,
    targetAspect,
  };
}
