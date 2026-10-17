/**
 * BLD-12 — the builder's end-to-end OIDC login, against a real
 * Redis session store and an in-spec stub issuer.
 *
 * Every behavior here is a D-101/D-102/D-103/D-104 invariant, and
 * every one is asserted over real HTTP against real Redis from
 * `tooling/containers.ts` — the session records, their TTLs and the
 * PKCE stash are exactly the state a mock would invent rather than
 * observe:
 *
 * 1. `begin` creates the pre-login Redis session, sets the
 *    five-attribute `__Host-` cookie, and 302s to the issuer with
 *    `code_challenge_method=S256`.
 * 2. `callback` with a matching state exchanges the code (the stub
 *    verifies the S256 `code_verifier`), passes the D-102 acr/amr
 *    gate, auto-provisions a real_user (D-104), promotes the
 *    session, and 302s to `/`.
 * 3. A password-only `acr` is refused with 403 `AUTH_MFA_REQUIRED`
 *    and creates no session.
 * 4. A mismatched state (or a missing pre-login session) is refused
 *    closed — no code exchange is attempted.
 * 5. `/auth/me` resolves the session to the real_user_id; with no
 *    cookie it answers 401.
 */

import { createServer, type AddressInfo } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '@akane/platform';
import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

import { AuthModule } from './auth.module.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_KEY_PREFIX,
  type AuthenticatedSession,
} from './oidc.service.js';
import { StubOidcIssuer } from './oidc-issuer.stub.js';

/** The builder client the specs configure against the stub issuer. */
const CLIENT_ID = 'akane-builder';
const CLIENT_SECRET = 'akane-builder-secret';

const SUBJECT = 'stub-admin-0001';
const EMAIL = 'admin@example.com';

/**
 * Reserve an ephemeral loopback port. The API must listen on a
 * port the `OIDC_REDIRECT_URI` already names, and the redirect URI
 * is part of the OIDC config the module reads at boot — so the port
 * is reserved before the testing module is compiled.
 */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** The `name=value` pair of a Set-Cookie header, forwarded as a Cookie. */
function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}

/** The opaque session id inside a `__Host-akane_sid` Set-Cookie header. */
function sessionId(setCookie: string): string {
  const pair = cookiePair(setCookie);
  const value = pair.slice(SESSION_COOKIE_NAME.length + 1);
  expect(value).toMatch(/^[0-9a-f-]{36}$/);
  return value;
}

/** The opaque session id inside a `Cookie` request header pair. */
function sidFromCookie(cookie: string): string {
  const value = cookie.slice(SESSION_COOKIE_NAME.length + 1);
  expect(value).toMatch(/^[0-9a-f-]{36}$/);
  return value;
}

