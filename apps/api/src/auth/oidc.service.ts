/**
 * The builder's OIDC login (BLD-12) and its session surface
 * (D-101/D-102/D-103/D-104).
 *
 * ## What this module owns
 *
 * - **`readOidcConfig()`** — the four OIDC env vars, read at
 *   module init with a named boot failure (`OIDC_CONFIG_INVALID`),
 *   the `read.module.ts` pattern.
 * - **`ACCEPTABLE_ACR_VALUES` / `isMfaStrong()`** — the D-102
 *   authentication-level gate, verified against the ID token's
 *   `acr`/`amr` claims on **every** login.
 * - **`BuilderSessionStore`** — the D-101 session store: opaque
 *   session ids in Redis, pre-login PKCE state, and the
 *   authenticated record whose TTL tracks the IdP session
 *   (D-103). The OIDC subject lives only here — it is never
 *   minted into a our-own token (the PII-in-JWT constraint).
 * - **`OidcService`** — the `begin`/`callback` orchestration
 *   (authorization code + PKCE, S256) over `openid-client`.
 *
 * ## Why the session record lives here
 *
 * The session middleware (task 2) reads exactly this record
 * shape, and the pre-login stash it consumes is written by the
 * callback's counterpart here — one file owns the whole record
 * lifecycle so the two halves cannot drift apart.
 */

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import * as oidcClient from 'openid-client';

import { REDIS_CACHE } from '@akane/platform';

import { OidcProvisionService } from '@akane/domain';

/**
 * The OIDC configuration, read from the live environment at
 * module init. Intentionally **not** part of the frozen
 * `AppConfigSchema`: like `READ_LINK_CONFIG_KEYS`, these are
 * read directly from `process.env` so a deployment that sets a
 * differently-named variable gets the named refusal rather
 * than a silent default.
 */
export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** The env vars {@link readOidcConfig} requires at boot. */
export const OIDC_CONFIG_KEYS = [
  'OIDC_ISSUER',
  'OIDC_CLIENT_ID',
  'OIDC_CLIENT_SECRET',
  'OIDC_REDIRECT_URI',
] as const;

/**
 * Read the OIDC configuration, refusing boot when any of the
 * four vars is absent. The failure names every missing key so
 * a misconfigured deployment cannot start cleanly and fail on
 * the first login.
 */
export function readOidcConfig(): OidcConfig {
  const missing = OIDC_CONFIG_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `OIDC_CONFIG_INVALID: must set ${missing.join(', ')}`,
    );
  }
  return {
    issuer: process.env['OIDC_ISSUER']!,
    clientId: process.env['OIDC_CLIENT_ID']!,
    clientSecret: process.env['OIDC_CLIENT_SECRET']!,
    redirectUri: process.env['OIDC_REDIRECT_URI']!,
  };
}

/**
 * Run openid-client discovery, cached once at module init
 * (T-06-09: a slow IdP degrades login latency, not security —
 * the discovery itself happens at boot).
 *
 * Production discovers over HTTPS only. A non-production
 * process may point at an `http://` issuer — the integration
 * specs run an in-spec stub issuer on loopback — so the
 * insecure-requests allowance is gated on `NODE_ENV`: a
 * production boot against an `http://` issuer still fails
 * discovery, loudly.
 */
export async function discoverOidcClient(
  config: OidcConfig,
): Promise<oidcClient.Configuration> {
  const server = new URL(config.issuer);
  const insecure =
    process.env.NODE_ENV !== 'production' && server.protocol === 'http:';
  const configuration = await oidcClient.discovery(
    server,
    config.clientId,
    config.clientSecret,
    undefined,
    insecure ? { execute: [oidcClient.allowInsecureRequests] } : undefined,
  );
  if (insecure) {
    // The grant requests (authorize/token) also run over http
    // in a non-production process; the Configuration's own
    // tlsOnly flag is what gates them.
    oidcClient.allowInsecureRequests(configuration);
  }
  return configuration;
}

/** DI token for the cached openid-client `Configuration`. */
export const OIDC_CLIENT = Symbol('OIDC_CLIENT');

