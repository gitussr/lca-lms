/**
 * Password hashing & policy (F-102).
 *
 * Hashing: argon2id via the vetted `argon2` binding (node-argon2) — no custom
 * cryptography (Master Prompt §12). Cost parameters come from config
 * (`PASSWORD_HASH_*`, defaults = OWASP minimum profile). Each hash embeds its
 * own salt and parameters in PHC string form, so raising the costs later
 * leaves existing hashes verifiable; `needsRehash()` tells the login path
 * (F-103) when to upgrade one.
 *
 * Policy: see `validatePasswordPolicy()` and `backend/src/modules/auth/README.md`.
 *
 * Nothing here logs, and no error or policy issue ever contains the password.
 */
import argon2 from 'argon2';

import { config, type PasswordHashConfig } from '../../shared/config.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Upper bound on what `verifyPassword()` will even try to hash. Anything longer
 * can't have been accepted by the policy, so it's rejected without spending
 * CPU on it.
 */
const VERIFY_MAX_INPUT_LENGTH = 1024;

/**
 * Upper bounds on the parameters a stored hash may ask for, matching the
 * config ranges. `argon2.verify()` trusts the parameters inside the hash
 * string, so a tampered hash with an enormous memory cost could otherwise
 * make a single login attempt exhaust the server.
 */
const MAX_STORED_PARAMS = { memoryCost: 1048576, timeCost: 10, parallelism: 16 };

/**
 * `$argon2id$v=19$<params>$<salt>$<hash>`. The params segment is matched
 * loosely here and parsed below: node-argon2 emits `m,p,t` while the reference
 * implementation emits `m,t,p`, so key order must not matter.
 */
const ARGON2ID_PHC =
  /^\$argon2id\$v=19\$([a-z]=\d{1,8}(?:,[a-z]=\d{1,8}){2})\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

/**
 * NIST SP 800-63B §5.1.1.2: normalize Unicode so the same password typed on
 * different keyboards/OSes (composed vs decomposed characters) hashes the same.
 */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

export async function hashPassword(
  password: string,
  params: PasswordHashConfig = config.passwordHash,
): Promise<string> {
  return argon2.hash(normalize(password), {
    type: argon2.argon2id,
    memoryCost: params.memoryCost,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  });
}

/** Parses a stored argon2id PHC string, or returns null if it isn't one we accept. */
function parseStoredHash(hash: string): PasswordHashConfig | null {
  const segment = ARGON2ID_PHC.exec(hash)?.[1];
  if (!segment) return null;
  const params = new Map(
    segment.split(',').map((pair) => {
      const [key = '', value = ''] = pair.split('=');
      return [key, Number(value)] as const;
    }),
  );
  const memoryCost = params.get('m');
  const timeCost = params.get('t');
  const parallelism = params.get('p');
  if (params.size !== 3 || !memoryCost || !timeCost || !parallelism) return null;
  if (
    memoryCost > MAX_STORED_PARAMS.memoryCost ||
    timeCost > MAX_STORED_PARAMS.timeCost ||
    parallelism > MAX_STORED_PARAMS.parallelism
  ) {
    return null;
  }
  return { memoryCost, timeCost, parallelism };
}

/**
 * True only if `password` matches `hash`. Never throws for bad input: a
 * missing hash (a `pending` user), a malformed or tampered hash, a non-argon2id
 * hash, or an oversized password all simply fail to verify.
 */
export async function verifyPassword(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!hash || typeof password !== 'string' || password.length > VERIFY_MAX_INPUT_LENGTH) {
    return false;
  }
  if (!parseStoredHash(hash)) return false;
  try {
    return await argon2.verify(hash, normalize(password));
  } catch {
    return false;
  }
}

/**
 * True when a stored hash was made with different cost parameters than the
 * current config, so the login path (F-103) should re-hash the just-verified
 * password and store the new hash.
 */
export function needsRehash(
  hash: string,
  params: PasswordHashConfig = config.passwordHash,
): boolean {
  const stored = parseStoredHash(hash);
  if (!stored) return true;
  return (
    stored.memoryCost !== params.memoryCost ||
    stored.timeCost !== params.timeCost ||
    stored.parallelism !== params.parallelism
  );
}

// ── Policy ────────────────────────────────────────────────────────────────────

/**
 * Well-known passwords that pass the length rule. Not a substitute for a
 * breached-password check (documented as future work), just a floor against
 * the most obvious choices.
 */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789123',
  '111111111111',
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'password@123',
  'qwertyuiop12',
  'qwerty123456',
  'qwertyuiopasdf',
  'qwertyuiopasdfgh',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'iloveyou1234',
  'abcdefghijkl',
  'abcd12345678',
  'abc123456789',
  'administrator',
  'administrator1',
  'letmein12345',
  'welcome12345',
  'welcome@1234',
  'changeme1234',
  'sunshine1234',
  'football1234',
  'monkey123456',
  'princess1234',
  'baseball1234',
  'trustno1trustno1',
  'learncomputer',
  'learncomputeracademy',
  'lcalms123456',
]);

export interface PasswordContext {
  /** The account's email; the password may not contain its local part. */
  email?: string;
  /** The account's name; the password may not contain any part of it (≥ 4 chars). */
  fullName?: string;
}

/**
 * Applied whenever a password is set or reset (seed script now; F-108 change
 * password and F-109 set-password next). Follows NIST SP 800-63B: a length
 * floor, no composition rules, a blocklist, and no context-specific words.
 *
 * Returns every problem found (empty array = acceptable). Issues describe the
 * rule, never the password.
 */
export function validatePasswordPolicy(password: string, context: PasswordContext = {}): string[] {
  const issues: string[] = [];
  const normalized = normalize(password);
  const length = [...normalized].length; // code points, not UTF-16 units

  if (length < PASSWORD_MIN_LENGTH) {
    issues.push(`password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (length > PASSWORD_MAX_LENGTH) {
    issues.push(`password must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (/\p{Cc}/u.test(normalized)) {
    issues.push('password must not contain control characters');
  }
  if (normalized.trim().length === 0 && length > 0) {
    issues.push('password must not be only whitespace');
  }

  const lower = normalized.toLowerCase();
  if (length > 0 && new Set(lower).size === 1) {
    issues.push('password must not be a single repeated character');
  } else if (COMMON_PASSWORDS.has(lower)) {
    issues.push('password is too common');
  }

  const contextWords: string[] = [];
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3) contextWords.push(localPart);
  for (const part of context.fullName?.toLowerCase().split(/\s+/) ?? []) {
    if (part.length >= 4) contextWords.push(part);
  }
  if (contextWords.some((word) => lower.includes(word))) {
    issues.push('password must not contain your email address or name');
  }

  return issues;
}
