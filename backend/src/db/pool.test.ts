import assert from 'node:assert/strict';
import test from 'node:test';

import { closePool, getPool } from './pool.js';

/**
 * `pg.Pool` doesn't connect until the first query, so the singleton lifecycle
 * is testable without a real database.
 */

test('getPool returns the same instance until closePool is called', async () => {
  const first = getPool();
  const second = getPool();
  assert.equal(first, second);

  await closePool();

  const third = getPool();
  assert.notEqual(third, first);

  await closePool();
});
