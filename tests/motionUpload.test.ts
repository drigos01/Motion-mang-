import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createMediaUploadHandler } from '../server/mediaUploadHandler.ts';
import {
  computeProportionalCropRect,
  inspectAnimatedImageBytes,
  MOTION_MAX_BYTES,
} from '../shared/motionMedia.ts';

const FFMPEG = '/usr/bin/ffmpeg';
const FFPROBE = '/usr/bin/ffprobe';
const CONVERT = '/usr/bin/convert';

interface StoredEntry {
  key: string;
  url: string;
  mimeType: string;
  size: number;
  driver: 'local';
  buffer: Buffer;
}

class InMemoryMediaStore {
  public files = new Map<string, StoredEntry>();
  private seq = 1;

  saveFile = async (params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    folder: string;
  }) => {
    const ext = path.extname(params.originalName).toLowerCase() || '.bin';
    const key = `${params.folder}/item-${this.seq++}${ext}`;
    const entry: StoredEntry = {
      key,
      url: `/api/media/file/${key}`,
      mimeType: params.mimeType,
      size: params.buffer.length,
      driver: 'local',
      buffer: Buffer.from(params.buffer),
    };
    this.files.set(key, entry);
    return {
      key: entry.key,
      url: entry.url,
      mimeType: entry.mimeType,
      size: entry.size,
      driver: entry.driver,
    };
  };

  readFile = async (relativeKey: string): Promise<Buffer | null> => {
    const normalized = relativeKey.replace(/^\/api\/media\/file\//, '').replace(/^\/+/, '');
    const found = this.files.get(normalized);
    return found ? Buffer.from(found.buffer) : null;
  };
}

function createMp4WithFreeAtom(validMp4: Buffer, targetTotalBytes: number): Buffer {
  const diff = targetTotalBytes - validMp4.length;
  assert.ok(diff >= 8, `Base MP4 (${validMp4.length}) must be at least 8 bytes smaller than ${targetTotalBytes}`);
  const freeAtom = Buffer.alloc(diff, 0);
  freeAtom.writeUInt32BE(diff, 0);
  freeAtom.write('free', 4, 'ascii');
  return Buffer.concat([validMp4, freeAtom]);
}

