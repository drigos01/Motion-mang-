import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createApiApp } from '../server/app.ts';
import {
  formatStartupConfigSummary,
  getAppConfig,
  getSafeConfigReport,
  loadFirebaseAppletConfig,
} from '../server/config.ts';
import { deleteMediaFile, normalizeMediaKey, saveMediaFile, StorageConfigError } from '../server/storage.ts';

// Minimal valid 1x1 PNG buffer
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

test('loadFirebaseAppletConfig loads project config with named Firestore DB', () => {
  const fb = loadFirebaseAppletConfig();
  assert.equal(fb.projectId, 'pristine-byway-nb3p0');
  assert.equal(fb.firestoreDatabaseId, 'ai-studio-a5fd0140-23f5-4895-88f8-31f9491f7fb3');
  assert.ok(fb.apiKey && fb.apiKey.length > 10);
});

test('getAppConfig accepts valid Bunny S3 configuration without S3_PUBLIC_URL (Pull Zone optional)', () => {
  const cfg = getAppConfig({
    NODE_ENV: 'production',
    VERCEL: '1',
    VERCEL_ENV: 'production',
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'https://br-s3.storage.bunnycdn.com/',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'manga-motion-zone',
    S3_ACCESS_KEY_ID: 'manga-motion-zone',
    S3_SECRET_ACCESS_KEY: 'super-secret-bunny-password',
    S3_PUBLIC_URL: '',
  });

  assert.equal(cfg.ok, true);
  assert.equal(cfg.runtime.platform, 'vercel');
  assert.equal(cfg.storage.driver, 's3');
  assert.equal(cfg.storage.configured, true);
  assert.equal(cfg.storage.endpoint, 'https://br-s3.storage.bunnycdn.com');
  assert.equal(cfg.storage.endpointHost, 'br-s3.storage.bunnycdn.com');
  assert.equal(cfg.storage.publicUrlConfigured, false);
  assert.equal(cfg.storage.proxyMode, true);
  assert.deepEqual(cfg.storage.errors, []);
});

test('getAppConfig rejects incomplete S3 config and native non-S3 Bunny endpoint', () => {
  const missingCreds = getAppConfig({
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'https://de-s3.storage.bunnycdn.com',
  });
  assert.equal(missingCreds.ok, false);
  assert.equal(missingCreds.storage.configured, false);
  assert.deepEqual(missingCreds.storage.missingVars, [
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]);

  const nativeEndpoint = getAppConfig({
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'https://storage.bunnycdn.com',
    S3_BUCKET: 'zone',
    S3_ACCESS_KEY_ID: 'zone',
    S3_SECRET_ACCESS_KEY: 'pass',
  });
  assert.equal(nativeEndpoint.ok, false);
  assert.ok(nativeEndpoint.storage.errors.some((e) => e.includes('-s3.storage.bunnycdn.com')));
});

test('getAppConfig flags Vercel deployment with local storage driver', () => {
  const vercelLocal = getAppConfig({
    VERCEL: '1',
    VERCEL_ENV: 'production',
    STORAGE_DRIVER: 'local',
  });
  assert.equal(vercelLocal.ok, false);
  assert.equal(vercelLocal.storage.configured, false);
  assert.ok(vercelLocal.storage.errors.some((e) => e.includes('STORAGE_DRIVER=s3')));
});

test('Safe config diagnostics NEVER expose secret keys or passwords', () => {
  const secretAccess = 'ACCESS_KEY_SENSITIVE_12345';
  const secretPass = 'BUNNY_PASSWORD_SENSITIVE_98765';
  const secretGemini = 'AIza_FAKE_GEMINI_SECRET_55555';

  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'https://ny-s3.storage.bunnycdn.com',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'manga-zone',
    S3_ACCESS_KEY_ID: secretAccess,
    S3_SECRET_ACCESS_KEY: secretPass,
    GEMINI_API_KEY: secretGemini,
  };

  const report = getSafeConfigReport(env);
  const summary = formatStartupConfigSummary(report);
  const serialized = JSON.stringify(report);

  for (const secret of [secretAccess, secretPass, secretGemini]) {
    assert.equal(serialized.includes(secret), false);
    assert.equal(summary.includes(secret), false);
  }
  assert.equal(report.gemini.configured, true);
  assert.equal(report.storage.accessKeyConfigured, true);
  assert.equal(report.storage.secretKeyConfigured, true);
});

