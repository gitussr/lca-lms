import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConfig, ConfigError } from './config.js';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

test('defaults to the development profile with local placeholder values', () => {
  const config = buildConfig(env());
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.isDevelopment, true);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 3000);
  assert.equal(config.logLevel, 'info');
  assert.deepEqual(config.corsOrigin, ['http://localhost:5173']);
  assert.equal(config.databaseUrl, 'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_dev');
});

test('test profile defaults to a separate local placeholder database', () => {
  const config = buildConfig(env({ NODE_ENV: 'test' }));
  assert.equal(config.isTest, true);
  assert.equal(config.databaseUrl, 'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_test');
});

test('rejects an unknown NODE_ENV', () => {
  assert.throws(() => buildConfig(env({ NODE_ENV: 'qa' })), ConfigError);
});

test('coerces and validates PORT', () => {
  assert.equal(buildConfig(env({ PORT: '8080' })).port, 8080);
  assert.throws(() => buildConfig(env({ PORT: 'not-a-number' })), ConfigError);
  assert.throws(() => buildConfig(env({ PORT: '0' })), ConfigError);
  assert.throws(() => buildConfig(env({ PORT: '70000' })), ConfigError);
});

test('rejects an unknown LOG_LEVEL', () => {
  assert.throws(() => buildConfig(env({ LOG_LEVEL: 'verbose' })), ConfigError);
});

test('splits and trims CORS_ORIGIN into a list', () => {
  const config = buildConfig(env({ CORS_ORIGIN: 'https://a.example, https://b.example ,' }));
  assert.deepEqual(config.corsOrigin, ['https://a.example', 'https://b.example']);
});

for (const nodeEnv of ['staging', 'production']) {
  test(`${nodeEnv} requires an explicit DATABASE_URL`, () => {
    assert.throws(
      () => buildConfig(env({ NODE_ENV: nodeEnv, CORS_ORIGIN: 'https://app.example' })),
      /DATABASE_URL: required in/,
    );
  });

  test(`${nodeEnv} rejects the local development placeholder DATABASE_URL`, () => {
    assert.throws(
      () =>
        buildConfig(
          env({
            NODE_ENV: nodeEnv,
            CORS_ORIGIN: 'https://app.example',
            DATABASE_URL: 'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_dev',
          }),
        ),
      /local development placeholder/,
    );
  });

  test(`${nodeEnv} requires an explicit CORS_ORIGIN`, () => {
    assert.throws(
      () =>
        buildConfig(
          env({
            NODE_ENV: nodeEnv,
            DATABASE_URL: 'postgresql://real:pass@db.example.com:5432/lca_lms',
          }),
        ),
      /CORS_ORIGIN: required in/,
    );
  });

  test(`${nodeEnv} accepts a fully-specified config`, () => {
    const config = buildConfig(
      env({
        NODE_ENV: nodeEnv,
        DATABASE_URL: 'postgresql://real:pass@db.example.com:5432/lca_lms',
        CORS_ORIGIN: 'https://app.example',
      }),
    );
    assert.equal(config.databaseUrl, 'postgresql://real:pass@db.example.com:5432/lca_lms');
    assert.deepEqual(config.corsOrigin, ['https://app.example']);
  });
}

test('rejects a malformed DATABASE_URL', () => {
  assert.throws(
    () => buildConfig(env({ DATABASE_URL: 'not-a-url' })),
    /DATABASE_URL: not a valid URL/,
  );
});

test('rejects a DATABASE_URL with an unsupported protocol', () => {
  assert.throws(
    () => buildConfig(env({ DATABASE_URL: 'mysql://user:pass@localhost:3306/db' })),
    /unsupported protocol/,
  );
});

test('accepts the postgres: scheme alias', () => {
  const url = 'postgres://user:pass@localhost:5432/lca_lms';
  assert.equal(buildConfig(env({ DATABASE_URL: url })).databaseUrl, url);
});

test('ConfigError aggregates every problem, not just the first', () => {
  try {
    buildConfig(env({ NODE_ENV: 'production' }));
    assert.fail('expected buildConfig to throw');
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /DATABASE_URL: required in production/);
    assert.match(err.message, /CORS_ORIGIN: required in production/);
  }
});

test('ConfigError never includes the raw value of an invalid variable', () => {
  // Wrong protocol (mysql, not postgres) — must fail, and the credentials in
  // the URL must never appear in the resulting error message.
  const url = 'mysql://admin:sup3r-secret-pw@prod-db.internal:3306/lca_lms_bad';
  try {
    buildConfig(env({ DATABASE_URL: url }));
    assert.fail('expected buildConfig to throw');
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.doesNotMatch(err.message, /sup3r-secret-pw/);
  }
});
