# backend/src/test/

Shared test harness (F-006): one runner for unit + integration tests, a
disposable-database-per-file helper, and a fake-authenticated-user helper for
role-gated routes. No domain schema exists yet (`users`/`courses`/
`enrollments` land with F-101/F-2xx/F-3xx), so the parts of this harness that
would seed real domain fixtures are deferred — see "What's deferred" below.

## Running tests

```bash
npm test              # unit + integration, from backend/
npm run test:coverage # same, with a coverage report (no gate — see below)
```

`src/test/setup.ts` runs first (via `node --import`) and forces
`NODE_ENV=test`. Every `*.test.ts` under `src/` runs in one pass — unit tests
alongside integration tests. Integration tests self-skip (not fail) when no
Postgres server is reachable, so `npm test` stays green on a machine without
one running; F-008 automates a local one via Docker Compose.

## Database harness (`db.ts`)

```ts
import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from '../test/db.js';

const reachable = await isServerReachable();
test('...', { skip: reachable ? false : `no Postgres reachable at ${redactUrl(maintenanceUrl())}` }, async (t) => {
  const db = await createTestDatabase(); // uniquely named, already migrated up
  t.after(() => db.drop()); // closes the pool, drops the database

  // ...use db.pool for queries...
  await db.reset(); // truncates every application table between tests (fast — no re-migrate)
});
```

One disposable database per test *file* (not per `test()` — creating and
migrating a database is comparatively slow), reset with `.reset()` between
individual tests within a file. See `db/pool.integration.test.ts` and
`test/db.integration.test.ts` for complete examples — the latter proves
`.reset()` actually truncates data, using a throwaway table it creates itself
(there are no real application tables to exercise it against yet).

## Fake-authenticated-user helper (`auth.ts`)

```ts
import { actAs, fakeAuthenticatedUser } from '../test/auth.js';

const app = await buildApp();
actAs(app, fakeAuthenticatedUser('teacher')); // or actAs(app, null) for "unauthenticated"
const res = await app.inject({ method: 'GET', url: '/api/v1/teacher/...' });
```

There's no session store or `users` table yet (F-105/F-101), so this doesn't
authenticate against real data — it sets `request.user` directly, the same
field F-105's session middleware will populate from a real session lookup.
That's enough to test role-gated routes (F-106+) today; nothing here needs to
change once F-105 lands, since only the *production* path (real session →
real user) gets built then. `fakeAuthenticatedUser()` ids are obviously fake
(`00000000-0000-4000-a000-…`), never real identifiers.

## What's deferred

The backlog's acceptance criteria for F-006 also call for helpers that "seed
a user/course/enrollment." Those tables don't exist yet — the day-by-day
build sequence puts F-006 before Phase B (Identity & Access, M1) starts at
F-101. Building seed helpers against a schema that doesn't exist would be
speculative code with nothing to verify it against, so this is intentionally
left for the features that introduce each table: a `seedUser()` helper
alongside F-101, `seedCourse()` alongside the course model, `seedEnrollment()`
alongside the enrollment model — each colocated with the schema it seeds, the
same way `db.ts` and `auth.ts` live next to what they support.

## Coverage

`npm run test:coverage` uses Node's built-in `--experimental-test-coverage`
(test files themselves excluded from the report). No hard gate yet, per the
F-006 acceptance criteria — target is **70% line coverage** for `src/shared/*`
and `src/db/*` (the parts with real logic to break); route-plugin stubs and
generated coverage of test-only helper files aren't held to that bar. Revisit
once F-009 wires this into CI.
