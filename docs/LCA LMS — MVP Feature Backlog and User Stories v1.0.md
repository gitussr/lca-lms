# LCA LMS — MVP Feature Backlog and User Stories

**Version:** 1.1
**Date:** 2026-09-03
**Status:** Architecture decisions D1–D9 locked; backlog ready for Milestone 0
**Companion document:** `LCA LMS — Master Project Prompt v1.0.md`

---

## 0. How to Use This Document

This is the **feature backlog** for the LCA LMS MVP. It translates the product vision and
invariants from the Master Project Prompt into discrete, buildable increments.

- Each item is sized to be delivered as **one meaningful feature** (roughly one development
  day, per §22 of the Master Prompt).
- Items are grouped into **epics** and assigned a **priority** (P0 / P1 / P2) and a
  **milestone** (M0 / M1 / M2 / Post-MVP).
- Build order is defined in **§8 Suggested Build Sequence**. Do not pull P1/P2 work forward
  without a scope decision (§27 of the Master Prompt).
- Every feature, when picked up, must be expanded into the full **Daily Development Format**
  (§25 of the Master Prompt) before implementation. The user stories and acceptance criteria
  here are the starting point, not the complete spec.

### Priority definitions

| Priority | Meaning |
|----------|---------|
| **P0 — Critical** | Required for the MVP to prove a real learning workflow. Launch blocker. |
| **P1 — Important** | Completes the MVP experience. Built immediately after P0 is stable. |
| **P2 — Future** | Explicitly out of MVP. Listed only to protect architecture decisions. |

### Milestones

| Milestone | Theme | Contains |
|-----------|-------|----------|
| **M0** | Platform foundation | Repo, backend/frontend skeletons, DB, config, logging, tests, CI |
| **M1** | MVP core (P0) | Auth, roles, user management, courses, enrollment, syllabus, student viewing, dashboards |
| **M2** | MVP complete (P1) | Recorded video, live classes, progress tracking, resources, audit logging |
| **Post-MVP** | P2 | Everything in §7 |

### Estimate scale

`S` ≈ half a day · `M` ≈ one day · `L` ≈ two+ days (candidate for splitting).

---

## 1. Architecture Decisions (D1–D9) — RESOLVED

**Status:** Resolved 2026-09-03 with recommended defaults. These are now binding for the MVP.
Any change requires the §36 impact review (stop, explain, decide) before implementation.

Affected features carry the decision in their own acceptance criteria.

---

### D1 — Account creation model → **No public self-registration**

**Decision:** All accounts are provisioned by an admin. There is no public sign-up endpoint
in the MVP. A newly created user is `pending` and becomes usable via a one-time,
time-limited set-password link (F-109); the admin can also set an initial password directly.

**Rationale:** LCA already knows who its students and teachers are (they are admitted /
hired, not walk-ups). Removing self-registration eliminates a whole class of abuse
(fake accounts, enumeration, spam, unverified email) and keeps the enrollment model clean —
every user exists because LCA put them there. Self-service "forgot password" stays P1
(`F-1101`), pending an email-provider decision.

**Affects:** F-101, F-109, F-110, F-201, F-202. No `POST /auth/register` route exists.

---

### D2 — Session strategy → **Server-side sessions, httpOnly cookie**

**Decision:** On login the server creates a session record and returns an opaque session ID
in a cookie that is `HttpOnly`, `Secure`, `SameSite=Lax`. Session state (user id, issued-at,
last-seen, expiry) lives in **Redis** (already required by §15; Postgres is the fallback if
Redis is deferred). Idle timeout **12h**, absolute lifetime **7d**, sliding renewal on
activity. Logout and deactivation delete the session server-side.

**Rationale:** Invariant 2 requires that being logged in is not a permanent grant — a
deactivated user, a suspended enrollment, or an explicit logout must take effect
immediately. Server-side sessions are revocable by definition; stateless JWTs are not
without extra denylist machinery that reintroduces the state we were trying to avoid.
Opaque IDs also leak nothing if inspected. The cost (a Redis lookup per request) is
negligible at MVP scale and gives us free session observability (§32).

**Affects:** F-103, F-104, F-105, F-110, F-1302. No JWT, no `Authorization: Bearer` for
first-party web clients. (A separate token scheme for future mobile/API clients is a P2
decision, not foreclosed.)

---

### D3 — Teachers per course → **Many-to-many, one primary shown in MVP UI**

**Decision:** A `course_teacher` join table links courses and teachers (many-to-many). One
row per course is flagged `is_primary`. The MVP admin UI lets you set a single primary
teacher; the data model already supports co-teachers without a migration later.

**Rationale:** Real courses acquire a second teacher, a substitute, or a TA sooner than
expected, and changing a `courses.teacher_id` column into a join table after there is data
is exactly the kind of avoidable migration §30 warns against. The join table costs nothing
now. Keeping the UI single-teacher keeps M1 simple (§43: simplicity over extra features)
while the schema stays future-proof. **Teacher content permissions are derived solely from
rows in this table** (invariant 4, §5.2).

**Affects:** F-302, F-503, F-601–F-603, F-801, F-1004.

---

### D4 — Batches in the MVP → **Deferred to M2 (P1)**

**Decision:** Enrollment links a student directly to a course (`enrollments` table, no batch
FK) for M1. The `Batch` entity and batch-driven enrollment arrive in M2 (F-401, F-402) as
an optional cohort grouping layered on top of enrollment — never a replacement for it.

**Rationale:** The MVP goal (§4) is to prove a real learning workflow: login → course →
syllabus → lesson → progress. Batches are an administrative convenience for managing
cohorts, not a prerequisite for that workflow. Adding them to M1 would mean a second access
path to reason about (student↔batch↔course) while we are still hardening the first. When
batches land, `enrollment` remains the single authoritative access grant (invariant 3);
batch membership merely creates/updates enrollment rows.

**Affects:** Epic 4 stays in M2. F-501 has no `batch_id`. `enrollments` gets a nullable
`batch_id` in the F-401 migration, not before.

---

### D5 — Video storage & delivery → **Private object storage + short-lived signed URLs, no transcoding**

**Decision:** Uploaded videos go to a **private** object-storage bucket (no public ACL, no
CDN in MVP). Playback is authorized per request: `GET /me/lessons/:id/video` re-runs the
full §13 authorization chain and, on success, returns a signed URL valid for **~10 minutes**,
scoped to that one object. No FFmpeg, no transcoding, no multiple resolutions in the MVP —
the original file is served as-is. Upload validation is by **content inspection** (magic
bytes), not extension or client MIME (§20).

**Rationale:** §9 is explicit: no permanent public video URLs; access must be controlled and
temporary. Signed URLs give us that with zero custom infrastructure. §9 also says *do not
build complex video infrastructure before the MVP requires it* — so transcoding and ABR are
P2 (§10 only requires that we not architecturally preclude them, and per-lesson `lesson_videos`
rows with a `status` column leave room for a future "renditions" table). The 10-minute
lifetime bounds link-sharing without breaking normal viewing.

**Affects:** Epic 7 (F-701–F-704), F-901/F-902 (same model for resource files). CDN and
adaptive streaming remain P2 (§7).

---

### D6 — Live-class delivery → **External provider, store link only**

**Decision:** The LMS stores schedule metadata and a `meeting_url` for each live class. The
actual meeting runs on an external service (Zoom / Google Meet / Jitsi — provider choice is
operational, not architectural). No WebRTC, no SFU, no media handling in the LMS. The join
link is revealed to students only within a configurable window around the start time (F-803).

**Rationale:** §11 is explicit: for the MVP, do not build a custom video-conferencing
platform; a native WebRTC classroom is a future feature (§7, §29). Storing a link is a
one-column feature that fully satisfies the MVP user flow (§39). Time-windowing the link
exposure limits leakage of a URL that often has no auth of its own.

