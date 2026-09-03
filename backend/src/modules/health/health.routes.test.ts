import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../../app.js';

test('GET /api/v1/health returns ok with service metadata', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/health' });

  assert.equal(res.statusCode, 200);
  const responseBody = res.json() as Record<string, unknown>;
  assert.equal(responseBody.status, 'ok');
  assert.equal(responseBody.service, 'lca-lms-api');
  assert.equal(typeof responseBody.version, 'string');
  assert.equal(typeof responseBody.uptimeSeconds, 'number');
  assert.equal(typeof res.headers['x-request-id'], 'string');
});

test('unknown route returns 404 in the standard error shape', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

  assert.equal(res.statusCode, 404);
  const responseBody = res.json() as {
    error: { code: string; message: string };
    requestId: string;
  };
  assert.equal(responseBody.error.code, 'NOT_FOUND');
  assert.equal(typeof responseBody.error.message, 'string');
  assert.ok(responseBody.requestId.length > 0);
});

test('incoming x-request-id header is used as the correlation id', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/health',
    headers: { 'x-request-id': 'test-correlation-id' },
  });

  assert.equal(res.headers['x-request-id'], 'test-correlation-id');
});