function ffprobeBuffer(buffer: Buffer, ext: string): {
  width: number;
  height: number;
  duration: number;
  formatName: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-probe-'));
  try {
    const p = path.join(dir, `probe.${ext}`);
    fs.writeFileSync(p, buffer);
    const out = execFileSync(
      FFPROBE,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(out) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>;
    };
    const v = parsed.streams?.find((s) => s.codec_type === 'video');
    return {
      width: v?.width ?? 0,
      height: v?.height ?? 0,
      duration: Number(parsed.format?.duration ?? v?.duration ?? 0),
      formatName: parsed.format?.format_name ?? '',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function extractCenterPixelRgb(mp4Buffer: Buffer): { r: number; g: number; b: number } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-rgb-'));
  try {
    const inPath = path.join(dir, 'in.mp4');
    const rawPath = path.join(dir, 'frame.rgb');
    fs.writeFileSync(inPath, mp4Buffer);
    // Scale output down to 1x1 average pixel to unambiguously verify dominant color of the cropped band
    execFileSync(
      FFMPEG,
      ['-y', '-i', inPath, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', rawPath],
      { stdio: 'pipe' }
    );
    const rgb = fs.readFileSync(rawPath);
    return { r: rgb[0], g: rgb[1], b: rgb[2] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withUploadTestServer(
  fn: (baseUrl: string, store: InMemoryMediaStore) => Promise<void>
) {
  const store = new InMemoryMediaStore();
  const app = express();
  app.post(
    '/api/media/upload',
    createMediaUploadHandler({
      verifyToken: async (authHeader) => {
        if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
        const uid = authHeader.slice('Bearer '.length).trim();
        if (!uid) return null;
        return { uid, email: `${uid}@example.com`, emailVerified: true, idToken: 'test-token' };
      },
      saveFile: store.saveFile,
      readFile: store.readFile,
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl, store);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function postMediaUpload(
  baseUrl: string,
  params: {
    uid?: string;
    kind: 'original' | 'motion';
    fileBuffer: Buffer;
    fileName: string;
    mimeType: string;
    mangaId?: string;
    chapterId?: string;
    alignment?: 'left' | 'center' | 'right';
    originalUrl?: string;
    targetWidth?: number;
    targetHeight?: number;
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append('kind', params.kind);
  form.append('mangaId', params.mangaId ?? 'manga-1');
  form.append('chapterId', params.chapterId ?? 'cap-1');
  if (params.alignment) form.append('alignment', params.alignment);
  if (params.originalUrl) form.append('originalUrl', params.originalUrl);
  if (params.targetWidth) form.append('targetWidth', String(params.targetWidth));
  if (params.targetHeight) form.append('targetHeight', String(params.targetHeight));
  form.append(
    'file',
    new Blob([new Uint8Array(params.fileBuffer)], { type: params.mimeType }),
    params.fileName
  );

  const res = await fetch(`${baseUrl}/api/media/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.uid ?? 'creator-1'}`,
    },
    body: form,
  });

  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

test('Motion upload validation, 20MB limit, 10s duration, 16:9 crop & alignments, flows, and GIF/WebP/APNG', async () => {
  const fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-fixtures-'));
  const beforeTempDirs = new Set(
    fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('manga-motion-'))
  );

  try {
    // Generate real fixtures with FFmpeg and ImageMagick
    const origVerticalPngPath = path.join(fixturesDir, 'orig_800x1200.png');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=800x1200', '-frames:v', '1', origVerticalPngPath],
      { stdio: 'pipe' }
    );
    const origVerticalPng = fs.readFileSync(origVerticalPngPath);

    const mp4_9s_path = path.join(fixturesDir, 'v9s.mp4');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=navy:s=480x720:r=10:d=9', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4_9s_path],
      { stdio: 'pipe' }
    );
    const mp4_9s = fs.readFileSync(mp4_9s_path);

    const mp4_10s_path = path.join(fixturesDir, 'v10s.mp4');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=teal:s=480x720:r=10:d=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4_10s_path],
      { stdio: 'pipe' }
    );
    const mp4_10s = fs.readFileSync(mp4_10s_path);

    const mp4_10_5s_path = path.join(fixturesDir, 'v10_5s.mp4');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=orange:s=480x720:r=10:d=10.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4_10_5s_path],
      { stdio: 'pipe' }
    );
    const mp4_10_5s = fs.readFileSync(mp4_10_5s_path);

    // 16:9 640x360 video with 3 distinct color bands: left=red, center=green, right=blue
    const mp4_16_9_tri_path = path.join(fixturesDir, 'tri_16_9.mp4');
    execFileSync(
      FFMPEG,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=#FF0000:s=214x360:r=10:d=3',
        '-f',
        'lavfi',
        '-i',
        'color=c=#00FF00:s=212x360:r=10:d=3',
        '-f',
        'lavfi',
        '-i',
        'color=c=#0000FF:s=214x360:r=10:d=3',
        '-filter_complex',
        '[0:v][1:v][2:v]hstack=inputs=3',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        mp4_16_9_tri_path,
      ],
      { stdio: 'pipe' }
    );
    const mp4_16_9_tri = fs.readFileSync(mp4_16_9_tri_path);

    // 16:9 WebM <= 10s
    const webm_16_9_path = path.join(fixturesDir, 'wide_16_9.webm');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=purple:s=640x360:r=10:d=3', '-c:v', 'libvpx', webm_16_9_path],
      { stdio: 'pipe' }
    );
    const webm_16_9 = fs.readFileSync(webm_16_9_path);

    // Animated GIF 3s (16:9 320x180) and >10s (11s) and static GIF
    const gif_3s_path = path.join(fixturesDir, 'anim3s.gif');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=5:d=3', gif_3s_path],
      { stdio: 'pipe' }
    );
    const gif_3s = fs.readFileSync(gif_3s_path);

    const gif_11s_path = path.join(fixturesDir, 'anim11s.gif');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=yellow:s=160x90:r=2:d=11', gif_11s_path],
      { stdio: 'pipe' }
    );
    const gif_11s = fs.readFileSync(gif_11s_path);

    const gif_static_path = path.join(fixturesDir, 'static.gif');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=cyan:s=320x180:d=0.1', '-frames:v', '1', gif_static_path],
      { stdio: 'pipe' }
    );
    const gif_static = fs.readFileSync(gif_static_path);

    // Animated WebP 2.5s (320x180) and 11s and static WebP
    const webpFrameA = path.join(fixturesDir, 'wf_a.png');
    const webpFrameB = path.join(fixturesDir, 'wf_b.png');
    execFileSync(CONVERT, ['-size', '320x180', 'xc:red', webpFrameA], { stdio: 'pipe' });
    execFileSync(CONVERT, ['-size', '320x180', 'xc:blue', webpFrameB], { stdio: 'pipe' });

    const webp_anim_2_5s_path = path.join(fixturesDir, 'anim25.webp');
    execFileSync(
      CONVERT,
      ['-delay', '50', webpFrameA, webpFrameB, webpFrameA, webpFrameB, webpFrameA, '-loop', '0', webp_anim_2_5s_path],
      { stdio: 'pipe' }
    );
    const webp_anim_2_5s = fs.readFileSync(webp_anim_2_5s_path);

    const webp_anim_11s_path = path.join(fixturesDir, 'anim11.webp');
    execFileSync(
      CONVERT,
      ['-delay', '550', webpFrameA, webpFrameB, '-loop', '0', webp_anim_11s_path],
      { stdio: 'pipe' }
    );
    const webp_anim_11s = fs.readFileSync(webp_anim_11s_path);

    const webp_static_path = path.join(fixturesDir, 'static.webp');
    execFileSync(CONVERT, [webpFrameA, webp_static_path], { stdio: 'pipe' });
    const webp_static = fs.readFileSync(webp_static_path);

    // Animated APNG 3s (320x180) and 11s
    const apng_3s_path = path.join(fixturesDir, 'anim3s.apng');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=5:d=3', '-f', 'apng', '-plays', '0', apng_3s_path],
      { stdio: 'pipe' }
    );
    const apng_3s = fs.readFileSync(apng_3s_path);

    const apng_11s_path = path.join(fixturesDir, 'anim11s.apng');
    execFileSync(
      FFMPEG,
      ['-y', '-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=2:d=11', '-f', 'apng', '-plays', '0', apng_11s_path],
      { stdio: 'pipe' }
    );
    const apng_11s = fs.readFileSync(apng_11s_path);

    // Exact 20 MB valid MP4 and 20 MB + 1 byte oversized MP4
    const mp4_exact_20mb = createMp4WithFreeAtom(mp4_9s, MOTION_MAX_BYTES);
    const mp4_over_20mb = createMp4WithFreeAtom(mp4_9s, MOTION_MAX_BYTES + 1);
    assert.equal(mp4_exact_20mb.length, MOTION_MAX_BYTES);
    assert.equal(mp4_over_20mb.length, MOTION_MAX_BYTES + 1);

    await withUploadTestServer(async (baseUrl, store) => {
      // Initial page upload: step 1 upload Original 800x1200
      const origRes = await postMediaUpload(baseUrl, {
        kind: 'original',
        fileBuffer: origVerticalPng,
        fileName: 'page1.png',
        mimeType: 'image/png',
      });
      assert.equal(origRes.status, 201);
      const origKey = String(origRes.body.key);
      const origUrl = String(origRes.body.url);
      const origBytesBefore = Buffer.from(store.files.get(origKey)!.buffer);

      // 1. 9s video -> accepted
      const res9s = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_9s,
        fileName: 'motion9s.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
      });
      assert.equal(res9s.status, 201);

      // 2. 10s video -> accepted
      const res10s = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_10s,
        fileName: 'motion10s.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
      });
      assert.equal(res10s.status, 201);

      // 3. >10s (10.5s) video -> rejected (and NOT saved in store)
      const countBeforeReject = store.files.size;
      const resOver10s = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_10_5s,
        fileName: 'motion10_5s.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
      });
      assert.equal(resOver10s.status, 400);
      assert.match(String(resOver10s.body.error), /10 segundos/i);
      assert.equal(store.files.size, countBeforeReject);

      // 4. Exact 20 MB valid file -> accepted
      const resExact20 = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_exact_20mb,
        fileName: 'exact20mb.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
      });
      assert.equal(resExact20.status, 201);

      // 5. > 20 MB (20 MB + 1 byte) -> rejected with 413 and not stored
      const countBefore20Over = store.files.size;
      const resOver20 = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_over_20mb,
        fileName: 'over20mb.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
      });
      assert.equal(resOver20.status, 413);
      assert.match(String(resOver20.body.error), /20 MB/i);
      assert.equal(store.files.size, countBefore20Over);

      // 6 & 7 & 8. 16:9 horizontal video on 800x1200 vertical page -> crop proportionally & test all 3 alignments (Initial, + Motion, Trocar Motion flows)
      // Initial / Center (default)
      const resCenter = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_16_9_tri,
        fileName: 'initial_16_9.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
        alignment: 'center',
      });
      assert.equal(resCenter.status, 201);
      assert.equal(resCenter.body.mimeType, 'video/mp4');
      const centerKey = String(resCenter.body.key);
      const centerProbe = ffprobeBuffer(store.files.get(centerKey)!.buffer, 'mp4');
      assert.equal(centerProbe.width, 240);
      assert.equal(centerProbe.height, 360);
      const centerRgb = extractCenterPixelRgb(store.files.get(centerKey)!.buffer);
      assert.ok(centerRgb.g > 180 && centerRgb.r < 60 && centerRgb.b < 60, `Expected green center crop, got ${JSON.stringify(centerRgb)}`);

      // + Motion flow / Left alignment
      const resLeft = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_16_9_tri,
        fileName: 'add_left_16_9.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
        alignment: 'left',
      });
      assert.equal(resLeft.status, 201);
      const leftKey = String(resLeft.body.key);
      const leftProbe = ffprobeBuffer(store.files.get(leftKey)!.buffer, 'mp4');
      assert.equal(leftProbe.width, 240);
      assert.equal(leftProbe.height, 360);
      const leftRgb = extractCenterPixelRgb(store.files.get(leftKey)!.buffer);
      assert.ok(leftRgb.r > 180 && leftRgb.g < 60 && leftRgb.b < 60, `Expected red left crop, got ${JSON.stringify(leftRgb)}`);

      // Trocar Motion flow / Right alignment
      const resRight = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: mp4_16_9_tri,
        fileName: 'replace_right_16_9.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
        alignment: 'right',
      });
      assert.equal(resRight.status, 201);
      const rightKey = String(resRight.body.key);
      assert.notEqual(rightKey, leftKey);
      const rightProbe = ffprobeBuffer(store.files.get(rightKey)!.buffer, 'mp4');
      assert.equal(rightProbe.width, 240);
      assert.equal(rightProbe.height, 360);
      const rightRgb = extractCenterPixelRgb(store.files.get(rightKey)!.buffer);
      assert.ok(rightRgb.b > 180 && rightRgb.r < 60 && rightRgb.g < 60, `Expected blue right crop, got ${JSON.stringify(rightRgb)}`);

      // WebM 16:9 cropped to optimized MP4
      const resWebmWide = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: webm_16_9,
        fileName: 'wide.webm',
        mimeType: 'video/webm',
        originalUrl: origUrl,
        alignment: 'center',
      });
      assert.equal(resWebmWide.status, 201);
      assert.equal(resWebmWide.body.mimeType, 'video/mp4');
      const webmOutProbe = ffprobeBuffer(store.files.get(String(resWebmWide.body.key))!.buffer, 'mp4');
      assert.equal(webmOutProbe.width, 240);
      assert.equal(webmOutProbe.height, 360);

      // 9a. Animated GIF <= 10s -> accepted, cropped to 120x180, animation preserved
      const resGifOk = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: gif_3s,
        fileName: 'anim3s.gif',
        mimeType: 'image/gif',
        originalUrl: origUrl,
        alignment: 'center',
      });
      assert.equal(resGifOk.status, 201);
      assert.equal(resGifOk.body.mimeType, 'image/gif');
      const gifInfo = inspectAnimatedImageBytes(store.files.get(String(resGifOk.body.key))!.buffer);
      assert.ok(gifInfo && gifInfo.isAnimated && gifInfo.frameCount > 1);
      assert.equal(gifInfo.width, 120);
      assert.equal(gifInfo.height, 180);

      // 9b. Animated GIF > 10s -> rejected
      const resGifOver = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: gif_11s,
        fileName: 'anim11s.gif',
        mimeType: 'image/gif',
        originalUrl: origUrl,
      });
      assert.equal(resGifOver.status, 400);
      assert.match(String(resGifOver.body.error), /10 segundos/i);

      // 9c. Static GIF -> accepted (no duration limit applied by mistake) & cropped proportionally
      const resGifStatic = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: gif_static,
        fileName: 'static.gif',
        mimeType: 'image/gif',
        originalUrl: origUrl,
      });
      assert.equal(resGifStatic.status, 201);
      const staticGifInfo = inspectAnimatedImageBytes(store.files.get(String(resGifStatic.body.key))!.buffer);
      assert.ok(staticGifInfo && !staticGifInfo.isAnimated);
      assert.equal(staticGifInfo.width, 120);
      assert.equal(staticGifInfo.height, 180);

      // 9d. Animated WebP <= 10s -> accepted, cropped to 120x180, animation & frames preserved
      const resWebpOk = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: webp_anim_2_5s,
        fileName: 'anim25.webp',
        mimeType: 'image/webp',
        originalUrl: origUrl,
        alignment: 'right',
      });
      assert.equal(resWebpOk.status, 201);
      assert.equal(resWebpOk.body.mimeType, 'image/webp');
      const webpInfo = inspectAnimatedImageBytes(store.files.get(String(resWebpOk.body.key))!.buffer);
      assert.ok(webpInfo && webpInfo.isAnimated && webpInfo.frameCount === 5);
      assert.equal(webpInfo.width, 120);
      assert.equal(webpInfo.height, 180);

      // 9e. Animated WebP > 10s -> rejected
      const resWebpOver = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: webp_anim_11s,
        fileName: 'anim11.webp',
        mimeType: 'image/webp',
        originalUrl: origUrl,
      });
      assert.equal(resWebpOver.status, 400);
      assert.match(String(resWebpOver.body.error), /10 segundos/i);

      // 9f. Static WebP -> accepted (no duration limit applied) & cropped
      const resWebpStatic = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: webp_static,
        fileName: 'static.webp',
        mimeType: 'image/webp',
        originalUrl: origUrl,
      });
      assert.equal(resWebpStatic.status, 201);
      const staticWebpInfo = inspectAnimatedImageBytes(store.files.get(String(resWebpStatic.body.key))!.buffer);
      assert.ok(staticWebpInfo && !staticWebpInfo.isAnimated);
      assert.equal(staticWebpInfo.width, 120);
      assert.equal(staticWebpInfo.height, 180);

      // 9g. Animated APNG <= 10s -> accepted (even if browser declares image/png!), cropped & animated
      const resApngOk = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: apng_3s,
        fileName: 'anim3s.apng',
        mimeType: 'image/png',
        originalUrl: origUrl,
        alignment: 'left',
      });
      assert.equal(resApngOk.status, 201);
      assert.equal(resApngOk.body.mimeType, 'image/apng');
      const apngInfo = inspectAnimatedImageBytes(store.files.get(String(resApngOk.body.key))!.buffer);
      assert.ok(apngInfo && apngInfo.isAnimated && apngInfo.frameCount > 1);
      assert.equal(apngInfo.width, 120);
      assert.equal(apngInfo.height, 180);

      // 9h. Animated APNG > 10s -> rejected
      const resApngOver = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: apng_11s,
        fileName: 'anim11s.apng',
        mimeType: 'image/apng',
        originalUrl: origUrl,
      });
      assert.equal(resApngOver.status, 400);
      assert.match(String(resApngOver.body.error), /10 segundos/i);

      // Security: disguised static PNG labeled as video/mp4 must be rejected by signature check
      const resSpoofedPng = await postMediaUpload(baseUrl, {
        kind: 'motion',
        fileBuffer: origVerticalPng,
        fileName: 'spoof.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
      });
      assert.equal(resSpoofedPng.status, 400);

      // Security: cannot link originalUrl belonging to another user
      const resCrossOwner = await postMediaUpload(baseUrl, {
        uid: 'attacker-2',
        kind: 'motion',
        fileBuffer: mp4_9s,
        fileName: 'steal.mp4',
        mimeType: 'video/mp4',
        originalUrl: origUrl,
      });
      assert.equal(resCrossOwner.status, 403);

      // Integrity: original page PNG stored on server was NEVER modified or compressed
      const origBytesAfter = store.files.get(origKey)!.buffer;
      assert.equal(Buffer.compare(origBytesBefore, origBytesAfter), 0);
    });

    // Ensure no orphaned temp dirs remain from our processor
    const afterTempDirs = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith('manga-motion-') && !beforeTempDirs.has(n));
    assert.deepEqual(afterTempDirs, []);

    // Pure math check for computeProportionalCropRect default center alignment
    const rect = computeProportionalCropRect({
      mediaWidth: 1920,
      mediaHeight: 1080,
      targetWidth: 800,
      targetHeight: 1200,
      requireEvenDimensions: true,
    });
    assert.equal(rect.needsCrop, true);
    assert.equal(rect.cropWidth, 720);
    assert.equal(rect.cropHeight, 1080);
    assert.equal(rect.cropX, 600);
  } finally {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  }
});