/**
 * The authentication context class references (D-102) that count
 * as MFA-strong.
 *
 * The enterprise IdP's actual values are unknown until the S3
 * customer question is answered (Open Question 1) — a
 * Keycloak-style `mfa` / `phr` pair is the test default. The
 * acceptable set lives in **one** named constant here, never
 * spread across call sites, so the deployment's values have a
 * single place to change.
 */
export const ACCEPTABLE_ACR_VALUES = Object.freeze(['mfa', 'phr']);

/**
 * Is this login's authentication level MFA-strong (D-102)?
 *
 * Checked against the ID token's `acr` claim, or — when the
 * IdP reports the methods instead — against the `amr` array.
 * A login that is not MFA-strong is refused with
 * `AUTH_MFA_REQUIRED`; there is no homegrown MFA prompt.
 */
export function isMfaStrong(acr: unknown, amr: unknown): boolean {
  const acceptable = ACCEPTABLE_ACR_VALUES as readonly string[];
  if (typeof acr === 'string' && acceptable.includes(acr)) {
    return true;
  }
  if (Array.isArray(amr)) {
    return amr.some(
      (method) => typeof method === 'string' && acceptable.includes(method),
    );
  }
  return false;
}

/** The session cookie name. The `__Host-` prefix is part of the security posture. */
export const SESSION_COOKIE_NAME = '__Host-akane_sid';

/** The Redis key prefix for session records. */
export const SESSION_KEY_PREFIX = 'ak:sess:';

/**
 * The five attributes D-101 mandates on the session cookie:
 * the `__Host-` prefix (which itself requires `Path=/`,
 * `Secure` and no `Domain`), `HttpOnly` (no script can read
 * the session id), and `SameSite=Strict` (CSRF's structural
 * layer).
 */
export const SESSION_COOKIE_ATTRIBUTES = Object.freeze({
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
});

/**
 * A pre-login session: the PKCE `code_verifier` and `state`
 * stashed server-side between `begin` and `callback` (the
 * openid-client contract — the verifier and state must never
 * travel through the browser). Its TTL is the authorization
 * code exchange window, not a session policy: D-103's
 * "the IdP session is the only TTL input" governs
 * *authenticated* sessions.
 */
export interface PreLoginSession {
  readonly stage: 'pre-login';
  readonly code_verifier: string;
  readonly state: string;
}

/**
 * An authenticated builder session. The OIDC subject and the
 * role live only in this server-side record — nothing of it is
 * ever minted into a our-own token or handed to the SPA (the
 * PII-in-JWT constraint, D-101).
 *
 * `idpSessionExp`/`idpSessionIssuedAt` are the D-103 lifetime
 * tracking: the session lives exactly as long as the IdP
 * session does, and the renewal window is derived from the
 * two — there is no second, independently-configured expiry.
 */
export interface AuthenticatedSession {
  readonly stage: 'authenticated';
  readonly oidcSub: string;
  readonly realUserId: string;
  readonly role: string;
  readonly idpSessionIssuedAt: number;
  readonly idpSessionExp: number;
  readonly mfaAt: string;
  readonly refreshToken: string;
}

/** Every session record the store holds. */
export type BuilderSession = PreLoginSession | AuthenticatedSession;

/**
 * The Redis-backed session store (D-101, AD-9: all session
 * state in Redis, application services stateless).
 *
 * Session ids are opaque UUIDs — never a JWT, never anything
 * with structure a script could profit from (T-06-07).
 */
@Injectable()
export class BuilderSessionStore {
  constructor(@Inject(REDIS_CACHE) private readonly redis: Redis) {}

  /** Create a session record with a fresh opaque id and TTL. */
  async create(session: BuilderSession, ttlSeconds: number): Promise<string> {
    const id = randomUUID();
    await this.redis.set(
      `${SESSION_KEY_PREFIX}${id}`,
      JSON.stringify(session),
      'EX',
      ttlSeconds,
    );
    return id;
  }

