import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoreZip,
  crc32,
  inferFileExtension,
  planChapterPageDownloads,
  sanitizeArchiveSlug,
} from '../src/lib/zipArchive';
import { ChapterPage } from '../src/types/manga';

test('crc32 computes standard IEEE 802.3 checksums', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0x00000000);
});

test('buildStoreZip writes valid local headers, central directory, and EOCD', () => {
  const fileA = new TextEncoder().encode('hello manga');
  const fileB = new Uint8Array([1, 2, 3, 4, 5]);
  const archive = buildStoreZip([
    { name: 'pagina-001.jpg', data: fileA, lastModified: new Date(2026, 0, 15, 10, 30, 0) },
    { name: 'página-002-motion.mp4', data: fileB, lastModified: new Date(2026, 0, 15, 10, 30, 2) },
  ]);

  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  // Local file header signature PK\x03\x04
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // Method = 0 (store), UTF-8 bit = 0x0800
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint16(8, true), 0);
  // CRC-32 and sizes of entry 1
  assert.equal(view.getUint32(14, true), crc32(fileA));
  assert.equal(view.getUint32(18, true), fileA.length);
  assert.equal(view.getUint32(22, true), fileA.length);

  // Check EOCD at the tail (22 bytes)
  const eocdOffset = archive.length - 22;
  assert.equal(view.getUint32(eocdOffset, true), 0x06054b50);
  assert.equal(view.getUint16(eocdOffset + 8, true), 2);
  assert.equal(view.getUint16(eocdOffset + 10, true), 2);

  const centralOffset = view.getUint32(eocdOffset + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
});

test('inferFileExtension prioritizes MIME type and falls back to URL extension', () => {
  assert.equal(inferFileExtension('image/png', '/api/media/file/abc', '.jpg'), '.png');
  assert.equal(inferFileExtension('video/webm; codecs=vp9', '/api/media/file/abc', '.mp4'), '.webm');
  assert.equal(inferFileExtension('', '/api/media/file/page.webp?v=1', '.jpg'), '.webp');
  assert.equal(inferFileExtension('', '/api/media/file/noext', '.jpg'), '.jpg');
});

test('sanitizeArchiveSlug normalizes Portuguese accents and unsafe characters', () => {
  assert.equal(sanitizeArchiveSlug('Crônicas do Dragão #1!'), 'cronicas-do-dragao-1');
  assert.equal(sanitizeArchiveSlug('   ', 'obra'), 'obra');
});

test('planChapterPageDownloads filters motion files based on includeMotion flag', () => {
  const samplePages: ChapterPage[] = [
    {
      id: 'p2',
      mangaId: 'm1',
      chapterId: 'c1',
      authorId: 'u1',
      chapterStatus: 'draft',
      pageNumber: 2,
      originalUrl: '/api/media/file/orig2.png',
      originalMime: 'image/png',
      motionUrl: '',
      motionMime: '',
    },
    {
      id: 'p1',
      mangaId: 'm1',
      chapterId: 'c1',
      authorId: 'u1',
      chapterStatus: 'draft',
      pageNumber: 1,
      originalUrl: '/api/media/file/orig1.jpg',
      originalMime: 'image/jpeg',
      motionUrl: '/api/media/file/mot1.mp4',
      motionMime: 'video/mp4',
    },
  ];

  const onlyNormal = planChapterPageDownloads(samplePages, false);
  assert.deepEqual(
    onlyNormal.map((x) => x.filename),
    ['pagina-001.jpg', 'pagina-002.png']
  );

  const withMotion = planChapterPageDownloads(samplePages, true);
  assert.deepEqual(
    withMotion.map((x) => x.filename),
    ['pagina-001.jpg', 'pagina-001-motion.mp4', 'pagina-002.png']
  );

  const chapterOrdered = planChapterPageDownloads(samplePages, true, {
    chapterNumber: 1,
    mode: 'with_motion',
  });
  assert.deepEqual(
    chapterOrdered.map((x) => x.filename),
    ['C1-pagina-001.jpg', 'C1-pagina-001-motion.mp4', 'C1-pagina-002.png']
  );

  const motionOnly = planChapterPageDownloads(samplePages, false, {
    chapterNumber: 1,
    mode: 'motion_only',
  });
  assert.deepEqual(
    motionOnly.map((x) => x.filename),
    ['C1-pagina-001-motion.mp4']
  );
});
