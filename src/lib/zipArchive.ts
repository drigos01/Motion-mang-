import { ChapterPage } from '../types/manga';

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
  lastModified?: Date;
}

export interface PlannedPageDownload {
  url: string;
  filename: string;
  kind: 'original' | 'motion';
  pageNumber: number;
}

export interface ZipDownloadProgress {
  completed: number;
  total: number;
  currentFilename: string;
}

const textEncoder = new TextEncoder();

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeAndDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Builds a standards-compliant Store-mode (method 0) ZIP archive with UTF-8 filenames.
 * Ideal for already-compressed images/videos (JPG, PNG, WebP, MP4, WebM, GIF) with zero overhead.
 */
export function buildStoreZip(entries: ZipEntryInput[]): Uint8Array<ArrayBuffer> {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const data = entry.data;
    const checksum = crc32(data);
    const { dosTime, dosDate } = toDosTimeAndDate(entry.lastModified ?? new Date());

    // Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // General purpose bit flag: UTF-8 filename
    lv.setUint16(8, 0, true); // Compression method: 0 (store)
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, data.length >>> 0, true); // Compressed size
    lv.setUint32(22, data.length >>> 0, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed to extract
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // Store
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, data.length >>> 0, true);
    cv.setUint32(24, data.length >>> 0, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // File comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal file attributes
    cv.setUint32(38, 0, true); // External file attributes
    cv.setUint32(42, offset >>> 0, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;
  for (const part of centralParts) {
    centralDirectorySize += part.length;
  }

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true); // Number of this disk
  ev.setUint16(6, 0, true); // Disk where central directory starts
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirectorySize >>> 0, true);
  ev.setUint32(16, centralDirectoryOffset >>> 0, true);
  ev.setUint16(20, 0, true); // ZIP file comment length

  const totalSize = offset + centralDirectorySize + eocd.length;
  const archive = new Uint8Array(totalSize);
  let cursor = 0;

  for (const part of localParts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  archive.set(eocd, cursor);

  return archive;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/apng': '.apng',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};

export function inferFileExtension(
  mimeType: string | undefined,
  url: string | undefined,
  fallback: string
): string {
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (cleanMime && MIME_TO_EXT[cleanMime]) {
    return MIME_TO_EXT[cleanMime];
  }
  if (url) {
    const withoutQuery = url.split('?')[0].split('#')[0];
    const match = withoutQuery.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (match) {
      return `.${match[1].toLowerCase()}`;
    }
  }
  return fallback;
}

export function sanitizeArchiveSlug(value: string, fallback = 'capitulo'): string {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || fallback;
}

export type DownloadMediaMode = 'normals' | 'with_motion' | 'motion_only';

export function planChapterPageDownloads(
  pages: ChapterPage[],
  includeMotion: boolean,
  options?: {
    chapterNumber?: number;
    mode?: DownloadMediaMode;
  }
): PlannedPageDownload[] {
  const ordered = pages
    .map((page, index) => ({ page, index }))
    .sort((a, b) => {
      const diff = (a.page.pageNumber || 0) - (b.page.pageNumber || 0);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((item) => item.page);

  const padWidth = Math.max(3, String(ordered.length).length);
  const mode: DownloadMediaMode = options?.mode ?? (includeMotion ? 'with_motion' : 'normals');
  const hasChapterNum =
    options?.chapterNumber !== undefined && Number.isFinite(options.chapterNumber);
  const chapterPrefix = hasChapterNum ? `C${options!.chapterNumber}-` : '';

  const planned: PlannedPageDownload[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const page = ordered[i];
    const pageSeq = page.pageNumber && page.pageNumber > 0 ? page.pageNumber : i + 1;
    const num = String(pageSeq).padStart(padWidth, '0');

    if (mode !== 'motion_only' && page.originalUrl) {
      const origExt = inferFileExtension(page.originalMime, page.originalUrl, '.jpg');
      planned.push({
        url: page.originalUrl,
        filename: `${chapterPrefix}pagina-${num}${origExt}`,
        kind: 'original',
        pageNumber: pageSeq,
      });
    }
    if ((mode === 'with_motion' || mode === 'motion_only') && page.motionUrl) {
      const motionExt = inferFileExtension(page.motionMime, page.motionUrl, '.mp4');
      planned.push({
        url: page.motionUrl,
        filename: `${chapterPrefix}pagina-${num}-motion${motionExt}`,
        kind: 'motion',
        pageNumber: pageSeq,
      });
    }
  }

  return planned;
}

export async function downloadChapterPagesZip(params: {
  mangaTitle: string;
  chapterNumber: number;
  pages: ChapterPage[];
  includeMotion: boolean;
  mode?: DownloadMediaMode;
  onProgress?: (progress: ZipDownloadProgress) => void;
}): Promise<{ filesCount: number; zipFilename: string }> {
  const mode: DownloadMediaMode =
    params.mode ?? (params.includeMotion ? 'with_motion' : 'normals');
  const planned = planChapterPageDownloads(params.pages, params.includeMotion, {
    chapterNumber: params.chapterNumber,
    mode,
  });
  if (planned.length === 0) {
    throw new Error('Nenhuma página disponível para download neste capítulo.');
  }

  const entries: ZipEntryInput[] = [];
  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    params.onProgress?.({
      completed: i,
      total: planned.length,
      currentFilename: item.filename,
    });

    const response = await fetch(item.url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(
        `Falha ao baixar ${item.filename} (HTTP ${response.status}). Tente novamente.`
      );
    }

    const contentType = response.headers.get('content-type') || undefined;
    const buffer = await response.arrayBuffer();
    // Refine extension from response content-type if original metadata lacked it
    const finalName =
      item.filename.includes('.') || !contentType
        ? item.filename
        : `${item.filename}${inferFileExtension(contentType, item.url, '')}`;

    entries.push({
      name: finalName,
      data: new Uint8Array(buffer),
    });

    params.onProgress?.({
      completed: i + 1,
      total: planned.length,
      currentFilename: finalName,
    });
  }

  const zipBytes = buildStoreZip(entries);
  const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
  const slug = sanitizeArchiveSlug(params.mangaTitle, 'manga');
  const suffix =
    mode === 'motion_only'
      ? 'somente-motion'
      : mode === 'with_motion'
        ? 'originais-motion'
        : 'originais';
  const zipFilename = `${slug}-C${params.chapterNumber}-${suffix}.zip`;

  const objectUrl = URL.createObjectURL(zipBlob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = zipFilename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  }

  return { filesCount: entries.length, zipFilename };
}

export async function downloadChapterPagesSequential(params: {
  chapterNumber: number;
  pages: ChapterPage[];
  mode: DownloadMediaMode;
  onProgress?: (progress: ZipDownloadProgress) => void;
}): Promise<{ filesCount: number }> {
  const planned = planChapterPageDownloads(
    params.pages,
    params.mode === 'with_motion',
    {
      chapterNumber: params.chapterNumber,
      mode: params.mode,
    }
  );
  if (planned.length === 0) {
    throw new Error('Nenhuma página disponível para download neste capítulo.');
  }

  for (let i = 0; i < planned.length; i++) {
    const item = planned[i];
    params.onProgress?.({
      completed: i,
      total: planned.length,
      currentFilename: item.filename,
    });

    const response = await fetch(item.url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(
        `Falha ao baixar ${item.filename} (HTTP ${response.status}). Tente novamente.`
      );
    }

    const blob = await response.blob();
    const contentType = response.headers.get('content-type') || blob.type || undefined;
    const finalName =
      item.filename.includes('.') || !contentType
        ? item.filename
        : `${item.filename}${inferFileExtension(contentType, item.url, '')}`;

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = finalName;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 2000);

    params.onProgress?.({
      completed: i + 1,
      total: planned.length,
      currentFilename: finalName,
    });

    if (i < planned.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 260));
    }
  }

  return { filesCount: planned.length };
}
