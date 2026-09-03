# backend/

The LCA LMS API — a **modular monolith** built with Node.js + Fastify + TypeScript
(see `docs/LCA LMS — Master Project Prompt v1.0.md` §16).

## Status

Skeleton scaffolded in **F-002**. Boots, serves `GET /api/v1/health`, and wires all 12
domain modules as (mostly empty) route plugins. No database, no auth, no business
endpoints yet.

Coming next:
- **F-003** — PostgreSQL connection pool + migrations
- **F-004** — schema-validated config (replaces `src/shared/config.ts`)
- **F-005** — structured logging + redaction
- **F-006** — full test harness (disposable DB, auth/request helpers, coverage)

## Layout

```
backend/
├── src/
│   ├── server.ts             # entrypoint: listen + graceful shutdown
│   ├── app.ts                # buildApp(): Fastify instance, plugins, module wiring
│   ├── shared/
│   │   ├── config.ts         # minimal env config (F-004 replaces this)
│   │   ├── errors.ts         # AppError hierarchy
│   │   ├── error-handler.ts  # global error + not-found handlers (standard shape)
│   │   ├── auth-context.ts   # AuthenticatedUser type for request.user (F-105 fills it)
│   │   └── pkg.ts            # runtime package version for /health
│   ├── types/
│   │   └── fastify.d.ts      # request.user augmentation
│   └── modules/
│       ├── health/           # GET /api/v1/health  (+ tests)
│       ├── auth/  users/  students/  teachers/  courses/  batches/
│       ├── enrollment/  syllabus/  lessons/  videos/
│       └── live-classes/  progress/
└── tsconfig.json
```

Each module exports a `FastifyPluginAsync` route-registration function; `app.ts` registers
every one at the shared `/api/v1` prefix. Modules own their own sub-paths
(`/admin/...`, `/me/...`, `/teacher/...` per architecture decision D9).

## Run

```bash
# from repo root
npm install
cp backend/.env.example backend/.env      # optional; defaults work for local dev

# dev server with reload
npm run dev:backend
#   -> http://localhost:3000/api/v1/health

# from backend/
npm run typecheck
npm test
npm run build && npm start
```

## Error response shape

Every error (handled or unhandled) returns:

```json
{ "error": { "code": "NOT_FOUND", "message": "…", "details": [] }, "requestId": "…" }
```

`details` appears only for validation errors. 5xx responses never include internal
messages or stack traces (Master Prompt §19 Q10). The correlation id is also returned in
the `x-request-id` response header and accepted from the same request header.