**Affects:** Epic 8 (F-801–F-803). `live_classes.meeting_url` is a plain column; encrypting
it at rest is a nice-to-have, not a blocker. Native classroom stays P2.

---

### D7 — Deletion strategy → **Soft delete / archive for core entities**

**Decision:** `User`, `Course`, `Subject`, `Chapter`, `Lesson`, `Enrollment`, `LiveClass`,
`LessonVideo`, `LessonResource` all use a nullable `deleted_at` (or an `archived` status
where a user-facing "archived" state is meaningful, e.g. Course). Application queries filter
out soft-deleted rows by default via a shared helper. **Hard delete is allowed only** for
rows that are drafts, never referenced by another table, and being removed by their creator
before publication (e.g. a mistyped draft lesson with no progress, no video).
`audit_events` (F-1201) is append-only — never updated or deleted through the app.

**Rationale:** Invariant 9 — deleting content must not casually destroy historical
information. A student's progress, an enrollment record, or a completed course are academic
history LCA may need to produce months later (transcripts, disputes, audits). Soft delete
also makes "oops, restore that" a one-line update instead of a backup recovery. The narrow
hard-delete carve-out keeps the drafts table from filling with genuine mistakes.

**Affects:** Every migration in M1/M2 adds `deleted_at`; the F-003 baseline provides the
query helper and the `updated_at` trigger.

---

### D8 — Tenancy → **Single tenant**

**Decision:** One deployment serves one institution (LCA). No `organization_id` /
`tenant_id` columns, no row-level tenant scoping. The modular-monolith boundaries (§16) are
kept clean so a tenant dimension *could* be added later, but nothing is built for it now.

**Rationale:** §30 / §43 — do not sacrifice present simplicity for scale that may never
come. Multi-tenancy touches every table, every query, and every authorization check; adding
it speculatively would slow every M1 feature for a requirement that does not exist. If LCA
ever franchises, that is a deliberate, funded architecture project (§36), not an MVP column.

**Affects:** Data model globally. Authorization logic assumes a single tenant.

---

### D9 — API surface → **Versioned REST under `/api/v1`**

**Decision:** All HTTP endpoints are namespaced `/api/v1/...`. REST resource naming (§17).
Route groups by audience: `/api/v1/auth/*`, `/api/v1/me/*` (caller-scoped),
`/api/v1/admin/*` (role admin), `/api/v1/teacher/*` (role teacher). A breaking change ships
as `/api/v2` alongside v1, not as a silent modification of v1.

**Rationale:** §17 calls for a versioning strategy "when necessary" — committing to the
prefix on day one costs one line of routing and removes the future migration where every
client URL changes. The audience-based grouping makes the authorization intent of a route
legible from its path and pairs naturally with the F-106 role guards.

**Affects:** F-002 and every endpoint thereafter.

---

## 2. Epic Map

| Epic | Name | Priority | Milestone |
|------|------|----------|-----------|
| 0 | Project & Platform Foundation | P0 | M0 |
| 1 | Identity & Access (Authentication) | P0 | M1 |
| 2 | User Management | P0 | M1 |
| 3 | Course Management | P0 | M1 |
| 4 | Batches | P1 | M2 |
| 5 | Enrollment | P0 | M1 |
| 6 | Syllabus (Subject / Chapter / Lesson) | P0 | M1 |
| 7 | Recorded Video | P1 | M2 |
| 8 | Live Classes | P1 | M2 |
| 9 | Learning Resources | P1 | M2 |
| 10 | Progress Tracking | P1 | M2 |
| 11 | Dashboards | P0 / P1 | M1 / M2 |
| 12 | Audit Logging | P1 | M2 |
| 13 | API & Platform Hardening | P0 | M1 (ongoing) |

---

## 3. Cross-Cutting Requirements (apply to every feature)

Derived from Master Prompt §13, §14, §17, §19, §21, §24. These are part of the **acceptance
criteria of every P0/P1 feature** and are not tracked as separate backlog items except where
a dedicated build task is needed (Epic 13).

- **AuthN:** every non-public endpoint requires an authenticated, active user.
- **AuthZ:** every endpoint performs an explicit permission check (role + ownership +
  enrollment where relevant). Never infer permission from knowledge of an ID (§13).
- **Input validation:** all request bodies, params, and query strings validated against a
  schema; reject unknown fields.
- **Object-level authorization:** for every `GET /resource/:id`, `PATCH`, `DELETE`, verify
  the caller may act on *that specific row*, not just the resource type (IDOR protection).
- **Consistent errors:** typed error responses, correct HTTP status codes, no stack traces
  or internal identifiers leaked to clients (§19 Q10, §32).
- **Frontend is not security:** hiding a control in the UI never substitutes for a backend
  check (invariant 7).
- **Tests:** happy path + at least one authorization-failure test + one validation-failure
  test per endpoint (§21, §24).
- **Audit:** mutating admin/teacher actions emit an audit event once Epic 12 exists; until
  then, log them as structured logs.
- **Soft delete:** destructive actions on core academic entities archive rather than delete
  (invariant 9, D7).
- **Migrations:** every schema change ships as a reversible migration (§18).

---

## 4. Milestone 0 — Platform Foundation (P0)

Goal: a running, testable, deployable skeleton with no business features. Maps to §44 of the
Master Prompt.

### F-001 — Repository & project setup  ·  ✅ DONE (2026-09-03)
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** S · **Depends on:** —
- **User story:** As a developer, I want a version-controlled monorepo with agreed structure,
  linting, and formatting, so that all future work has a consistent home.
- **Acceptance criteria:**
  - [x] Git repository initialized (`main`); branch/PR rules and pending GitHub branch protection documented in `CONTRIBUTING.md`.
  - [x] Repo layout created: `backend/`, `frontend/`, `docs/`, `infra/` (each with a placeholder README pointing to its scaffolding feature).
  - [x] `.gitignore`, `.gitattributes` (LF), `.editorconfig`, `.nvmrc` (22); Prettier (`.prettierrc.json` / `.prettierignore`) and ESLint 9 flat config with `typescript-eslint` (`eslint.config.mjs`); root `package.json` scripts `format` / `format:check` / `lint` / `lint:fix`.
  - [x] `README.md` with layout, prerequisites, setup steps, and a Milestone 0 status table; planning docs moved to `docs/`.
  - [x] Conventional Commits documented in `CONTRIBUTING.md` (types, scopes, examples) alongside the §24 Definition of Done checklist.
- **Security:** `.gitignore` excludes `.env` / `.env.*` (keeps `.env.example`), `*.pem` / `*.key` / `*.p12` / `*.pfx`, `secrets/`, `node_modules/`, and build output; verified `git check-ignore` matches `.env` and `node_modules`.
- **Verification:** `npm install` clean (0 vulnerabilities); `npm run format:check` and `npm run lint` both pass on a clean tree.
- **Commits:** `docs: add master project prompt and MVP feature backlog` (7e256b1), `chore: F-001 repository and project setup`.

### F-002 — Backend application skeleton  ·  ✅ DONE (2026-09-03)
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** M · **Depends on:** F-001
- **User story:** As a developer, I want a Fastify + TypeScript service that boots, exposes a
  health endpoint, and has a modular folder structure, so that features can be added as
  isolated modules.
- **Acceptance criteria:**
  - [x] Fastify 5 + TypeScript (ESM, NodeNext, strict) `@lca-lms/backend` workspace: `npm run build`, `npm start`, `npm run dev:backend` (tsx watch), `npm run typecheck` all work.
  - [x] All 12 module folders created under `src/modules/` per §16 (`auth users students teachers courses batches enrollment syllabus lessons videos live-classes progress`), plus `health/`.
  - [x] Each module exports a `FastifyPluginAsync` route-registration function; `src/app.ts` `buildApp()` registers every one at the `/api/v1` prefix. Non-health modules register no endpoints yet.
  - [x] `GET /api/v1/health` → `{ status, service: "lca-lms-api", version, uptimeSeconds, timestamp }` (version read from `package.json` at runtime).
  - [x] Global error handler + not-found handler emit `{ error: { code, message, details? }, requestId }`; Fastify validation errors → `VALIDATION_ERROR` with field paths; 5xx → generic `INTERNAL`, full error logged server-side only. `AppError` hierarchy in `src/shared/errors.ts`.
  - [x] Request context: `x-request-id` accepted from the request header or generated (UUID), attached as `request.id`, echoed on every response; `request.user` decorated to `null` (typed `AuthenticatedUser | null`, populated in F-105).
