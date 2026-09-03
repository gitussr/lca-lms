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
├── frontend/   # React + TypeScript web client          (scaffolded in F-007)
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
| F-003 Database foundation | Not started |
| F-004 Configuration & environment | Not started |
| F-005 Structured logging & error handling | Not started |
| F-006 Automated testing foundation | Not started |
| F-007 Frontend application skeleton | Not started |
| F-008 Local development environment | Not started |
| F-009 Continuous integration pipeline | Not started |

## Prerequisites

- **Node.js 22.x** (`.nvmrc` pins the major version — run `nvm use`)
- **npm 10+**
- Docker + Docker Compose (from F-008 onward, for Postgres + Redis)

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

Backend and frontend each get their own `README` with run instructions once scaffolded.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run format` | Format the repo with Prettier |
| `npm run format:check` | Check formatting (used in CI) |
| `npm run lint` | Lint with ESLint |
| `npm run lint:fix` | Lint and auto-fix |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the branch model, commit conventions, and the
per-feature Definition of Done.

## License

UNLICENSED — © Learn Computer Academy. Not for distribution.
