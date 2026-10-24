# backend/src/modules/auth/

Authentication. So far: password hashing and policy (F-102), login with server-side sessions
(F-103), and the session middleware (F-105). Logout (F-104) comes next.

## Password hashing (`password.ts`)

| Function                         | Use                                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hashPassword(password)`         | argon2id hash (PHC string with its own salt and parameters) to store in `users.password_hash`.                                                                               |
| `verifyPassword(hash, password)` | `true` only on a match. Never throws: a `null` hash (a `pending` user), a malformed or tampered hash, a non-argon2id hash, or input over 1024 characters all return `false`. |
| `needsRehash(hash)`              | `true` when the stored hash used different costs than the current config. Login (F-103) should re-hash and store after a successful verify.                                  |

- **Algorithm:** argon2id via [`argon2`](https://github.com/ranisalt/node-argon2), not custom crypto (Master Prompt §12).
- **Costs:** `PASSWORD_HASH_MEMORY_KIB` / `PASSWORD_HASH_TIME_COST` / `PASSWORD_HASH_PARALLELISM`.
  The defaults are the OWASP minimum profile (19 MiB, t=2, p=1). Staging and production refuse
  anything below that. Development and test may go lower.
- **Stored-hash guard:** argon2 trusts the parameters inside a hash. `verifyPassword` rejects
  hashes asking for more than the config maximums (1 GiB, t=10, p=16), so a tampered row can't
  turn one login into a memory-exhaustion attack.
- **Normalization:** passwords are NFKC-normalized before hashing and verifying (NIST SP 800-63B),
  so the same passphrase typed on different platforms matches.
- **No pepper yet.** A server-side secret (argon2 `secret`) would need a key-management decision.
  Noted as future hardening.

## Password policy (`validatePasswordPolicy`)

Applied whenever a password is **set** (admin seed now; change-password F-108 and set-password
F-109 next). It isn't applied at login, where only `verifyPassword` runs. The rules follow
NIST SP 800-63B:

| Rule                                                                           | Why                                                                     |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 12–128 characters (Unicode code points, after NFKC)                            | Length is the strongest factor; the cap bounds work per request.        |
| **No** composition rules (upper/digit/symbol)                                  | NIST: they push users to predictable patterns. Passphrases are welcome. |
| Not a single repeated character                                                | Trivially guessable.                                                    |
| Not in the built-in common-password list                                       | Stops the most obvious choices that still meet the length rule.         |
| Must not contain the email local part (≥ 3 chars) or any name part (≥ 4 chars) | Context-specific words are among the first things an attacker tries.    |
| No control characters; not whitespace-only                                     | Avoids invisible or unenterable passwords.                              |

It returns **every** issue at once. Issues describe the rule and never echo the password.

**Future:** check against a breached-password corpus (e.g. HIBP k-anonymity range API) once an
outbound-network decision exists.

## Login (`POST /api/v1/auth/login`, F-103)

Body `{ email, password }`; any other field (e.g. `role`) is stripped by schema validation.
`200 { user: { id, fullName, role } }` plus the session cookie, with `Cache-Control: no-store`.

| Outcome                                                                   | Response                                      |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| Correct password, `active`, not soft-deleted                              | 200 + cookie                                  |
| Unknown email, wrong password, `pending`/`inactive`/soft-deleted, no hash | 401 `INVALID_CREDENTIALS`, no body difference |
| Over the throttle budget (checked before the password)                    | 429 `TOO_MANY_REQUESTS` + `Retry-After`       |
| Malformed body                                                            | 400 `VALIDATION_ERROR`                        |

- **No enumeration:** every non-throttled attempt runs one argon2 verify, against a dummy hash
  (current cost parameters, computed at startup) when the account doesn't exist or has no
  password. Account status is checked only after the password.
- **Rehash on login:** a hash made with outdated costs is replaced after a successful verify
  (best-effort; guarded so a concurrent password change wins).
- **Logging:** `auth.login.failed` with `reason` and the resolved `userId` (or null) and IP —
  never the password or the submitted email. `auth.login.succeeded`, `auth.login.throttled`.

### Sessions (`session.store.ts`, D2)

- ID: 32 random bytes, base64url. Redis key: `session:<sha256(id)>`, so stored keys aren't
  usable cookies.
- Value: `{ userId, role, createdAt, lastSeenAt, absoluteExpiresAt }`. Role is a snapshot; F-105
  re-reads the user on every request.
- Idle timeout 12h (the Redis TTL, slid by F-105). Absolute lifetime 7d (`absoluteExpiresAt`,
  enforced by F-105).
- Login destroys any session the browser already presented (fixation) and always issues a new ID.
- Cookie `__Host-lca_sid`: `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, `Max-Age` 7d.
  `SESSION_COOKIE_SECURE=false` (development/test only) drops `Secure` and the prefix (`lca_sid`).

### Throttling (`login-throttle.ts`)

Fixed 15-minute windows in Redis (`login-throttle:account:<sha256(email)>`,
`login-throttle:ip:<ip>`). Every attempt is counted atomically **before** the password check,
so parallel guesses can't race the counter; a successful login clears the account counter and
refunds its IP attempt, so both budgets effectively count failures.

- **Per account:** 5 failures, then 429 for the rest of the window — even with the right
  password. Unknown emails are counted the same way.
- **Per IP:** 50 failures. Generous because a classroom shares one NAT address; successful logins
  never spend it.
- Nothing locks permanently (that would let an attacker lock real users out).
- `request.ip` honours `X-Forwarded-For` only per `TRUST_PROXY` (default off). Behind a reverse
  proxy, set it to the hop count or the proxy's addresses, or every client shares the proxy's IP.

Redis down → login fails closed with a 500 (one quick retry, no unbounded queueing).

## Session middleware (`session.middleware.ts`, F-105)

`resolveSession` is a global `onRequest` hook; `requireAuth` is the `preHandler` a protected
route opts into (401 `UNAUTHORIZED` when there is no user). F-106's role guards go after it.

```ts
app.get('/me', { preHandler: requireAuth }, (request) => request.user);
```

Per request with a session cookie:

1. Session not in the store (idle-expired, logged out, forged) → unauthenticated.
2. Past `absoluteExpiresAt` (7d) → session destroyed, however active it was.
3. User re-read from Postgres: missing, not `active`, or soft-deleted → session destroyed.
   Deactivation therefore takes effect on the very next request, and reactivating doesn't
   revive the old session. Role and status always come from the row, not the session.
4. Otherwise `request.user = { id, role, status }` and the idle TTL slides
   (`touch`, written at most once per 60s, never past the absolute expiry, never reviving a
   destroyed session).

A cookie that doesn't resolve is cleared, and `auth.session.rejected` is logged with a reason.
Public routes still answer. No cookie means no Redis or database work. Redis or Postgres
errors propagate as a 500 (fail closed).

Tests inject a clock via `buildApp({ services: { clock } })`, and `MemorySessionStore` takes the
same clock, so idle and absolute expiry can be stepped through without waiting.