- **Security:** `@fastify/helmet` (CSP, HSTS, nosniff, frame-deny, etc. — verified on live responses); `@fastify/cors` locked to `CORS_ORIGIN` allow-list with `credentials: true`; 1 MiB body limit; Fastify sends no `x-powered-by`; error responses carry no stack traces or internal identifiers.
- **Verification:** `npm run typecheck` clean; `npm test` 3/3 pass (health 200 + shape, unknown route 404 shape, inbound `x-request-id` honoured); `npm run build` emits `dist/`; live `curl` of `npm start` confirms health 200, helmet headers, and the 404 error shape.
- **Known limitation:** SIGINT/SIGTERM graceful-shutdown hook does not fire reliably on native Windows (Node platform quirk); works in the Linux container used from F-008.
- **Commit:** `feat(api): F-002 backend application skeleton`.

### F-003 — Database foundation
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** M · **Depends on:** F-002
- **User story:** As a developer, I want PostgreSQL wired in with a migration tool and a
  connection pool, so that schema evolves safely and reproducibly.
- **Acceptance criteria:**
  - [x] Postgres connection pool configured from env; fails fast on bad config.
  - [x] Migration tool chosen and documented; `migrate up` / `migrate down` work.
  - [x] Baseline migration creates a `schema_migrations` record and a shared `updated_at` trigger helper.
  - [x] Conventions documented: UUID primary keys, `created_at`/`updated_at`/`deleted_at`, snake_case columns.
  - [x] Integration test harness spins up a disposable test database.
- **Security:** DB credentials only from env (§33); least-privilege DB user documented as a target.
- **Status:** DONE 2026-09-05. `pg` + `node-pg-migrate` (TS migrations, `schema_migrations`
  table). Pool: `backend/src/db/pool.ts`. Baseline migration + conventions:
  `backend/migrations/`, `backend/src/db/README.md`. Tests: `pool.test.ts` (singleton
  lifecycle, no DB needed) + `pool.integration.test.ts` (creates a disposable DB, migrates
  up/down, drops it — self-skips with a logged reason when no Postgres server is reachable;
  not run against a live database in this session since none was available). No local
  Postgres automation yet — that is F-008.

### F-004 — Configuration & environment system
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** S · **Depends on:** F-002
- **User story:** As a developer, I want typed, validated configuration loaded from the
  environment, so that misconfiguration is caught at startup and secrets never enter source.
- **Acceptance criteria:**
  - [x] Central config module validates all required env vars against a schema at boot.
  - [x] `.env.example` lists every variable with a description and safe placeholder.
  - [x] Distinct config profiles for development / test / staging / production (§33).
  - [x] App refuses to start with missing/invalid required config.
- **Security:** no secret has a real default value in code; secrets are never logged.
- **Status:** DONE 2026-09-05. `backend/src/shared/config.ts` rewritten around a Zod schema:
  `buildConfig(env)` is the pure, unit-tested core (throws an aggregated `ConfigError` — every
  problem found, never just the first, and never a variable's raw value); the module's
  `config` export wraps it in `loadConfigOrExit()`, which prints the aggregated error and
  calls `process.exit(1)` on failure — verified manually with `tsx` for both an invalid
  (bad `PORT`) and a valid production-shaped env. staging/production are one strict profile:
  `DATABASE_URL` and `CORS_ORIGIN` have no default there, and the known local placeholder
  `DATABASE_URL` is rejected even if supplied explicitly. 24 unit tests in `config.test.ts`
  cover defaults, coercion, every profile's required-field rules, and the no-secret-leakage
  guarantee.

### F-005 — Structured logging & error handling
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** S · **Depends on:** F-002
- **User story:** As an operator, I want structured request and error logs with correlation
  IDs, so that I can debug issues without leaking sensitive data.
- **Acceptance criteria:**
  - [x] JSON structured logger; log level from config.
  - [x] Each request logged with method, path, status, duration, request ID, user ID (if any).
  - [x] Unhandled errors logged with stack server-side; client sees only a safe message + request ID.
  - [x] A redaction list prevents passwords, tokens, cookies, and auth headers from being logged (§19 Q10, §32).
- **Security:** verified that a failed login and a validation error do not log the submitted password.
- **Status:** DONE 2026-09-05. Fastify's Pino logger configured via `backend/src/shared/logger.ts`:
  level from config, plus a recursive `logMethod` hook (`redactSensitive`) that replaces
  sensitive key values (`password`, `token`, `authorization`, `cookie`, …) at any nesting
  depth, case-insensitively — Error instances pass through unredacted so Fastify's default
  `err` serializer still captures message/stack. `app.ts`'s `onResponse` hook logs one line
  per request (`method`, `path` with query stripped, `statusCode`, `durationMs`, `userId`);
  Fastify's own two-line request log is disabled (`disableRequestLogging`, a documented,
  still-supported deprecation) to avoid duplication. 5xx errors already logged with a full
  stack server-side via `error-handler.ts` (present since F-002; now verified by test).
  `buildApp()` gained an optional `logger` override so tests can capture real log output.
  No login endpoint exists yet (F-103), so the password-redaction requirement is verified
  against a stand-in handler that deliberately logs the raw request body — the shape a
  real login/register handler will have — plus a schema-validated route for the validation-
  error case. 12 new tests (8 redaction unit tests + 4 through the real app/error handler).

### F-006 — Automated testing foundation
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** M · **Depends on:** F-003
- **User story:** As a developer, I want unit and integration test runners wired up with a
  reset-between-tests database, so that every feature can ship with tests (§21).
- **Acceptance criteria:**
  - [x] Test runner configured for backend; `npm test` runs unit + integration suites.
  - [x] Integration tests get a clean database per run (migrate + truncate/rollback strategy).
  - [x] Test helpers: build authenticated request as a given role. **Partial** — seeding a
        user/course/enrollment is deferred; see Status.
  - [x] Coverage reporting enabled (no hard gate yet; target documented).
  - [x] Example tests for `GET /health` and one migration.
