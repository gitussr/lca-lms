# backend/

The LCA LMS API — a **modular monolith** built with Node.js + Fastify + TypeScript
(see `docs/LCA LMS — Master Project Prompt v1.0.md` §16).

> **Not scaffolded yet.** Feature **F-002 — Backend application skeleton** creates the
> Fastify app, module folders (`auth/ users/ students/ teachers/ courses/ batches/
> enrollment/ syllabus/ lessons/ videos/ live-classes/ progress/`), the `/api/v1/health`
> endpoint, and the global error handler.

## Planned module layout

```
backend/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── students/
│   │   ├── teachers/
│   │   ├── courses/
│   │   ├── batches/
│   │   ├── enrollment/
│   │   ├── syllabus/
│   │   ├── lessons/
│   │   ├── videos/
│   │   ├── live-classes/
│   │   └── progress/
│   ├── shared/          # config, db, logging, errors, auth middleware
│   └── app.ts
└── package.json
```