/** The five attributes D-101 mandates on the session cookie. */
function expectFiveCookieAttributes(setCookie: string): void {
  expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
  expect(setCookie).toMatch(/(?:^|;\s*)Path=\//);
  expect(setCookie).toMatch(/(?:^|;\s*)HttpOnly(?:;|$)/);
  expect(setCookie).toMatch(/(?:^|;\s*)Secure(?:;|$)/);
  expect(setCookie).toMatch(/(?:^|;\s*)SameSite=Strict(?:;|$)/);
  // The __Host- prefix forbids a Domain attribute outright.
  expect(setCookie).not.toMatch(/(?:^|;\s*)Domain=/);
}

describe('builder auth session (BLD-12, D-101/D-102/D-103/D-104)', () => {
  let containers: ThreeContainers;
  let issuer: StubOidcIssuer;
  let app: INestApplication;
  let apiOrigin: string;
  let redis: Redis;

  beforeAll(async () => {
    containers = await startThreeContainers();
    issuer = await StubOidcIssuer.start();

    const port = await reservePort();
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.OIDC_ISSUER = issuer.origin;
    process.env.OIDC_CLIENT_ID = CLIENT_ID;
    process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
    process.env.OIDC_REDIRECT_URI = `http://127.0.0.1:${port}/auth/oidc/callback`;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(port, '127.0.0.1');
    apiOrigin = `http://127.0.0.1:${port}`;

    redis = new Redis(containers.urls.cache);
    await redis.flushall();
  }, 180_000);

  afterAll(async () => {
    await redis?.quit();
    await app?.close();
    await issuer?.stop();
    await containers?.stop();
  });

  /**
   * Drive `begin` and return the pre-login cookie plus the
   * issuer's authorization URL the API 302ed to.
   */
  async function beginLogin(): Promise<{
    setCookie: string;
    location: string;
  }> {
    const response = await fetch(`${apiOrigin}/auth/oidc/begin`, {
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    const setCookie = response.headers.get('set-cookie') ?? '';
    const location = response.headers.get('location') ?? '';
    return { setCookie, location };
  }

  /**
   * Follow the authorization URL the API built, appending the
   * test-supplied login claims, and return the callback URL the
   * stub redirected back to.
   */
  async function authorizeAndReturnCallback(
    authorizationUrl: string,
    login: { subject?: string; role?: string; acr?: string; amr?: string } = {},
  ): Promise<string> {
    const url = new URL(authorizationUrl);
    if (login.subject !== undefined) url.searchParams.set('stub_subject', login.subject);
    if (login.role !== undefined) url.searchParams.set('stub_role', login.role);
    if (login.acr !== undefined) url.searchParams.set('stub_acr', login.acr);
    if (login.amr !== undefined) url.searchParams.set('stub_amr', login.amr);

    const response = await fetch(url.toString(), { redirect: 'manual' });
    expect(response.status).toBe(302);
    return response.headers.get('location') ?? '';
  }

  it('begin: 302 to the issuer with S256 and the five-attribute __Host- cookie', async () => {
    const { setCookie, location } = await beginLogin();

    // The five attributes, verbatim (T-06-08).
    expectFiveCookieAttributes(setCookie);

    // The redirect targets the stub issuer's authorization endpoint
    // with a code flow, a PKCE S256 challenge, and a state.
    const authorizationUrl = new URL(location);
    expect(authorizationUrl.origin).toBe(issuer.origin);
    expect(authorizationUrl.pathname).toBe('/authorize');
    const params = authorizationUrl.searchParams;
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe(CLIENT_ID);
    expect(params.get('redirect_uri')).toBe(process.env['OIDC_REDIRECT_URI']);
    expect(params.get('scope')).toBe('openid profile email');
    expect(params.get('code_challenge_method')).toBe('S256');
    // An S256 challenge is 43 base64url characters (SHA-256, no padding).
    expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const state = params.get('state');
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);

    // The pre-login session is stashed in Redis keyed by the opaque
    // cookie id, carrying the code_verifier and the state.
    const sid = sessionId(setCookie);
    const raw = await redis.get(`${SESSION_KEY_PREFIX}${sid}`);
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw as string);
    expect(record.stage).toBe('pre-login');
    expect(record.state).toBe(state);
    expect(record.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('callback: exchanges with S256, gates MFA, auto-provisions, promotes the session', async () => {
    const begin = await beginLogin();
    const preLoginCookie = cookiePair(begin.setCookie);

    const callbackUrl = await authorizeAndReturnCallback(begin.location, {
      subject: SUBJECT,
      role: 'global-admin',
    });
    const parsed = new URL(callbackUrl);
    expect(parsed.origin).toBe(apiOrigin);
    expect(parsed.pathname).toBe('/auth/oidc/callback');
    expect(parsed.searchParams.get('state')).toBe(
      new URL(begin.location).searchParams.get('state'),
    );

    const exchangesBefore = issuer.exchanges;
    const response = await fetch(callbackUrl, {
      redirect: 'manual',
      headers: { cookie: preLoginCookie },
    });

    // The exchange happened (the stub verified the S256 verifier).
    expect(issuer.exchanges).toBe(exchangesBefore + 1);
    expect(issuer.lastCodeExchange?.codeVerifier).toBeTruthy();

    // Login completes: 302 to the builder root, with a rotated
    // session id (the pre-login id must not survive promotion).
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    const sessionCookie = cookiePair(response.headers.get('set-cookie') ?? '');
    expect(sessionCookie).not.toBe(preLoginCookie);

    // The Redis session is promoted to the authenticated record.
    const record = JSON.parse(
      (await redis.get(`${SESSION_KEY_PREFIX}${sessionId(response.headers.get('set-cookie') ?? '')}`)) as string,
    );
    expect(record.stage).toBe('authenticated');
    expect(record.oidcSub).toBe(SUBJECT);
    expect(record.realUserId).toBeTruthy();
    expect(record.role).toBe('global-admin');
    expect(record.mfaAt).toBeTruthy();
    expect(record.refreshToken).toBeTruthy();
    expect(record.idpSessionExp).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // The pre-login session is gone — promotion consumed it.
    expect(await redis.get(`${SESSION_KEY_PREFIX}${sessionId(begin.setCookie)}`)).toBeNull();

    // /auth/me resolves the session to the real_user_id.
    const me = await fetch(`${apiOrigin}/auth/me`, {
      headers: { cookie: sessionCookie },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { real_user_id: string; mfa_at: number };
    expect(body.real_user_id).toBe(record.realUserId);
    expect(body.mfa_at).toBe(record.mfaAt);
  });

  it('callback: a second login for the same subject resolves to the same real_user_id (D-104)', async () => {
    const first = await completeLogin(SUBJECT);
    const second = await completeLogin(SUBJECT);

    expect(second.record.realUserId).toBe(first.record.realUserId);
  });

  it('callback: a password-only acr is refused with 403 AUTH_MFA_REQUIRED and creates no session', async () => {
    const begin = await beginLogin();
    const preLoginCookie = cookiePair(begin.setCookie);

    // A login whose authentication level is not MFA-strong (D-102).
    const callbackUrl = await authorizeAndReturnCallback(begin.location, {
      subject: SUBJECT,
      acr: 'password',
      amr: 'password',
    });

    const exchangesBefore = issuer.exchanges;
    const response = await fetch(callbackUrl, {
      redirect: 'manual',
      headers: { cookie: preLoginCookie },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'AUTH_MFA_REQUIRED' });
    expect(issuer.exchanges).toBe(exchangesBefore + 1);

    // No session was created: the pre-login cookie answers 401 on
    // /auth/me, and no authenticated record exists for it.
    const me = await fetch(`${apiOrigin}/auth/me`, {
      headers: { cookie: preLoginCookie },
    });
    expect(me.status).toBe(401);
  });

  it('callback: a mismatched state is refused closed before any exchange (T-06-05)', async () => {
    const begin = await beginLogin();
    const preLoginCookie = cookiePair(begin.setCookie);

    const callbackUrl = await authorizeAndReturnCallback(begin.location);
    const tampered = new URL(callbackUrl);
    tampered.searchParams.set('state', 'tampered-state');

    const exchangesBefore = issuer.exchanges;
    const response = await fetch(tampered.toString(), {
      redirect: 'manual',
      headers: { cookie: preLoginCookie },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'CSRF_STATE_MISMATCH' });
    // Refused closed: no code exchange was attempted.
    expect(issuer.exchanges).toBe(exchangesBefore);
  });

  it('callback: a missing pre-login session is refused closed before any exchange', async () => {
    const begin = await beginLogin();
    const callbackUrl = await authorizeAndReturnCallback(begin.location);

    const exchangesBefore = issuer.exchanges;
    const response = await fetch(callbackUrl, { redirect: 'manual' });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'SESSION_MISSING' });
    expect(issuer.exchanges).toBe(exchangesBefore);
  });

  it('me: answers 401 without a session cookie', async () => {
    const response = await fetch(`${apiOrigin}/auth/me`, { redirect: 'manual' });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'SESSION_MISSING' });
  });

  it('me: the cookie value carries no JWT structure (T-06-07)', async () => {
    const { setCookie } = await beginLogin();
    const sid = sessionId(setCookie);
    // A JWT is three base64url segments separated by dots; the
    // session id is a single opaque UUID.
    expect(sid).not.toContain('.');
    expect(sid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // -------------------------------------------------------------------- //
  // Task 2 — session middleware (T-06-04, D-103, logout)
  // -------------------------------------------------------------------- //

  it('middleware: state-changing calls without a same-origin Origin are refused (T-06-04)', async () => {
    const { cookie } = await completeLogin(SUBJECT);

    // An Origin-less mutation is refused. POST is the builder's
    // state-changing verb today (/auth/logout); the middleware
    // applies the same check to PUT/PATCH/DELETE, asserted here
    // against a cross-origin PUT — the check runs before routing,
    // so the 403 proves the method set, not a route.
    const absent = await fetch(`${apiOrigin}/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(absent.status).toBe(403);
    expect(await absent.json()).toMatchObject({ error: 'CSRF_ORIGIN_MISMATCH' });

    const crossOrigin = await fetch(`${apiOrigin}/auth/me`, {
      method: 'PUT',
      headers: { cookie, origin: 'https://evil.example.com' },
    });
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toMatchObject({
      error: 'CSRF_ORIGIN_MISMATCH',
    });

    const patch = await fetch(`${apiOrigin}/auth/me`, {
      method: 'PATCH',
      headers: { cookie, origin: 'https://evil.example.com' },
    });
    expect(patch.status).toBe(403);
    expect(await patch.json()).toMatchObject({
      error: 'CSRF_ORIGIN_MISMATCH',
    });

    const del = await fetch(`${apiOrigin}/auth/me`, {
      method: 'DELETE',
      headers: { cookie, origin: 'https://evil.example.com' },
    });
    expect(del.status).toBe(403);
    expect(await del.json()).toMatchObject({
      error: 'CSRF_ORIGIN_MISMATCH',
    });

    // A same-origin mutation passes the CSRF check and reaches
    // the route (the logout it targets answers, below).
    const sameOrigin = await fetch(`${apiOrigin}/auth/logout`, {
      method: 'POST',
      headers: { cookie, origin: apiOrigin },
    });
    expect(sameOrigin.status).toBe(200);
  });

  it('middleware: an expired IdP session forces re-login with 401 SESSION_EXPIRED (D-103)', async () => {
    const { cookie, record } = await completeLogin(SUBJECT);
    const sid = sidFromCookie(cookie);

    // The IdP session has ended: idpSessionExp is behind us.
    // The stored refresh token is still valid at the issuer —
    // a middleware that "silently renewed" would use it, so
    // the no-exchange assertion is what proves the refusal.
    const now = Math.floor(Date.now() / 1000);
    await forceSessionRecord(sid, {
      ...record,
      idpSessionIssuedAt: now - 7200,
      idpSessionExp: now - 60,
    });

    const exchangesBefore = issuer.exchanges;
    const me = await fetch(`${apiOrigin}/auth/me`, {
      headers: { cookie },
    });
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: 'SESSION_EXPIRED' });

    // Not silently renewed: no token exchange was attempted
    // for a session whose IdP session has already ended.
    expect(issuer.exchanges).toBe(exchangesBefore);
  });

  it('middleware: a session inside its renewal window is silently renewed (D-103)', async () => {
    const { cookie, record } = await completeLogin(SUBJECT);
    const sid = sidFromCookie(cookie);

    // Backdate the record: a 3600s IdP session lifetime with
    // only 100s remaining — inside the renewal window (less
    // than half the IdP session lifetime is left), so the
    // middleware exchanges the server-stored refresh token.
    const now = Math.floor(Date.now() / 1000);
    await forceSessionRecord(sid, {
      ...record,
      idpSessionIssuedAt: now - 3500,
      idpSessionExp: now + 100,
    });

    const exchangesBefore = issuer.exchanges;
    const me = await fetch(`${apiOrigin}/auth/me`, {
      headers: { cookie },
    });
    expect(me.status).toBe(200);

    // The refresh grant ran against the issuer, and the
    // rotated refresh token replaced the stored one.
    expect(issuer.exchanges).toBe(exchangesBefore + 1);
    const renewed = JSON.parse(
      (await redis.get(`${SESSION_KEY_PREFIX}${sid}`)) as string,
    ) as AuthenticatedSession;
    expect(renewed.idpSessionExp).toBeGreaterThan(now + 3000);
    expect(renewed.refreshToken).not.toBe(record.refreshToken);

    // The Redis TTL tracks the refreshed IdP session lifetime —
    // the only TTL input there is (D-103).
    const ttl = await redis.ttl(`${SESSION_KEY_PREFIX}${sid}`);
    expect(ttl).toBeGreaterThan(3000);
  });

  it('logout: destroys the Redis session and clears the __Host- cookie', async () => {
    const { cookie } = await completeLogin(SUBJECT);
    const sid = sidFromCookie(cookie);

    const response = await fetch(`${apiOrigin}/auth/logout`, {
      method: 'POST',
      headers: { cookie, origin: apiOrigin },
      redirect: 'manual',
    });
    expect(response.status).toBe(200);

    // The session record is gone from Redis.
    expect(await redis.get(`${SESSION_KEY_PREFIX}${sid}`)).toBeNull();

    // The cookie is cleared, with the same five attributes the
    // begin endpoint sets it with.
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/(?:^|;\s*)Max-Age=0(?:;|$)/);
    expectFiveCookieAttributes(setCookie);

    // A subsequent /auth/me is 401: the session no longer
    // resolves to anything.
    const me = await fetch(`${apiOrigin}/auth/me`, {
      headers: { cookie },
    });
    expect(me.status).toBe(401);
  });

  /**
   * Rewrite the authenticated session record behind a cookie
   * directly in Redis — the specs drive D-103's lifetime
   * legs (expired, renewal window) by backdating the
   * record the callback wrote, not by waiting on a clock.
   */
  async function forceSessionRecord(
    sid: string,
    overrides: Partial<AuthenticatedSession>,
    ttlSeconds = 3600,
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const record: AuthenticatedSession = {
      stage: 'authenticated',
      oidcSub: SUBJECT,
      realUserId: 'forced-real-user',
      role: 'global-admin',
      idpSessionIssuedAt: now - 60,
      idpSessionExp: now + 3600,
      mfaAt: new Date().toISOString(),
      refreshToken: '',
      ...overrides,
    };
    await redis.set(
      `${SESSION_KEY_PREFIX}${sid}`,
      JSON.stringify(record),
      'EX',
      ttlSeconds,
    );
  }

  /**
   * Drive a full login and return the authenticated session's
   * full Redis record and the cookie that resolves it.
   */
  async function completeLogin(
    subject: string,
    login: { role?: string } = {},
  ): Promise<{ cookie: string; record: AuthenticatedSession }> {
    const begin = await beginLogin();
    const callbackUrl = await authorizeAndReturnCallback(begin.location, {
      subject,
      ...login,
    });
    const response = await fetch(callbackUrl, {
      redirect: 'manual',
      headers: { cookie: cookiePair(begin.setCookie) },
    });
    expect(response.status).toBe(302);
    const cookie = cookiePair(response.headers.get('set-cookie') ?? '');
    const record = JSON.parse(
      (await redis.get(`${SESSION_KEY_PREFIX}${sessionId(response.headers.get('set-cookie') ?? '')}`)) as string,
    ) as AuthenticatedSession;
    return { cookie, record };
  }
});