- **Security:** test fixtures use obviously fake credentials; no production data in fixtures.
- **Status:** DONE 2026-09-05 (with one criterion partially deferred, flagged rather than
  faked — §37). `backend/src/test/db.ts`: `createTestDatabase()` creates a uniquely-named
  disposable database per test *file*, migrates it up once, exposes `.reset()` (fast
  truncate-all-application-tables between individual tests, proven against a throwaway table
  it creates itself in `test/db.integration.test.ts`) and `.drop()`. `db/pool.integration.test.ts`
  refactored onto this shared helper. `backend/src/test/auth.ts`: `actAs(app, user)` sets
  `request.user` directly (the field F-105's session middleware will populate for real) and
  `fakeAuthenticatedUser(role)` builds an obviously-fake user (`00000000-0000-4000-a000-…`
  ids) — lets role-gated route tests (F-106+) run today with no session store or `users`
  table. `npm run test:coverage` (Node's built-in `--experimental-test-coverage`); target
  documented in `src/test/README.md` (70% lines for `shared/*` and `db/*`), no gate yet.
  **Deferred:** seeding a user/course/enrollment needs tables that don't exist until
  F-101/F-2xx/F-3xx — building that now would be speculative code with nothing to verify it
  against, so each seed helper is deferred to land alongside the schema it seeds (documented
  in `test/README.md`'s "What's deferred"). No local Postgres was available in this session,
  so the DB-backed parts (`.reset()`, migrate up/down) are verified by self-skip behavior +
  the pre-existing F-003 disposable-DB pattern, not a live run — same caveat as F-003.

### F-007 — Frontend application skeleton
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** M · **Depends on:** F-001
- **User story:** As a developer, I want a React + TypeScript app with routing, an API
  client, and auth-aware layout shells, so that role-specific screens can be added.
- **Acceptance criteria:**
  - [ ] React + TS app builds and runs; connects to `/api/v1`.
  - [ ] Router with public routes (login) and protected route wrapper.
  - [ ] Central API client handles base URL, credentials, and standard error parsing.
  - [ ] Layout shells for Student / Teacher / Admin (empty nav, no features).
  - [ ] Loading and error UI primitives.
- **Security:** protected route wrapper redirects unauthenticated users to login; it is a UX
  convenience only — the backend remains the authority (invariant 7).

### F-008 — Local development environment
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** S · **Depends on:** F-003
- **User story:** As a developer, I want `docker compose up` to start Postgres and Redis
  locally, so that onboarding is one command (§15, §33).
- **Acceptance criteria:**
  - [ ] `infra/docker-compose.yml` runs Postgres + Redis with named volumes.
  - [ ] Documented commands to run migrations and seed a first admin.
  - [ ] Seed script creates one admin account from env-provided credentials (not hardcoded).
- **Security:** compose file uses non-default local passwords from `.env`; not intended for production.

### F-009 — Continuous integration pipeline
- **Priority:** P0 · **Milestone:** M0 · **Estimate:** S · **Depends on:** F-006
- **User story:** As a developer, I want CI to run lint, typecheck, build, and tests on every
  push, so that broken changes are caught before merge (§24).
- **Acceptance criteria:**
  - [ ] CI runs: install → lint → typecheck → build → unit + integration tests.
  - [ ] CI provisions a throwaway Postgres for integration tests.
  - [ ] Pipeline fails the build on any step failure.
  - [ ] Secret scanning / dependency audit step (advisory at first).
- **Security:** CI has no production credentials; uses ephemeral test secrets only.

---

## 5. Milestone 1 — MVP Core (P0)

### Epic 1 — Identity & Access (Authentication)

#### F-101 — User & Role data model
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-003
- **User stories:**
  - As the system, I need every person to be a `User` with exactly one role (`admin`,
    `teacher`, `student`) so that authorization has a single source of truth.
  - As an admin, I need `student` and `teacher` profile records linked to a user so that
    role-specific data has a home.
- **Acceptance criteria:**
  - [ ] `users` table: id, email (unique, case-insensitive), password_hash, role, status
        (`active` / `inactive` / `pending`), timestamps, `deleted_at`.
  - [ ] `student_profiles` and `teacher_profiles` tables with FK to `users` (1:1).
  - [ ] Role is an enum/check-constrained column; no user without a role.
  - [ ] Migration + rollback; model unit tests.
- **Security:** email uniqueness enforced at DB level; `password_hash` column never returned
  by any serializer (invariant 6, §19).

#### F-102 — Password hashing & credential storage
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-101
- **User story:** As a security reviewer, I need passwords stored only as strong one-way
  hashes so that a database leak does not expose credentials (§12).
- **Acceptance criteria:**
  - [ ] Use a vetted library (argon2id or bcrypt) with sensible cost parameters from config.
  - [ ] Password policy enforced on set/reset (min length, basic checks); documented.
  - [ ] Hash + verify helpers with unit tests including wrong-password and tampered-hash cases.
  - [ ] No plaintext password is ever persisted or logged.
- **Security:** timing-safe verification; never implement custom crypto (§12).

#### F-103 — Login
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-102, D2
- **User story:** As a registered user, I want to log in with email and password so that I
  can access my role's area of the LMS.
- **Acceptance criteria:**
  - [ ] `POST /api/v1/auth/login` accepts email + password.
  - [ ] On success: creates a session, sets an httpOnly, Secure, SameSite cookie; returns
        the current user's safe profile (id, name, role).
  - [ ] On failure: generic "invalid credentials" (no user-enumeration), 401.
  - [ ] Inactive / pending / soft-deleted users cannot log in (invariant 2 groundwork).
  - [ ] Rate limiting / throttling on repeated failures per IP and per account.
  - [ ] Tests: valid login, wrong password, unknown email, inactive user, throttle triggers.
- **Security:** §19 Q5–Q9 — request cannot be replayed to escalate; no role accepted from the
  client; failed attempts logged without the password.

#### F-104 — Logout & session invalidation
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-103
- **User story:** As a logged-in user, I want to log out so that my session can no longer be
  used, especially on a shared computer.
- **Acceptance criteria:**
  - [ ] `POST /api/v1/auth/logout` destroys the server session and clears the cookie.
  - [ ] A destroyed session is rejected by subsequent requests.
  - [ ] Tests: session unusable after logout.
- **Security:** logout works even if the cookie is stale; no CSRF-exploitable side effects
  (see F-1302).

#### F-105 — Authenticated session middleware
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-103
- **User story:** As a developer, I want a middleware that resolves the current active user
  from the session so that every protected route starts from a trusted identity.
- **Acceptance criteria:**
  - [ ] Middleware loads the session, fetches the user, and attaches `{ id, role, status }` to the request.
  - [ ] Rejects with 401 if no session, expired session, or user not `active`.
  - [ ] Session expiry / sliding renewal behaviour defined and tested.
  - [ ] Tests: no session, expired session, user deactivated mid-session.
- **Security:** re-checks user status on every request (a deactivated user loses access
  immediately — invariant 2).

#### F-106 — Role-based authorization middleware
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-105
- **User story:** As a developer, I want declarative `requireRole('admin')` /
  `requireRole('teacher','admin')` guards so that endpoints state their access rules
  explicitly.
- **Acceptance criteria:**
  - [ ] Guard rejects with 403 when the role does not match; 401 when unauthenticated.
  - [ ] Composable with object-level checks (enrollment, ownership) added later.
  - [ ] Tests: each role against an admin-only and a teacher-or-admin route.
- **Security:** default-deny — a route with no guard is treated as a bug and flagged in review
  (invariant 1).

#### F-107 — Current user endpoint (`/me`)
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-105
- **User story:** As a logged-in user, I want the app to fetch my own profile and role so
  that the frontend can render the correct experience.
- **Acceptance criteria:**
  - [ ] `GET /api/v1/auth/me` returns the current user's safe profile + role + profile record.
  - [ ] 401 when unauthenticated.
  - [ ] Never returns `password_hash` or other users' data.
- **Security:** response is strictly the caller's own record.

#### F-108 — Change own password
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-102, F-105
- **User story:** As a logged-in user, I want to change my password by providing my current
  one so that I control my account security.
- **Acceptance criteria:**
  - [ ] `POST /api/v1/auth/change-password` requires current password + new password.
  - [ ] Wrong current password → 400, no change.
  - [ ] New password must meet policy; all other sessions optionally invalidated (decision).
  - [ ] Tests: success, wrong current password, weak new password.
- **Security:** current-password re-check defeats session-hijack password takeover.

#### F-109 — Admin-triggered password reset / credential issue
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-102, F-201
- **User story:** As an admin, I want to (re)issue access for a user who cannot log in so
  that account recovery does not require engineering.
- **Acceptance criteria:**
  - [ ] Admin can generate a one-time, time-limited set-password link/token for a user.
  - [ ] Token is single-use, expires, and is stored hashed.
  - [ ] `POST /api/v1/auth/set-password` consumes the token and sets a new password.
  - [ ] Used/expired tokens are rejected.
  - [ ] Tests: token happy path, reuse rejected, expiry rejected, token for wrong user rejected.
- **Security:** token is high-entropy; delivery channel (email) noted as a dependency; no
  account enumeration in responses.

> Self-service "forgot password" (email-initiated) is **P1** (`F-1101`) pending an email
> provider decision.

#### F-110 — Account activation / deactivation
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-101, F-106
- **User story:** As an admin, I want to deactivate and reactivate a user so that access can
  be revoked without deleting history (invariant 9).
- **Acceptance criteria:**
  - [ ] `PATCH /api/v1/admin/users/:id/status` toggles `active` / `inactive`.
  - [ ] Deactivating invalidates the user's active sessions.
  - [ ] An admin cannot deactivate their own account (lockout guard) — decision.
  - [ ] Tests: deactivated user cannot log in and loses an active session.
- **Security:** state-changing, admin-only, audited.

---

### Epic 2 — User Management

#### F-201 — Admin: manage students
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-106
- **User stories:**
  - As an admin, I want to create a student account (name, email, contact) so that they can
    be enrolled and log in.
  - As an admin, I want to list, search, and view students so that I can manage the roster.
  - As an admin, I want to edit a student's profile so that records stay accurate.
- **Acceptance criteria:**
  - [ ] `POST/GET/GET :id/PATCH /api/v1/admin/students`.
  - [ ] Creating a student creates a `user` (role `student`, status `pending`) + `student_profile` atomically (transaction).
  - [ ] Duplicate email rejected with a clear error.
  - [ ] List is paginated and supports name/email search.
  - [ ] Soft delete / archive (no hard delete).
  - [ ] Tests: create, duplicate email, list pagination, teacher/student callers get 403.
- **Security:** admin-only; input validated; PII fields limited to what the MVP needs (§19 Q3).

#### F-202 — Admin: manage teachers
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-106
- **User stories:**
  - As an admin, I want to create a teacher account so that they can be assigned to courses.
  - As an admin, I want to list, view, and edit teachers.
- **Acceptance criteria:**
  - [ ] `POST/GET/GET :id/PATCH /api/v1/admin/teachers`.
  - [ ] Creating a teacher creates `user` (role `teacher`) + `teacher_profile` atomically.
  - [ ] Duplicate email rejected; list paginated + searchable; soft delete.
  - [ ] Tests: create, duplicate, list, non-admin gets 403.
- **Security:** admin-only; creating a `teacher` never grants admin capability (invariant, §5.2).

#### F-203 — Student: view & edit own profile
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-107
- **User story:** As a student, I want to view my profile and update limited fields (e.g.
  display name, contact number) so that my information is current.
- **Acceptance criteria:**
  - [ ] `GET/PATCH /api/v1/me/profile` for the student's own record only.
  - [ ] Editable fields are an explicit allow-list; role, email, status, enrollments are not editable here.
  - [ ] Tests: student edits own; cannot change role/status; cannot fetch another student's profile by ID.
- **Security:** object-level check — the record is always the caller's (invariant 5, §19 Q6).

#### F-204 — Teacher: view own profile
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-107
- **User story:** As a teacher, I want to view my profile and assigned courses so that I know
  my responsibilities.
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/profile` returns teacher profile + list of assigned courses.
  - [ ] Editable fields limited by allow-list (decision on which).
  - [ ] Tests: teacher sees only own assignments.
- **Security:** no access to admin user-management endpoints.

---

### Epic 3 — Course Management

#### F-301 — Admin: CRUD courses
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-106
- **User stories:**
  - As an admin, I want to create a course (title, slug, description, status) so that
    students can eventually be enrolled in it.
  - As an admin, I want to edit, list, and view courses.
  - As an admin, I want to archive a course so that it is hidden without losing its content
    and history (invariant 9).
- **Acceptance criteria:**
  - [ ] `POST/GET/GET :id/PATCH /api/v1/admin/courses`; `POST :id/archive`.
  - [ ] Course has `status`: `draft` / `published` / `archived`.
  - [ ] Slug unique; validation on all fields.
  - [ ] Listing paginated; filter by status.
  - [ ] Tests: create, edit, archive, non-admin gets 403.
- **Security:** admin-only writes; archived/draft courses are invisible to students (enforced in Epic 5/6 reads).

#### F-302 — Admin: assign teachers to a course
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-301, F-202, D3
- **User story:** As an admin, I want to assign one or more teachers to a course so that
  those teachers can manage its content.
- **Acceptance criteria:**
  - [ ] `course_teacher` join table; `PUT /api/v1/admin/courses/:id/teachers` sets the list.
  - [ ] Only users with role `teacher` can be assigned.
  - [ ] Removing a teacher revokes their content-management access immediately.
  - [ ] Tests: assign, unassign, assigning a non-teacher fails, unassigned teacher loses course access.
- **Security:** this assignment is the sole basis for teacher content permissions (§5.2, invariant 4).

#### F-303 — Course publish / unpublish
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-301
- **User story:** As an admin, I want to publish a course when its syllabus is ready so that
  enrolled students can see it, and unpublish it to pull it back.
- **Acceptance criteria:**
  - [ ] `POST /api/v1/admin/courses/:id/publish` and `/unpublish`.
  - [ ] Only `published` courses appear in student-facing reads.
  - [ ] Unpublishing does not delete enrollments or progress.
  - [ ] Tests: student sees published only; unpublish hides it but keeps data.
- **Security:** state transition is admin-only and audited.

---

### Epic 5 — Enrollment

#### F-501 — Admin: enroll a student in a course
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-201, F-301
- **User story:** As an admin, I want to enroll a student in a course so that they gain
  access to its syllabus and content.
- **Acceptance criteria:**
  - [ ] `enrollments` table: student_id, course_id, status (`active` / `suspended` /
        `completed` / `withdrawn`), enrolled_at, timestamps, `deleted_at`.
  - [ ] Unique constraint on (student_id, course_id) for non-deleted rows.
  - [ ] `POST /api/v1/admin/enrollments` with student + course.
  - [ ] Cannot enroll into an archived course; cannot enroll an inactive student.
  - [ ] Tests: enroll, duplicate rejected, archived course rejected.
- **Security:** admin-only; the enrollment row is the authoritative access grant (invariant 3).

#### F-502 — Admin: change enrollment status / unenroll
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-501
- **User story:** As an admin, I want to suspend or withdraw an enrollment so that access can
  be paused or ended without erasing progress.
- **Acceptance criteria:**
  - [ ] `PATCH /api/v1/admin/enrollments/:id` sets status.
  - [ ] `suspended` / `withdrawn` immediately removes course + content access.
  - [ ] Progress records are retained.
  - [ ] Tests: suspend blocks access, reactivate restores it, progress survives.
- **Security:** state-changing, admin-only, audited.

#### F-503 — List enrollments
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-501
- **User stories:**
  - As an admin, I want to list enrollments by course or by student so that I can audit access.
  - As a teacher, I want to see the students enrolled in my assigned courses so that I know my class.
- **Acceptance criteria:**
  - [ ] `GET /api/v1/admin/enrollments?courseId=&studentId=` (admin, any course).
  - [ ] `GET /api/v1/teacher/courses/:id/students` (teacher, only assigned courses → else 403).
  - [ ] Paginated.
  - [ ] Tests: teacher blocked from a non-assigned course's roster; student has no access to either endpoint.
- **Security:** teacher scoping enforced via `course_teacher` (§19 Q6, invariant 6).

#### F-504 — Enrollment authorization service
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-501
- **User story:** As a developer, I want a single `canStudentAccessCourse(studentId, courseId)`
  / `canStudentAccessLesson(...)` service so that every student-facing read enforces
  enrollment identically (invariant 3, §13).
- **Acceptance criteria:**
  - [ ] Central service checks: user active → role student → active enrollment → course published.
  - [ ] Used by all student syllabus/lesson/video/live-class reads.
  - [ ] Returns a structured allow/deny with reason (for logging, not for the client).
  - [ ] Exhaustive unit tests covering every deny branch.
- **Security:** this is the enforcement point for the §13 authorization chain; reviewed as a
  security-critical component.

---

### Epic 6 — Syllabus (Subject / Chapter / Lesson)

#### F-601 — Manage subjects within a course
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-301, F-302
- **User story:** As an admin or an assigned teacher, I want to add, rename, reorder, and
  archive subjects under a course so that the syllabus has top-level structure (§7).
- **Acceptance criteria:**
  - [ ] `subjects` table: course_id, title, position, timestamps, `deleted_at`.
  - [ ] `POST/GET/PATCH/DELETE /api/v1/courses/:courseId/subjects` (+ reorder endpoint).
  - [ ] Writable by admin, or a teacher assigned to that course; else 403.
  - [ ] Ordering is explicit (`position`), stable, and adjustable.
  - [ ] Soft delete.
  - [ ] Tests: assigned teacher can edit, unassigned teacher cannot, student cannot.
- **Security:** object-level check ties every write to course assignment (invariant 6).

#### F-602 — Manage chapters within a subject
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-601
- **User story:** As an admin or assigned teacher, I want to manage chapters under a subject
  so that lessons are grouped logically.
- **Acceptance criteria:**
  - [ ] `chapters` table: subject_id, title, position, timestamps, `deleted_at`.
  - [ ] CRUD + reorder under `/api/v1/subjects/:subjectId/chapters`.
  - [ ] Same authorization model as F-601 (resolve course via subject).
  - [ ] Tests: authorization inherited from course assignment; reorder works.
- **Security:** permission always resolved back to the owning course.

#### F-603 — Manage lessons within a chapter
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-602
- **User story:** As an admin or assigned teacher, I want to create lessons (title,
  description/body, position, status) under a chapter so that students have learning units
  to open.
- **Acceptance criteria:**
  - [ ] `lessons` table: chapter_id, title, body, position, status (`draft`/`published`), timestamps, `deleted_at`.
  - [ ] CRUD + reorder under `/api/v1/chapters/:chapterId/lessons`.
  - [ ] Only `published` lessons are visible to students.
  - [ ] Same course-assignment authorization; soft delete.
  - [ ] Tests: draft lesson hidden from students, visible to assigned teacher/admin.
- **Security:** content ownership chain Course → Subject → Chapter → Lesson is enforced
  (invariant 4).

#### F-604 — Student: view authorized syllabus tree
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-504, F-603
- **User story:** As a student, I want to open one of my enrolled courses and see its
  subjects → chapters → published lessons so that I can navigate my learning path (§39).
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/courses/:courseId/syllabus` returns the nested published structure.
  - [ ] Returns 403 if the student is not actively enrolled or the course is not published.
  - [ ] Draft subjects/chapters/lessons and archived items are excluded.
  - [ ] No content bodies of unpublished lessons leak.
  - [ ] Tests: enrolled student sees published tree; unenrolled student gets 403; suspended enrollment gets 403.
- **Security:** every response goes through `canStudentAccessCourse` (F-504); IDs from the URL
  are never trusted alone (§13).

#### F-605 — Student: open a lesson
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-604
- **User story:** As a student, I want to open a published lesson in my enrolled course and
  read its content so that I can study it.
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/lessons/:lessonId` returns the lesson if the student may access its course and the lesson is published.
  - [ ] Video / live-class / resource references are included but gated by their own checks (Epics 7–9).
  - [ ] Tests: authorized access, wrong-course lesson ID → 403, draft lesson → 403/404.
- **Security:** `canStudentAccessLesson` resolves course via the chapter/subject chain.

---

### Epic 11 — Dashboards (P0 portion)

#### F-1101 — Student dashboard
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-604
- **User story:** As a student, I want a dashboard showing my enrolled courses and a way into
  each so that I can start learning immediately after login (§39).
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/dashboard` returns enrolled (active) courses with basic metadata.
  - [ ] "Continue learning" (last opened lesson) and "Upcoming live classes" slots present but
        may be empty until Epics 8/10 land.
  - [ ] Frontend renders the student layout with real data.
  - [ ] Tests: only the student's active enrollments appear.
- **Security:** strictly scoped to the caller.

#### F-1102 — Admin dashboard
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-201, F-301, F-501
- **User story:** As an admin, I want a dashboard with counts (students, teachers, courses,
  active enrollments) and recent activity so that I have an at-a-glance overview (§39).
- **Acceptance criteria:**
  - [ ] `GET /api/v1/admin/dashboard` returns aggregate counts + recent created/updated entities.
  - [ ] Admin-only.
  - [ ] Tests: non-admin gets 403; counts match seeded data.
- **Security:** aggregates only; no PII beyond names in "recent activity".

#### F-1103 — Teacher dashboard
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-302, F-503
- **User story:** As a teacher, I want a dashboard listing my assigned courses and their
  student counts so that I can jump into the right course (§39).
- **Acceptance criteria:**
  - [ ] `GET /api/v1/teacher/dashboard` returns assigned courses + enrolled student counts.
  - [ ] Upcoming live classes / progress snapshot slots present, filled in M2.
  - [ ] Tests: only assigned courses appear.
- **Security:** scoped by `course_teacher`.

---

### Epic 13 — API & Platform Hardening (P0, runs alongside M1)

#### F-1301 — Rate limiting & abuse protection
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-002, F-008 (Redis)
- **User story:** As an operator, I want per-IP and per-account rate limits on auth and
  write endpoints so that brute force and scraping are slowed.
- **Acceptance criteria:**
  - [ ] Global sensible limit + stricter limits on `login`, `set-password`, `change-password`.
  - [ ] Limit state in Redis; returns 429 with `Retry-After`.
  - [ ] Tests: limit triggers and resets.
- **Security:** directly supports §19 Q7 (repeated requests).

#### F-1302 — CSRF protection & cookie hardening
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-103
- **User story:** As a security reviewer, I need cookie-based sessions protected against CSRF
  so that a malicious site cannot act as a logged-in user.
- **Acceptance criteria:**
  - [ ] SameSite + Secure + httpOnly cookies; CSRF token pattern for state-changing requests (or strict SameSite + origin checks — decision).
  - [ ] Cross-origin state-changing request without token/valid origin is rejected.
  - [ ] Tests: forged cross-origin POST rejected; legitimate SPA request succeeds.
- **Security:** covers §19 Q5.

#### F-1303 — Standard error & validation contract
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** S · **Depends on:** F-002
- **User story:** As a frontend developer, I want every error to follow one shape with a
  stable code so that the UI handles failures consistently (§17).
- **Acceptance criteria:**
  - [ ] `{ error: { code, message, details? } }`; validation errors list field paths.
  - [ ] 4xx for client faults, 5xx for server faults; 401 vs 403 used correctly.
  - [ ] No internal identifiers, SQL, or stack traces in responses.
  - [ ] Tests: representative errors across auth, validation, not-found, forbidden.
- **Security:** §19 Q10 — error payloads reviewed for leakage.

#### F-1304 — Security & data-integrity test suite (authorization matrix)
- **Priority:** P0 · **Milestone:** M1 · **Estimate:** M · **Depends on:** F-106, F-504
- **User story:** As a QA engineer, I want a reusable authorization test matrix so that every
  new endpoint is checked against every role and against IDOR (§21).
- **Acceptance criteria:**
  - [ ] Helper that runs a request as `anonymous / student / other-student / teacher / other-teacher / admin` and asserts expected status.
  - [ ] Applied to all M1 endpoints.
  - [ ] Documented pattern for adding a new endpoint to the matrix.
- **Security:** institutionalizes invariants 1, 2, 5, 6, 7.

---

## 6. Milestone 2 — MVP Complete (P1)

### Epic 4 — Batches

#### F-401 — Admin: CRUD batches
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-301
- **User story:** As an admin, I want to create a batch (name, course, start/end dates) so
  that I can group a cohort of students moving through a course together.
- **Acceptance criteria:**
  - [ ] `batches` table linked to a course; CRUD endpoints; soft delete.
  - [ ] Batch does not by itself grant course access — enrollment still does.
  - [ ] Tests: CRUD + authorization.
- **Security:** admin-only.

#### F-402 — Enroll students via batch
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-401, F-501
- **User story:** As an admin, I want to add students to a batch and have enrollments created
  for the batch's course so that cohort setup is fast.
- **Acceptance criteria:**
  - [ ] Adding a student to a batch creates (or reactivates) an enrollment in the batch's course.
  - [ ] Removing from a batch sets the enrollment status appropriately (decision: withdraw vs keep).
  - [ ] Bulk add supported and transactional.
  - [ ] Tests: batch membership drives enrollment; access rules unchanged.
- **Security:** enrollment remains the single access authority (invariant 3).

### Epic 7 — Recorded Video

#### F-701 — Video entity & lesson attachment
- **Priority:** P1 · **Estimate:** S · **Depends on:** F-603, D5
- **User story:** As an admin or assigned teacher, I want to attach a recorded video to a
  lesson so that students can watch it.
- **Acceptance criteria:**
  - [ ] `lesson_videos` table: lesson_id, storage_key, original_filename, content_type,
        size_bytes, duration_seconds (nullable), status, timestamps, `deleted_at`.
  - [ ] One or more videos per lesson (decision: single for MVP).
  - [ ] Tests: attach/detach, authorization via course assignment.
- **Security:** storage key is internal; never exposed directly to clients.

#### F-702 — Secure video upload
- **Priority:** P1 · **Estimate:** L · **Depends on:** F-701, §20
- **User story:** As an admin or assigned teacher, I want to upload a video file to private
  storage so that it is stored safely and linked to a lesson.
- **Acceptance criteria:**
  - [ ] Upload via short-lived pre-signed PUT to private object storage, or streamed through the API to private storage (decision).
  - [ ] Server-side validation: allow-list of content types by **content inspection**, not
        extension or client MIME; max size limit; safe generated storage key (no client filename in path).
  - [ ] Uploaded objects are private by default; no public ACL.
  - [ ] Failed/incomplete uploads are cleaned up.
  - [ ] Tests: disallowed type rejected, oversize rejected, path traversal in filename neutralized.
- **Security:** full §20 checklist — untrusted file, no execution, isolated storage,
  authorization on the initiating request.

#### F-703 — Controlled video playback access
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-702, F-504
- **User story:** As a student, I want to play a lesson's video only while I am authorized so
  that content is not shareable by URL (§9, §13).
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/lessons/:lessonId/video` returns a **short-lived** signed URL (or streams via an authorized proxy).
  - [ ] Signed URL lifetime is minutes, single lesson scope; expires.
  - [ ] Every request re-checks `canStudentAccessLesson`.
  - [ ] No permanent public URL is ever issued (§9).
  - [ ] Tests: unenrolled → 403, expired link rejected, link for lesson A does not grant lesson B.
- **Security:** core §9 requirement; reviewed as security-critical.

#### F-704 — Playback progress & resume
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-703
- **User story:** As a student, I want the player to remember where I stopped so that I can
  resume without scrubbing.
- **Acceptance criteria:**
  - [ ] `PUT /api/v1/me/lessons/:lessonId/video/progress` stores position + watched ranges (throttled writes).
  - [ ] `GET` returns last position on load.
  - [ ] Progress is per (student, video); one student's data never visible to another (invariant 5).
  - [ ] Reaching a completion threshold feeds Epic 10.
  - [ ] Tests: progress isolated per student; resume returns the right position.
- **Security:** writes accepted only for the caller's own record; values sanity-bounded (0 ≤ pos ≤ duration).

### Epic 8 — Live Classes

#### F-801 — Admin/Teacher: schedule a live class
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-301, F-302, D6
- **User story:** As an admin or assigned teacher, I want to schedule a live class (course,
  optional lesson, title, start time, duration, meeting link) so that students know when and
  where to join (§11).
- **Acceptance criteria:**
  - [ ] `live_classes` table: course_id, lesson_id (nullable), title, starts_at, ends_at/duration, meeting_url, host, status, timestamps, `deleted_at`.
  - [ ] Create/list/update endpoints; teacher restricted to assigned courses.
  - [ ] `meeting_url` validated as a URL; stored encrypted at rest is a nice-to-have (decision).
  - [ ] Tests: teacher cannot schedule for a non-assigned course; validation on times.
- **Security:** meeting link treated as sensitive — not returned to students outside the join window (F-803).

#### F-802 — Edit / cancel a live class
- **Priority:** P1 · **Estimate:** S · **Depends on:** F-801
- **User story:** As an admin or assigned teacher, I want to reschedule or cancel a live
  class so that students see accurate information.
- **Acceptance criteria:**
  - [ ] `PATCH` (time/link/title) and `POST :id/cancel`.
  - [ ] Cancelled classes are marked, not deleted; remain visible as "cancelled".
  - [ ] Tests: authorization; cancelled class cannot be joined.
- **Security:** state-changing, audited.

#### F-803 — Student: view & join live classes
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-801, F-504
- **User story:** As a student, I want to see upcoming live classes for my enrolled courses
  and get the join link near the start time so that I can attend (§11, §39).
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/live-classes` lists upcoming/ongoing classes for active enrollments.
  - [ ] `meeting_url` is only included from `starts_at − N minutes` until `ends_at` (configurable window); before that, only schedule metadata.
  - [ ] Cancelled classes shown as cancelled without a link.
  - [ ] Tests: unenrolled student sees nothing; link hidden outside the window; link present inside it.
- **Security:** §13 chain applied; link exposure minimized (§9 spirit).

### Epic 9 — Learning Resources

#### F-901 — Attach resources to a lesson
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-603, §20
- **User story:** As an admin or assigned teacher, I want to attach resources (external links
  and/or small files) to a lesson so that students have supporting material.
- **Acceptance criteria:**
  - [ ] `lesson_resources` table: lesson_id, type (`link` / `file`), url or storage_key, title, timestamps, `deleted_at`.
  - [ ] File resources follow the §20 upload rules (content inspection, size limit, private storage, safe keys).
  - [ ] Link resources validate URL scheme (`https` only, decision).
  - [ ] Tests: authorization via course assignment; disallowed file type rejected.
- **Security:** files never executed or served from an origin that could execute them.

#### F-902 — Student: access authorized resources
- **Priority:** P1 · **Estimate:** S · **Depends on:** F-901, F-504
- **User story:** As a student, I want to open a lesson's resources so that I can use the
  supporting material.
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/lessons/:lessonId/resources` returns resources if the lesson is accessible.
  - [ ] File downloads issued as short-lived signed URLs; links returned as-is.
  - [ ] Tests: unenrolled → 403; signed URL expires.
- **Security:** same controlled-access model as video (F-703).

### Epic 10 — Progress Tracking

#### F-1001 — Lesson completion
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-605 (and F-704 for auto-complete)
- **User story:** As a student, I want lessons to be marked complete (manually, or
  automatically when I finish the video) so that I can track what I have done (§39).
- **Acceptance criteria:**
  - [ ] `lesson_progress` table: student_id, lesson_id, status (`not_started`/`in_progress`/`completed`), completed_at, timestamps. Unique (student_id, lesson_id).
  - [ ] `PUT /api/v1/me/lessons/:lessonId/progress` for manual complete/uncomplete.
  - [ ] Video completion threshold (F-704) auto-sets `completed`.
  - [ ] Tests: isolation per student (invariant 5); idempotent updates.
- **Security:** writes only for the caller; lesson must be accessible to the caller.

#### F-1002 — Course progress summary
- **Priority:** P1 · **Estimate:** S · **Depends on:** F-1001
- **User story:** As a student, I want to see percentage completion for each enrolled course
  so that I know how far along I am.
- **Acceptance criteria:**
  - [ ] `GET /api/v1/me/courses/:courseId/progress` returns completed / total published lessons and a percentage.
  - [ ] Only published lessons count toward the denominator.
  - [ ] Tests: percentage recomputes as lessons complete and as syllabus changes.
- **Security:** scoped to caller + enrollment.

#### F-1003 — Student dashboard: progress & continue-learning
- **Priority:** P1 · **Estimate:** S · **Depends on:** F-1002, F-1101
- **User story:** As a student, I want my dashboard to show per-course progress and a
  "continue where you left off" link so that I can resume quickly.
- **Acceptance criteria:**
  - [ ] Dashboard payload includes progress % per course and the last in-progress lesson.
  - [ ] Frontend renders progress bars.
  - [ ] Tests: reflects real progress data.
- **Security:** caller-scoped.

#### F-1004 — Teacher: view student progress
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-1002, F-503
- **User story:** As a teacher, I want to see progress for students in my assigned courses so
  that I can identify who is falling behind (§5.2, §39).
- **Acceptance criteria:**
  - [ ] `GET /api/v1/teacher/courses/:id/progress` returns per-student completion for that course.
  - [ ] Teacher restricted to assigned courses (else 403).
  - [ ] Read-only; teacher cannot alter student progress.
  - [ ] Tests: unassigned course → 403; data matches student-side numbers.
- **Security:** teacher sees learning progress only, not unrelated PII (§5.2, invariant 6).

### Epic 12 — Audit Logging

#### F-1201 — Audit log for administrative actions
- **Priority:** P1 · **Estimate:** M · **Depends on:** F-105
- **User story:** As an admin / security reviewer, I want a durable record of who did what to
  sensitive entities so that important changes are accountable (invariant 8, §32).
- **Acceptance criteria:**
  - [ ] `audit_events` table: actor_user_id, actor_role, action, entity_type, entity_id,
        summary/diff, request_id, ip, created_at. Append-only (no update/delete via app).
  - [ ] Middleware/helper records events for: user create/deactivate, role/permission changes,
        course publish/archive, enrollment create/status change, teacher assignment, live-class
        create/cancel, password reset issuance.
  - [ ] `GET /api/v1/admin/audit` — admin-only, paginated, filterable by actor/entity/date.
  - [ ] Audit writes never block the main action but failures are alerted.
  - [ ] Tests: each covered action produces exactly one event with correct actor.
- **Security:** audit log itself is read-only in the app; contains no plaintext secrets or
  full PII payloads.

---

## 7. Post-MVP (P2) — Explicitly Out of Scope

Listed only so architecture does not foreclose them (§7, §29 of the Master Prompt). **Do not
implement during MVP.**

- Video transcoding, multiple resolutions, adaptive bitrate streaming, CDN integration
- Native live classroom (WebRTC / SFU), attendance capture
- Assignments, quizzes, examinations, grading, certificates
- Payments, subscriptions, invoicing, coupons
- Notifications (email / SMS / WhatsApp), digests, reminders
- Public student self-registration and marketing site / course catalog
- Parent / guardian accounts
- Discussion forums, comments, community, messaging
- Advanced analytics and reporting dashboards
- Full-text search across content
- Mobile application, offline learning / downloads
- AI learning assistance
- Fine-grained custom permission/role editor (beyond the three fixed roles)
- Multi-tenant / multi-institution support

---

## 8. Suggested Build Sequence

One feature per development day (§22). Order respects dependencies and front-loads security
infrastructure. Re-plan after each milestone using real feedback (§27, §42).

### Phase A — Foundation (M0)
1. F-001 Repository & project setup
2. F-002 Backend skeleton
3. F-003 Database foundation
4. F-004 Configuration & environment
5. F-005 Structured logging & error handling
6. F-006 Testing foundation
7. F-007 Frontend skeleton
8. F-008 Local dev environment (Docker Compose)
9. F-009 CI pipeline

### Phase B — Identity & Access (M1)
10. F-101 User & Role data model
11. F-102 Password hashing
12. F-103 Login
13. F-105 Session middleware  ·  14. F-104 Logout
15. F-106 Role authorization middleware
16. F-107 `/me`  ·  17. F-108 Change own password
18. F-1301 Rate limiting  ·  19. F-1302 CSRF & cookie hardening
20. F-1303 Error/validation contract  ·  21. F-1304 Authorization test matrix
22. F-110 Account activation/deactivation

### Phase C — People & Courses (M1)
23. F-201 Admin: manage students
24. F-202 Admin: manage teachers
25. F-109 Admin-triggered password reset
26. F-203 Student profile  ·  27. F-204 Teacher profile
28. F-301 Admin: CRUD courses
29. F-302 Assign teachers to course
30. F-303 Course publish/unpublish

### Phase D — Enrollment & Syllabus (M1)
31. F-501 Admin: enroll student
32. F-502 Enrollment status changes
33. F-504 Enrollment authorization service
34. F-503 List enrollments
35. F-601 Subjects
36. F-602 Chapters
37. F-603 Lessons
38. F-604 Student: syllabus tree
39. F-605 Student: open a lesson

### Phase E — Dashboards → M1 complete
40. F-1101 Student dashboard
41. F-1102 Admin dashboard
42. F-1103 Teacher dashboard

**→ M1 review: internal pilot with a real course, real students, real enrollment.**

### Phase F — Content & Progress (M2)
43. F-701 Video entity
44. F-702 Secure video upload
45. F-703 Controlled video playback
46. F-704 Playback progress & resume
47. F-801 Schedule live class  ·  48. F-802 Edit/cancel live class
49. F-803 Student: view & join live classes
50. F-901 Attach resources  ·  51. F-902 Student: access resources
52. F-1001 Lesson completion  ·  53. F-1002 Course progress summary
54. F-1003 Dashboard progress  ·  55. F-1004 Teacher: student progress
56. F-1201 Audit logging
57. F-401 Batches  ·  58. F-402 Batch enrollment

**→ M2 review: MVP feature-complete. Gather feedback, then re-prioritize toward P2.**

---

## 9. Traceability to Master Prompt Invariants

| Invariant (§14) | Enforced primarily by |
|-----------------|-----------------------|
| 1 — Unauthorized access forbidden | F-106, F-504, F-1304; default-deny review rule |
| 2 — Authentication ≠ authorization | F-105 (status re-check), F-106, F-504 |
| 3 — Enrollment controls course access | F-501, F-504, F-604, F-703, F-803 |
| 4 — Content ownership relationship | F-101, F-301, F-601–F-603, F-701 |
| 5 — Student progress isolated | F-704, F-1001 (unique keys, caller-scoped writes) |
| 6 — Students cannot modify academic data | Role guards on all write endpoints; F-1304 |
| 7 — Frontend restrictions are not security | Every backend endpoint guarded; F-007 note |
| 8 — Administrative actions auditable | F-1201 (structured logs until then) |
| 9 — Deletes do not destroy history | D7 soft-delete convention across epics |
| 10 — Scalability without present complexity | Modular monolith (F-002), single Postgres, no premature infra |

---

## 10. Definition of Ready (before a feature enters a dev day)

- [ ] Expanded into the full Daily Development Format (§25).
- [ ] Open decisions it depends on (§1) are resolved.
- [ ] Dependencies listed here are complete.
- [ ] Acceptance criteria are testable.
- [ ] Security questions (§19) answered for this feature.
- [ ] Test plan covers happy path + authorization failure + validation failure.

## 11. Change Log

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-09-03 | Initial backlog derived from Master Project Prompt v1.0. |
| 1.1 | 2026-09-03 | Resolved D1–D9 with recommended defaults; §1 is now binding. Mirrored into Master Prompt §40. |
| 1.2 | 2026-09-03 | F-001 completed (repo structure, git hygiene, ESLint/Prettier, README, CONTRIBUTING). |
| 1.3 | 2026-09-03 | F-002 completed (Fastify skeleton, 12 module plugins, /api/v1/health, error contract, request context, helmet/CORS). |
