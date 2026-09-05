import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.js';
import { loggerOptions } from './shared/logger.js';

/**
 * F-005: structured request logging + redaction, exercised through the real
 * app (error handler, Fastify's default `err` serializer, our onResponse
 * hook, and the logger's redaction) rather than in isolation — this is what
 * actually ends up on stdout in production.
 */
function captureLogs(): {
  stream: { write(msg: string): void };
  lines: () => Record<string, unknown>[];
} {
  const raw: string[] = [];
  return {
    stream: {
      write(msg: string) {
        raw.push(msg);
      },
    },
    lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

test('logs one structured line per request with method/path/status/duration/reqId/userId', async (t) => {
  const { stream, lines } = captureLogs();
  const app = await buildApp({ logger: { ...loggerOptions, stream } });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/api/v1/health?token=should-be-stripped' });
  assert.equal(res.statusCode, 200);

  const requestLog = lines().find((line) => line.msg === 'request completed');
  assert.ok(requestLog, 'expected a "request completed" log line');
  assert.equal(requestLog?.method, 'GET');
  assert.equal(requestLog?.path, '/api/v1/health');
  assert.equal(requestLog?.statusCode, 200);
  assert.equal(typeof requestLog?.durationMs, 'number');
  assert.equal(typeof requestLog?.reqId, 'string');
  assert.equal(requestLog?.userId, null);
});

test('unhandled 500 errors are logged with a stack trace server-side', async (t) => {
  const { stream, lines } = captureLogs();
  const app = await buildApp({ logger: { ...loggerOptions, stream } });
  app.get('/__boom', () => {
    throw new Error('kaboom');
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/__boom' });
  assert.equal(res.statusCode, 500);
  const responseBody = res.json() as { error: { message: string } };
  assert.equal(responseBody.error.message, 'Internal server error');
  assert.doesNotMatch(
    res.body,
    /kaboom/,
    'the client response must not include internal error detail',
  );

  const errorLog = lines().find((line) => line.msg === 'unhandled error');
  assert.ok(errorLog, 'expected an "unhandled error" log line');
  const err = errorLog?.err as { stack?: string } | undefined;
  assert.ok(err?.stack?.includes('kaboom'), 'expected the stack trace in the server-side log');
});

test('a handler that logs the raw request body never leaks a password in plain text', async (t) => {
  const { stream, lines } = captureLogs();
  const app = await buildApp({ logger: { ...loggerOptions, stream } });
  // Stands in for a future login/register handler (F-102/F-103) logging a
  // failed attempt for debugging — exactly the case redaction has to cover.
  app.post('/__login', (request) => {
    request.log.info({ body: request.body }, 'login failed');
    return { ok: false };
  });
  t.after(() => app.close());

  const secretPassword = 'sup3r-secret-pw';
  await app.inject({
    method: 'POST',
    url: '/__login',
    payload: { email: 'student@example.com', password: secretPassword },
  });

  const rawOutput = JSON.stringify(lines());
  assert.doesNotMatch(rawOutput, new RegExp(secretPassword));

  const loginLog = lines().find((line) => line.msg === 'login failed');
  assert.ok(loginLog);
  const body = loginLog?.body as Record<string, unknown>;
  assert.equal(body.password, '[REDACTED]');
  assert.equal(body.email, 'student@example.com');
});

test('a validation error does not log the submitted password', async (t) => {
  const { stream, lines } = captureLogs();
  const app = await buildApp({ logger: { ...loggerOptions, stream } });
  app.post(
    '/__register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string', minLength: 8 },
          },
        },
      },
    },
    () => ({ ok: true }),
  );
  t.after(() => app.close());

  const tooShortPassword = 'short1';
  const res = await app.inject({
    method: 'POST',
    url: '/__register',
    payload: { email: 'student@example.com', password: tooShortPassword },
  });
  assert.equal(res.statusCode, 400);

  const rawOutput = JSON.stringify(lines());
  assert.doesNotMatch(rawOutput, new RegExp(tooShortPassword));
});