  /** Read a session record by id, or null when absent or unreadable. */
  async get(id: string): Promise<BuilderSession | null> {
    const raw = await this.redis.get(`${SESSION_KEY_PREFIX}${id}`);
    if (raw === null) {
      return null;
    }
    try {
      return JSON.parse(raw) as BuilderSession;
    } catch {
      return null;
    }
  }

  /**
   * Rotate a session: create the new record, then destroy the
   * old one. Used to promote a pre-login session — the
   * pre-login id must not survive the privilege change (the
   * fixation defense), so the caller re-sets the cookie with
   * the returned id.
   */
  async replace(
    oldId: string,
    session: BuilderSession,
    ttlSeconds: number,
  ): Promise<string> {
    const id = await this.create(session, ttlSeconds);
    await this.redis.del(`${SESSION_KEY_PREFIX}${oldId}`);
    return id;
  }

  /** Rewrite a record in place with a new TTL (silent renewal). */
  async extend(
    id: string,
    session: BuilderSession,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      `${SESSION_KEY_PREFIX}${id}`,
      JSON.stringify(session),
      'EX',
      ttlSeconds,
    );
  }

  /** Destroy a session record. */
  async destroy(id: string): Promise<void> {
    await this.redis.del(`${SESSION_KEY_PREFIX}${id}`);
  }
}

/** The pre-login stash TTL: the authorization-code exchange window. */
export const PRE_LOGIN_TTL_SECONDS = 120;

/**
 * Read the opaque session id from the `Cookie` header.
 *
 * Express does not parse cookies without `cookie-parser`, and
 * the session cookie is the only cookie this surface sets, so
 * the two-line parse here is the whole dependency — no second
 * package for one header.
 */
export function readSessionId(req: Request): string | null {
  const header = req.headers.cookie;
  if (typeof header !== 'string') {
    return null;
  }
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      const value = trimmed.slice(SESSION_COOKIE_NAME.length + 1);
      return value === '' ? null : value;
    }
  }
  return null;
}

/**
 * The OIDC service: `begin` issues the authorization redirect,
 * `callback` completes it. Every login passes through the same
 * five steps, in order:
 *
 * 1. `begin` — generate the PKCE pair, stash the verifier and
 *    a fresh `state` server-side, set the five-attribute
 *    `__Host-` cookie, 302 to the IdP.
 * 2. `callback` — refuse closed when the pre-login session or
 *    its `state` is absent or mismatched (T-06-05: **before**
 *    any exchange).
 * 3. Exchange the code with the stashed `code_verifier`
 *    (`authorizationCodeGrant`, PKCE S256).
 * 4. Gate the login on the ID token's `acr`/`amr` claims
 *    (D-102) — a non-MFA-strong login is refused with
 *    `AUTH_MFA_REQUIRED`.
 * 5. Auto-provision the `real_user` (D-104) and promote the
 *    session, whose TTL tracks the IdP session (D-103).
 */
@Injectable()
export class OidcService {
  constructor(
    @Inject('OIDC_CONFIG') private readonly config: OidcConfig,
    @Inject(OIDC_CLIENT) private readonly client: oidcClient.Configuration,
    private readonly sessions: BuilderSessionStore,
    private readonly provision: OidcProvisionService,
  ) {}

  /** `GET /auth/oidc/begin` — start the OIDC login. */
  async begin(res: Response): Promise<void> {
    const state = oidcClient.randomState();
    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(
      codeVerifier,
    );

    // The verifier and state are stashed server-side; the
    // browser carries only the opaque session id.
    const sessionId = await this.sessions.create(
      { stage: 'pre-login', code_verifier: codeVerifier, state },
      PRE_LOGIN_TTL_SECONDS,
    );

    res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_ATTRIBUTES);

    const authorizationUrl = oidcClient.buildAuthorizationUrl(this.client, {
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });

