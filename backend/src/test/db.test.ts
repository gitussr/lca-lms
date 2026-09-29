import assert from 'node:assert/strict';
import test from 'node:test';

import { isServerReachable } from './db.js';

// Port 1 on loopback: nothing listens there, so the connection is refused fast.
const UNREACHABLE = 'postgresql://ci:ci-secret@127.0.0.1:1/postgres';

test('isServerReachable returns false for an unreachable server by default', async () => {
  assert.equal(await isServerReachable(UNREACHABLE, {}), false);
});

test('isServerReachable throws when REQUIRE_TEST_DATABASE=true', async () => {
  await assert.rejects(
    isServerReachable(UNREACHABLE, { REQUIRE_TEST_DATABASE: 'true' }),
    (err: Error) => {
      assert.match(err.message, /REQUIRE_TEST_DATABASE=true but no Postgres is reachable/);
      assert.doesNotMatch(err.message, /ci-secret/, 'credentials are redacted');
      return true;
    },
  );
});
