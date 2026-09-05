/**
 * Test bootstrap — loaded via `node --import` before any test file.
 * Forces the test environment so `buildApp()` starts with the logger disabled.
 *
 * F-006 adds the rest of the shared test harness alongside this file:
 * `db.ts` (disposable-database + reset helpers) and `auth.ts` (fake
 * authenticated-user / `actAs()` helper for role-gated route tests).
 */
process.env.NODE_ENV = 'test';
