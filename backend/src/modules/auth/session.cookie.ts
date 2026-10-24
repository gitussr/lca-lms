/**
 * The session cookie (D2): `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
 *
 * With `Secure` on (always, outside development/test) the name carries the
 * `__Host-` prefix, which makes browsers refuse the cookie unless it is
 * Secure, host-only (no `Domain`) and `Path=/` — so a sibling subdomain can't
 * plant or shadow it.
 */
import type { CookieSerializeOptions } from '@fastify/cookie';

import { config } from '../../shared/config.js';
import { SESSION_ABSOLUTE_LIFETIME_SECONDS } from './session.store.js';

export function sessionCookieName(secure: boolean = config.sessionCookieSecure): string {
  return secure ? '__Host-lca_sid' : 'lca_sid';
}

export function sessionCookieOptions(
  secure: boolean = config.sessionCookieSecure,
): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    // The browser may keep it as long as the session can possibly live; the
    // server-side idle timeout and absolute expiry are what actually end it.
    maxAge: SESSION_ABSOLUTE_LIFETIME_SECONDS,
  };
}
