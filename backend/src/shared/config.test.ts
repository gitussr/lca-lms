import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDatabaseUrl } from './config.js';

test('parseDatabaseUrl falls back to a local dev database when unset', () => {
  assert.equal(
    parseDatabaseUrl(undefined, 'development'),
    'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_dev',
  );
});

test('parseDatabaseUrl falls back to a local test database when unset', () => {
  assert.equal(
    parseDatabaseUrl(undefined, 'test'),
    'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_test',
  );
});

test('parseDatabaseUrl requires an explicit value in production', () => {
  assert.throws(() => parseDatabaseUrl(undefined, 'production'), /required in production/);
  assert.throws(() => parseDatabaseUrl('  ', 'production'), /required in production/);
});

test('parseDatabaseUrl accepts a well-formed postgres URL', () => {
  const url = 'postgresql://user:pass@db.example.com:5432/lca_lms?sslmode=require';
  assert.equal(parseDatabaseUrl(url, 'production'), url);
});

test('parseDatabaseUrl accepts the postgres: scheme alias', () => {
  const url = 'postgres://user:pass@localhost:5432/lca_lms';
  assert.equal(parseDatabaseUrl(url, 'development'), url);
});

test('parseDatabaseUrl rejects a non-URL value', () => {
  assert.throws(() => parseDatabaseUrl('not-a-url', 'development'), /Invalid DATABASE_URL/);
});

test('parseDatabaseUrl rejects an unsupported protocol', () => {
  assert.throws(
    () => parseDatabaseUrl('mysql://user:pass@localhost:3306/db', 'development'),
    /unsupported protocol/,
  );
});