    res.redirect(302, authorizationUrl.href);
  }

  /** `GET /auth/oidc/callback` — complete the OIDC login. */
  async callback(req: Request, res: Response): Promise<void> {
    const sessionId = readSessionId(req);
    if (sessionId === null) {
      res.status(401).json({ error: 'SESSION_MISSING' });
      return;
    }
    const preLogin = await this.sessions.get(sessionId);
    if (preLogin === null || preLogin.stage !== 'pre-login') {
      // Refused closed: no exchange is attempted for a request
      // with no pre-login session to verify against.
      res
        .status(401)
        .json({ error: preLogin === null ? 'SESSION_MISSING' : 'SESSION_INVALID' });
      return;
    }

    // T-06-05: the state is compared against the server-side
    // stash **before** any network call to the IdP.
    const currentUrl = new URL(
      `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    );
    const returnedState = currentUrl.searchParams.get('state');
    if (returnedState === null || returnedState !== preLogin.state) {
      res.status(403).json({ error: 'CSRF_STATE_MISMATCH' });
      return;
    }

    const tokens = await oidcClient.authorizationCodeGrant(
      this.client,
      currentUrl,
      {
        pkceCodeVerifier: preLogin.code_verifier,
        expectedState: preLogin.state,
      },
    );

    // D-102: verify the authentication level on every login.
    const claims = (tokens.claims() ?? {}) as Record<string, unknown>;
    if (!isMfaStrong(claims['acr'], claims['amr'])) {
      res.status(403).json({ error: 'AUTH_MFA_REQUIRED' });
      return;
    }

    // D-104: auto-provision on first SSO login. The subject is
    // a mapping key, never a token claim (PII-in-JWT).
    const oidcSub = String(claims['sub']);
    const email = typeof claims['email'] === 'string' ? claims['email'] : undefined;
    const role = typeof claims['role'] === 'string' ? claims['role'] : 'owner';
    const { realUserId } = await this.provision.upsertFromOidc(oidcSub, email);

    // D-103: the session lifetime is the IdP session lifetime.
    // A token response that carries no expiry cannot be
    // tracked, so the login is refused rather than silently
    // minted against an untrackable session.
    const expiresIn = tokens.expiresIn();
    if (expiresIn === undefined || expiresIn <= 0) {
      res.status(500).json({ error: 'AUTH_SESSION_UNTRACKABLE' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const promotedId = await this.sessions.replace(
      sessionId,
      {
        stage: 'authenticated',
        oidcSub,
        realUserId,
        role,
        idpSessionIssuedAt: now,
        idpSessionExp: now + expiresIn,
        mfaAt: new Date().toISOString(),
        refreshToken: tokens.refresh_token ?? '',
      },
      expiresIn,
    );

    res.cookie(SESSION_COOKIE_NAME, promotedId, SESSION_COOKIE_ATTRIBUTES);
    res.redirect(302, '/');
  }

  /**
   * Resolve the request's session cookie to its authenticated
   * record — the `request.user` source the session middleware
   * and `/auth/me` both build on.
   */
  async readSession(req: Request): Promise<AuthenticatedSession | null> {
    const sessionId = readSessionId(req);
    if (sessionId === null) {
      return null;
    }
    const session = await this.sessions.get(sessionId);
    if (session === null || session.stage !== 'authenticated') {
      return null;
    }
    return session;
  }

  /**
   * Exchange the server-stored refresh token for a fresh IdP
   * session (D-103's silent renewal).
   *
   * Returns the extended session record, or null when the
   * grant failed — the IdP session has ended, and the caller
   * must force a full re-login. No error escapes: a failed
   * renewal is an ended session, not a crash.
   */
  async refreshAuthenticated(
    session: AuthenticatedSession,
  ): Promise<AuthenticatedSession | null> {
    if (session.refreshToken === '') {
      // The IdP issued no refresh token: the session lives
      // exactly until the IdP session expires, then ends.
      return null;
    }
    try {
      const tokens = await oidcClient.refreshTokenGrant(
        this.client,
        session.refreshToken,
      );
      const expiresIn = tokens.expiresIn();
      if (expiresIn === undefined || expiresIn <= 0) {
        return null;
      }
      const now = Math.floor(Date.now() / 1000);
      return {
        ...session,
        idpSessionIssuedAt: now,
        idpSessionExp: now + expiresIn,
        refreshToken: tokens.refresh_token ?? session.refreshToken,
      };
    } catch {
      return null;
    }
  }
}
