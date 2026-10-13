/**
 * The builder's session middleware (T-06-04, D-101, D-103).
 *
 * ~120 lines, hand-rolled over the existing ioredis
 * connection (Don't Hand-Roll #5): D-101's session
 * semantics — pre-login PKCE stash, IdP-session-lifetime
 * tracking, OIDC-subject linkage, `__Host-` cookie
 * issuance — are bespoke. `express-session` +
 * `connect-redis` remains the documented fallback if the
 * semantics ever outgrow this file.
 *
 * ## What runs, in order
 *
 * 1. **CSRF origin check** (T-06-04) — the structural
 *    layer is the `SameSite=Strict` cookie; this is the
 *    D-101 second layer: a state-changing method
 *    (POST/PUT/PATCH/DELETE) whose `Origin` is absent or
 *    cross-origin is refused with 403 `CSRF_ORIGIN_MISMATCH`
 *    before any session work.
 * 2. **Session resolution** — the opaque `__Host-akane_sid`
 *    cookie resolves to the Redis record. No cookie, no
 *    record, or a pre-login record answers 401
 *    `SESSION_MISSING` — never a silent anonymous pass.
 * 3. **Lifetime** (D-103) — a session whose
 *    `idpSessionExp` has passed answers 401
 *    `SESSION_EXPIRED`. There is **no second,
 *    independently-configured expiry policy**: the only
 *    TTL input is the IdP session. Inside the renewal
 *    window (less than half the IdP session lifetime
 *    remaining — a fraction of the IdP session itself,
 *    not a new policy) the server-stored refresh token
 *    is exchanged and the Redis TTL extended to the
 *    refreshed IdP lifetime; a failed exchange means the
 *    IdP session has ended, and a full re-login is forced.
 * 4. **Principal** — `req.user` is set to
 *    `{ realUserId, oidcSub, role, mfaAt }`. The OIDC
 *    subject stays server-side only (the PII-in-JWT
 *    constraint); nothing of it is ever minted into a
 *    token or handed to the SPA.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  BuilderSessionStore,
  readSessionId,
} from './oidc.service.js';
import { OidcService } from './oidc.service.js';

/**
 * The HTTP methods that change state and therefore carry
 * the CSRF origin check. GET/HEAD/OPTIONS are safe
 * methods and are not checked.
 */
const STATE_CHANGING_METHODS = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/**
 * Renew when less than this fraction of the IdP session
 * lifetime remains. The window is *derived from the IdP
 * session* (`idpSessionIssuedAt`/`idpSessionExp`), so it
 * introduces no second expiry policy — D-103's only TTL
 * input remains the IdP session.
 */
const RENEWAL_FRACTION = 0.5;

/**
 * How long the single-flight renewal lock (see
 * `BuilderSessionStore.renewLock`) is held: long enough
 * to cover one refresh grant, short enough that a
 * crashed holder cannot strand the session inside the
 * renewal window.
 */
const RENEW_LOCK_TTL_MS = 10_000;

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(
    private readonly sessions: BuilderSessionStore,
    private readonly oidc: OidcService,
  ) {}

  async use(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // T-06-04: the D-101 second layer. A mutation with no
    // Origin (non-browser client, or a stripped header) or
    // a foreign Origin is refused before any session read.
    if (STATE_CHANGING_METHODS.has(req.method)) {
      const origin = req.get('origin');
      const host = req.get('host');
      let sameOrigin = false;
      if (origin !== undefined && host !== undefined) {
        try {
          sameOrigin = new URL(origin).host === host;
        } catch {
          sameOrigin = false;
        }
      }
      if (!sameOrigin) {
        res.status(403).json({ error: 'CSRF_ORIGIN_MISMATCH' });
        return;
      }
    }

    const sessionId = readSessionId(req);
    if (sessionId === null) {
      res.status(401).json({ error: 'SESSION_MISSING' });
      return;
    }
    const session = await this.sessions.get(sessionId);
    if (session === null || session.stage !== 'authenticated') {
      res.status(401).json({ error: 'SESSION_MISSING' });
      return;
    }

    // D-103: the IdP session is the only expiry authority.
    const now = Math.floor(Date.now() / 1000);
    if (session.idpSessionExp <= now) {
      // The IdP session has ended. Refuse — never a silent
      // renewal of a session whose IdP session is gone.
      res.status(401).json({ error: 'SESSION_EXPIRED' });
      return;
    }

    let authenticated = session;
    const lifetime = session.idpSessionExp - session.idpSessionIssuedAt;
    const remaining = session.idpSessionExp - now;
    if (remaining < lifetime * RENEWAL_FRACTION) {
      // Inside the renewal window: exchange the
      // server-stored refresh token (never browser-visible)
      // and extend the Redis TTL to the refreshed IdP
      // session lifetime. A failed exchange means the IdP
      // session has ended — force a full re-login.
      //
      // Single-flight: only the request that acquires the
      // renewal lock fires the grant. A concurrent burst
      // would each present the same refresh token, and the
      // IdP's rotation makes every loser's grant fail — a
      // spurious forced re-login for a live session. A lost
      // lock means another request is renewing this same
      // session right now, so this request proceeds on the
      // record that renewal is extending.
      const renewing = await this.sessions.renewLock(
        sessionId,
        RENEW_LOCK_TTL_MS,
      );
      if (renewing) {
        const renewed = await this.oidc.refreshAuthenticated(session);
        if (renewed === null) {
          res.status(401).json({ error: 'SESSION_EXPIRED' });
          return;
        }
        // The extended TTL is measured from the refreshed
        // session's own clock, not the request's start —
        // the grant consumed time, and the lifetime must
        // not silently under-count it.
        const renewedAt = Math.floor(Date.now() / 1000);
        await this.sessions.extend(
          sessionId,
          renewed,
          renewed.idpSessionExp - renewedAt,
        );
        authenticated = renewed;
      }
    }

    req.user = {
      realUserId: authenticated.realUserId,
      oidcSub: authenticated.oidcSub,
      role: authenticated.role,
      mfaAt: authenticated.mfaAt,
    };
    next();
  }
}
