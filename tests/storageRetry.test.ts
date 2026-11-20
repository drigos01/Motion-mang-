import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyS3ObjectAfterPut } from '../server/storage.ts';

function makeS3NotFoundError(): Error & { $metadata: { httpStatusCode: number } } {
  const err = new Error('UnknownError') as Error & { $metadata: { httpStatusCode: number } };
  err.name = 'NotFound';
  err.$metadata = { httpStatusCode: 404 };
  return err;
}

test('verifyS3ObjectAfterPut retries transient NotFound: UnknownError and succeeds once persisted', async () => {
  let calls = 0;
  await verifyS3ObjectAfterPut({
    key: 'users/u1/avatar/test.webp',
    expectedSize: 2048,
    retryDelaysMs: [5, 5, 5],
    sendHead: async () => {
      calls++;
      if (calls < 3) {
        throw makeS3NotFoundError();
      }
      return { ContentLength: 2048 };
    },
  });
  assert.equal(calls, 3);
});

test('verifyS3ObjectAfterPut does not fail upload if PutObject succeeded and HeadObject still returns NotFound', async () => {
  let calls = 0;
  await verifyS3ObjectAfterPut({
    key: 'users/u1/avatar/test.webp',
    expectedSize: 1024,
    retryDelaysMs: [5, 5],
    sendHead: async () => {
      calls++;
      throw makeS3NotFoundError();
    },
  });
  assert.equal(calls, 3);
});

test('verifyS3ObjectAfterPut rejects mismatched ContentLength and non-404 errors', async () => {
  await assert.rejects(
    () =>
      verifyS3ObjectAfterPut({
        key: 'users/u1/avatar/corrupt.webp',
        expectedSize: 2048,
        retryDelaysMs: [5],
        sendHead: async () => ({ ContentLength: 512 }),
      }),
    /Falha na verificação do arquivo/
  );

  let non404Calls = 0;
  await assert.rejects(
    () =>
      verifyS3ObjectAfterPut({
        key: 'users/u1/avatar/forbidden.webp',
        expectedSize: 2048,
        retryDelaysMs: [5, 5],
        sendHead: async () => {
          non404Calls++;
          const err = new Error('AccessDenied');
          err.name = 'AccessDenied';
          throw err;
        },
      }),
    /AccessDenied/
  );
  assert.equal(non404Calls, 1);
});
