# LCA LMS

**Learn Computer Academy — Learning Management System.**

A secure, scalable, low-bandwidth-friendly platform for LCA to manage students, teachers,
courses, syllabus, live classes, recorded lessons, and learning progress from one system.

Built as a **modular monolith** (Node.js + Fastify + TypeScript, PostgreSQL, Redis) with a
React + TypeScript web client, using a **security-first, one-feature-per-day** SDLC.

## Project documents

| Document | Purpose |
|----------|---------|
| [`docs/LCA LMS — Master Project Prompt v1.0.md`](docs/LCA%20LMS%20%E2%80%94%20Master%20Project%20Prompt%20v1.0.md) | Product vision, roles, domain model, core invariants, SDLC rules, architecture decisions. |
| [`docs/LCA LMS — MVP Feature Backlog and User Stories v1.0.md`](docs/LCA%20LMS%20%E2%80%94%20MVP%20Feature%20Backlog%20and%20User%20Stories%20v1.0.md) | 58 features across 14 epics; user stories, acceptance criteria, build sequence, decisions D1–D9. |

Read the Master Project Prompt before contributing.

## Repository layout

```
LCA-LMS/
├── backend/    # Fastify API — modular monolith         (skeleton: F-002)
├── frontend/   # React + TypeScript + Vite web client   (skeleton: F-007)
├── infra/      # docker-compose, CI, deployment configs  (scaffolded in F-008/F-009)
├── docs/       # project documents
└── (root)      # npm workspace root + shared tooling: ESLint, Prettier, EditorConfig
```

## Current status

**Milestone 0 — Platform Foundation.** In progress.

| Feature | Status |
|---------|--------|
| F-001 Repository & project setup | ✅ Done |
| F-002 Backend application skeleton | ✅ Done |
| F-003 Database foundation | ✅ Done |
| F-004 Configuration & environment | ✅ Done |
| F-005 Structured logging & error handling | ✅ Done |
| F-006 Automated testing foundation | ✅ Done |
| F-007 Frontend application skeleton | ✅ Done |
| F-008 Local development environment | ✅ Done |
| F-009 Continuous integration pipeline | Not started |

## Prerequisites

- **Node.js 22.x** (`.nvmrc` pins the major version — run `nvm use`)
- **npm 10+**
- **Docker** with the Compose v2 plugin (`docker compose`) — runs local Postgres + Redis

## Getting started

```bash
# 1. Use the pinned Node version
nvm use            # or: fnm use

# 2. Install shared tooling
npm install

# 3. Verify formatting and lint on the tree
npm run format:check
npm run lint
```

## Local development environment

Postgres 16 and Redis 7 run in Docker via `infra/docker-compose.yml` (local
development only — never a production manifest). The compose defaults match the
backend's zero-config fallback, so no `.env` file is needed to get started.

```bash
npm run services:up        # start Postgres (:5432) + Redis (:6379) in the background
npm run db:migrate         # apply database migrations

# Create the first administrator (there is no public sign-up — D1).
# Credentials come only from env vars or flags, never from source.
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='<12+ chars>' npm run db:seed:admin
#   or: npm run db:seed:admin -- --email you@example.com --password '<12+ chars>'

npm run dev:backend        # API on :3000
npm run dev:frontend       # web client on :5173
```

- `npm run services:down` stops the containers and keeps the data; `npm run services:reset`
  also deletes the data volumes (`pgdata`, `redisdata`).
- A port already in use? Copy `infra/.env.example` to `infra/.env` and change
  `POSTGRES_PORT` / `REDIS_PORT` (then set a matching `DATABASE_URL` in `backend/.env`).
- First start also creates an `lca_lms_test` database for the `test` profile.
- Until F-101 (user schema) and F-102 (password hashing) land, the seed command validates
  the credentials and database connection, then reports that the `users` table isn't ready.

Backend and frontend each have their own `README` with more detail.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run format` | Format the repo with Prettier |
| `npm run format:check` | Check formatting (used in CI) |
| `npm run lint` | Lint with ESLint |
| `npm run lint:fix` | Lint and auto-fix |
| `npm run typecheck` | Type-check every workspace |
| `npm run build` | Build every workspace |
| `npm test` | Run every workspace's tests |
| `npm run dev:backend` | Start the API in watch mode (port 3000) |
| `npm run dev:frontend` | Start the web client dev server (port 5173) |
| `npm run services:up` / `services:down` | Start / stop local Postgres + Redis (Docker) |
| `npm run services:reset` | Stop local services and delete their data volumes |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:seed:admin` | Create the first admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branch model, commit conventions, and the
per-feature Definition of Done.

## License

UNLICENSED — © Learn Computer Academy. Not for distribution.
