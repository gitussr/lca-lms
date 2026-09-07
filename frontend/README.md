# frontend/

The LCA LMS web client — **React 19 + TypeScript + Vite** (see
`docs/LCA LMS — Master Project Prompt v1.0.md` §15, §17).

Talks only to the backend REST API under `/api/v1` — never directly to the database
(Master Prompt §17). The backend is the sole authority on authentication and
authorization; everything here is a UX convenience (core invariant 7).

## Run it

```bash
npm install                 # from the repo root (workspaces)
cp frontend/.env.example frontend/.env.local   # optional — defaults work

# terminal 1 — backend (port 3000)
npm run dev:backend

# terminal 2 — frontend (port 5173, proxies /api -> backend)
npm run dev:frontend
```

Open http://localhost:5173. With no session and no `/me` endpoint yet, every
route redirects to `/login`.

## Scripts (`npm run <script> --workspace @lca-lms/frontend`)

| Script | Description |
|--------|-------------|
| `dev` | Vite dev server on :5173 with `/api` proxied to the backend |
| `build` | Type-check, then production build to `dist/` |
| `preview` | Serve the built `dist/` on :4173 |
| `typecheck` | `tsc --noEmit` |
| `test` | Run the Vitest suite once |
| `test:watch` | Vitest in watch mode |
| `test:coverage` | Vitest with V8 coverage |

## Layout

```
src/
├── api/          # central fetch client — base URL, credentials, error parsing
│   └── client.ts   -> api.get/post/patch/put/delete, ApiError, NetworkError
├── auth/         # session context + route guard
│   ├── AuthProvider.tsx   resolves GET /me once, exposes refresh()/logout()
│   ├── useAuth.ts
│   ├── ProtectedRoute.tsx guard: loading -> loader, no session -> /login, wrong role -> own home
│   └── types.ts           CurrentUser, UserRole, homePathForRole()
├── components/   # UI primitives: Spinner, LoadingScreen, ErrorState, ErrorBoundary
├── layouts/      # AppShell + Student/Teacher/Admin shells (empty nav for now)
├── pages/        # LoginPage, NotFoundPage, PlaceholderDashboard
├── AppRoutes.tsx # route table
├── App.tsx       # ErrorBoundary > BrowserRouter > AuthProvider > AppRoutes
└── main.tsx      # createRoot
```

## Environment

Only `VITE_`-prefixed vars reach client code.

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_BASE_URL` | `/api/v1` | Path the API client prepends to every request |
| `VITE_API_PROXY_TARGET` | `http://localhost:3000` | Where `npm run dev` proxies `/api` |

## Conventions

- **The backend validates, not the client.** Client-side checks are for UX; assume
  every request can be replayed or forged.
- All server calls go through `src/api/client.ts` so credentials and error parsing
  stay in one place.
- New authenticated areas: add a `<Route element={<ProtectedRoute allow={[...]} />}>`
  wrapper in `AppRoutes.tsx`, then a layout under `layouts/`.
