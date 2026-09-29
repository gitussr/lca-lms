-- Runs once, the first time the Postgres data volume is initialised
-- (docker-entrypoint-initdb.d). Creates the separate database the backend's
-- `test` profile points at (backend/src/shared/config.ts → TEST_DATABASE_URL).
--
-- The F-006 test harness also spins up its own throwaway `lca_lms_test_*`
-- databases per test file; this one is for ad-hoc `NODE_ENV=test` use and for
-- pointing `npm run db:migrate` at a scratch database.
--
-- Owned by POSTGRES_USER (the connected role during init).
CREATE DATABASE lca_lms_test;
