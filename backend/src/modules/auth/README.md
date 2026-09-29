# backend/src/modules/auth/

Authentication. So far: password hashing and policy (F-102). Login, sessions,
and logout land with F-103–F-105.

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