test('saveMediaFile fails explicitly with StorageConfigError when STORAGE_DRIVER=s3 is incomplete', async () => {
  const prevDriver = process.env.STORAGE_DRIVER;
  const prevBucket = process.env.S3_BUCKET;
  const prevKey = process.env.S3_ACCESS_KEY_ID;
  const prevSecret = process.env.S3_SECRET_ACCESS_KEY;

  process.env.STORAGE_DRIVER = 's3';
  process.env.S3_BUCKET = 'only-bucket';
  delete process.env.S3_ACCESS_KEY_ID;
  delete process.env.S3_SECRET_ACCESS_KEY;

  try {
    await assert.rejects(
      () =>
        saveMediaFile({
          buffer: TINY_PNG,
          originalName: 'test.png',
          mimeType: 'image/png',
          folder: 'users/test-misconfig/misc',
        }),
      (err: unknown) => err instanceof StorageConfigError && /S3_ACCESS_KEY_ID/.test(err.message)
    );
  } finally {
    if (prevDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = prevDriver;
    if (prevBucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = prevBucket;
    if (prevKey === undefined) delete process.env.S3_ACCESS_KEY_ID;
    else process.env.S3_ACCESS_KEY_ID = prevKey;
    if (prevSecret === undefined) delete process.env.S3_SECRET_ACCESS_KEY;
    else process.env.S3_SECRET_ACCESS_KEY = prevSecret;
  }
});

test('Express API routes: health, status secret-safety, upload, HEAD, GET, Range 206, traversal guard, delete', async () => {
  const testUid = 'test-audit-user';
  const app = createApiApp({
    verifyToken: async (authHeader) => {
      if (authHeader === 'Bearer valid-token') {
        return {
          uid: testUid,
          email: 'creator@example.com',
          emailVerified: true,
          idToken: 'valid-token',
        };
      }
      if (authHeader === 'Bearer other-token') {
        return {
          uid: 'other-user',
          email: 'other@example.com',
          emailVerified: true,
          idToken: 'other-token',
        };
      }
      return null;
    },
    checkAdmin: async () => false,
    uploadDeps: {
      verifyToken: async (authHeader) => {
        if (authHeader === 'Bearer valid-token') {
          return {
            uid: testUid,
            email: 'creator@example.com',
            emailVerified: true,
            idToken: 'valid-token',
          };
        }
        return null;
      },
    },
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  let uploadedKey = '';

  try {
    // 1. /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = (await healthRes.json()) as Record<string, unknown>;
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.firebaseConfigured, true);

    // 2. /api/storage/status
    const statusRes = await fetch(`${baseUrl}/api/storage/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as Record<string, unknown>;
    assert.equal(statusJson.proxyMode, true);
    assert.equal(statusJson.firebaseProjectId, 'pristine-byway-nb3p0');

    // 3. Unauthenticated upload rejected (401)
    const unauthForm = new FormData();
    unauthForm.append('kind', 'cover');
    unauthForm.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'cover.png');
    const unauthUpload = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      body: unauthForm,
    });
    assert.equal(unauthUpload.status, 401);

    // 4. Authenticated upload succeeds and returns proxy URL
    const form = new FormData();
    form.append('kind', 'cover');
    form.append('mangaId', 'manga-audit');
    form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'cover.png');
    const uploadRes = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-token' },
      body: form,
    });
    assert.equal(uploadRes.status, 201);
    const uploadJson = (await uploadRes.json()) as { key: string; url: string; size: number };
    assert.ok(uploadJson.url.startsWith('/api/media/file/'));
    assert.equal(uploadJson.size, TINY_PNG.length);
    uploadedKey = uploadJson.key;

    // 5. HEAD metadata check
    const headRes = await fetch(`${baseUrl}${uploadJson.url}`, { method: 'HEAD' });
    assert.equal(headRes.status, 200);
    assert.equal(headRes.headers.get('accept-ranges'), 'bytes');
    assert.equal(headRes.headers.get('content-type'), 'image/png');
    assert.equal(headRes.headers.get('content-length'), String(TINY_PNG.length));

    // 6. GET full file bytes
    const getRes = await fetch(`${baseUrl}${uploadJson.url}`);
    assert.equal(getRes.status, 200);
    const downloaded = Buffer.from(await getRes.arrayBuffer());
    assert.equal(Buffer.compare(downloaded, TINY_PNG), 0);

    // 7. GET partial range (HTTP 206)
    const rangeRes = await fetch(`${baseUrl}${uploadJson.url}`, {
      headers: { Range: 'bytes=0-7' },
    });
    assert.equal(rangeRes.status, 206);
    assert.equal(rangeRes.headers.get('content-range'), `bytes 0-7/${TINY_PNG.length}`);
    const rangeBytes = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(Buffer.compare(rangeBytes, TINY_PNG.subarray(0, 8)), 0);

    // 8. Missing file & traversal blocked
    const notFoundRes = await fetch(`${baseUrl}/api/media/file/users/nobody/missing.png`);
    assert.equal(notFoundRes.status, 404);
    const traversalRes = await fetch(`${baseUrl}/api/media/file/..%2F..%2Fpackage.json`);
    assert.equal(traversalRes.status, 404);

    // 9. Delete by non-owner forbidden (403)
    const nonOwnerDelete = await fetch(`${baseUrl}/api/media/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer other-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: uploadedKey }),
    });
    assert.equal(nonOwnerDelete.status, 403);

    // 10. Delete by owner succeeds (200) and file disappears (404)
    const ownerDelete = await fetch(`${baseUrl}/api/media/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: uploadJson.url }),
    });
    assert.equal(ownerDelete.status, 200);
    uploadedKey = '';

    const afterDeleteRes = await fetch(`${baseUrl}${uploadJson.url}`);
    assert.equal(afterDeleteRes.status, 404);
  } finally {
    if (uploadedKey) {
      const leftover = path.resolve(process.cwd(), 'storage', 'media', uploadedKey);
      if (fs.existsSync(leftover)) {
        fs.unlinkSync(leftover);
      }
    }
    const testUserDir = path.resolve(process.cwd(), 'storage', 'media', 'users', testUid);
    if (fs.existsSync(testUserDir)) {
      fs.rmSync(testUserDir, { recursive: true, force: true });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('normalizeMediaKey handles full proxy URLs with query strings and blocks external URLs', () => {
  assert.equal(
    normalizeMediaKey('https://motionmang.vercel.app/api/media/file/users/u1/avatar/photo.webp?v=123#top'),
    'users/u1/avatar/photo.webp'
  );
  assert.equal(
    normalizeMediaKey('/api/media/file/users/u1/mangas/m1/brand/cover.png'),
    'users/u1/mangas/m1/brand/cover.png'
  );
  assert.equal(normalizeMediaKey('https://evil.example.com/file.png'), null);
  assert.equal(normalizeMediaKey('/api/media/file/../../etc/passwd'), null);
});

test('Admin can delete user-owned media and /api/media/delete-batch deletes multiple files', async () => {
  const creatorUid = 'batch-creator-user';
  const adminUid = 'batch-admin-user';
  const app = createApiApp({
    verifyToken: async (authHeader) => {
      if (authHeader === 'Bearer creator-token') {
        return {
          uid: creatorUid,
          email: 'creator@example.com',
          emailVerified: true,
          idToken: 'creator-token',
        };
      }
      if (authHeader === 'Bearer admin-token') {
        return {
          uid: adminUid,
          email: 'admin@example.com',
          emailVerified: true,
          idToken: 'admin-token',
        };
      }
      if (authHeader === 'Bearer other-token') {
        return {
          uid: 'stranger-user',
          email: 'stranger@example.com',
          emailVerified: true,
          idToken: 'other-token',
        };
      }
      return null;
    },
    checkAdmin: async (uid) => uid === adminUid,
    uploadDeps: {
      verifyToken: async (authHeader) => {
        if (authHeader === 'Bearer creator-token') {
          return {
            uid: creatorUid,
            email: 'creator@example.com',
            emailVerified: true,
            idToken: 'creator-token',
          };
        }
        return null;
      },
    },
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const uploadedUrls: string[] = [];

  try {
    for (let i = 0; i < 3; i++) {
      const form = new FormData();
      form.append('kind', 'original');
      form.append('mangaId', 'manga-batch');
      form.append('chapterId', 'chap-1');
      form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), `page-${i + 1}.png`);
      const uploadRes = await fetch(`${baseUrl}/api/media/upload`, {
        method: 'POST',
        headers: { Authorization: 'Bearer creator-token' },
        body: form,
      });
      assert.equal(uploadRes.status, 201);
      const data = (await uploadRes.json()) as { url: string };
      uploadedUrls.push(data.url);
    }

    // Non-owner non-admin cannot batch delete
    const strangerBatch = await fetch(`${baseUrl}/api/media/delete-batch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer other-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keys: uploadedUrls }),
    });
    assert.equal(strangerBatch.status, 403);

    // Admin can delete a creator's single file (e.g. during admin obra/conta removal)
    const adminSingle = await fetch(`${baseUrl}/api/media/delete`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer admin-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: `https://motionmang.vercel.app${uploadedUrls[0]}` }),
    });
    assert.equal(adminSingle.status, 200);
    assert.equal((await fetch(`${baseUrl}${uploadedUrls[0]}`)).status, 404);

    // Creator can batch-delete remaining files in one call
    const creatorBatch = await fetch(`${baseUrl}/api/media/delete-batch`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer creator-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ keys: uploadedUrls.slice(1) }),
    });
    assert.equal(creatorBatch.status, 200);
    const batchJson = (await creatorBatch.json()) as { deleted: string[]; failed: unknown[] };
    assert.equal(batchJson.deleted.length, 2);
    assert.equal(batchJson.failed.length, 0);

    for (const url of uploadedUrls) {
      assert.equal((await fetch(`${baseUrl}${url}`)).status, 404);
    }
  } finally {
    for (const url of uploadedUrls) {
      await deleteMediaFile(url).catch(() => {});
    }
    const testUserDir = path.resolve(process.cwd(), 'storage', 'media', 'users', creatorUid);
    if (fs.existsSync(testUserDir)) {
      fs.rmSync(testUserDir, { recursive: true, force: true });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
