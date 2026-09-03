/**
 * Test bootstrap — loaded via `node --import` before any test file.
 * Forces the test environment so `buildApp()` starts with the logger disabled.
 * F-006 extends this with database reset and shared request/auth helpers.
 */
process.env.NODE_ENV = 'test';
