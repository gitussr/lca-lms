import { createRequire } from 'node:module';

/**
 * Reads the backend package version at runtime.
 *
 * Resolved relative to this file (`src/shared/` in dev via tsx, `dist/shared/`
 * after build) — `../../package.json` is `backend/package.json` in both cases.
 * Done with `createRequire` so it does not need to sit under `rootDir`.
 */
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export const APP_NAME = 'lca-lms-api';
export const APP_VERSION: string = pkg.version;
