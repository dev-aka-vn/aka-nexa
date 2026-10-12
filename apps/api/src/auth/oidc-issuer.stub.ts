/**
 * An in-spec OIDC issuer for the builder-auth integration specs.
 *
 * The builder login (BLD-12) completes an OIDC authorization-code +
 * PKCE exchange against the corporate IdP. No corporate IdP exists in
 * a test run, and mocking `openid-client` would assert the shape of a
 * call rather than the outcome of a protocol — the exact failure mode
 * `tooling/containers.ts` documents for Redis semantics. This stub is
 * instead a *minimal real issuer*: it serves discovery metadata, a JWKS,
 * an authorize endpoint that issues single-use codes bound to a PKCE
 * challenge, and a token endpoint that verifies the `code_verifier`
 * against that challenge (S256) before issuing jose-signed ID tokens.
 *
 * Every login parameter that the specs vary — the subject, the builder
 * role, the `acr`/`amr` authentication strength (D-102) — is a
 * query parameter the *test* appends to the authorization URL the API
 * builds (`stub_subject`, `stub_role`, `stub_acr`, `stub_amr`,
 * `stub_email`). That keeps the issuer stateless across logins: one
 * issuer instance serves every test in the suite, each login carrying
 * exactly the claims that test needs.
 *
 * The stub is test infrastructure, not a production surface: it is
 * never imported outside the specs in this directory.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/** The subject the stub issues when the authorization request carries none. */
export const DEFAULT_STUB_SUBJECT = 'stub-admin-0001';

/** The builder role the stub issues when the authorization request carries none. */
export const DEFAULT_STUB_ROLE = 'owner';

/** The `acr` the stub issues when the authorization request carries none — MFA-strong. */
export const DEFAULT_STUB_ACR = 'mfa';

/** The `amr` the stub issues when the authorization request carries none — MFA-strong. */
export const DEFAULT_STUB_AMR = 'mfa';

/** The email the stub issues when the authorization request carries none. */
export const DEFAULT_STUB_EMAIL = 'admin@example.com';

/** Seconds an issued access token (and therefore the IdP session) lives. */
const STUB_EXPIRES_IN_SECONDS = 3600;

/** The `kid` every stub-signed ID token carries, and the JWKS publishes. */
const STUB_KEY_ID = 'stub-signing-key-1';

/** The client the stub is configured for (matches the specs' OIDC_CLIENT_ID). */
export const STUB_CLIENT_ID = 'akane-builder';

/** The client secret the stub is configured for. */
export const STUB_CLIENT_SECRET = 'akane-builder-secret';

/** A code the authorize endpoint issued, bound to its PKCE challenge and claims. */
interface IssuedCode {
  readonly code: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly subject: string;
  readonly role: string;
  readonly acr: string;
  readonly amr: readonly string[];
  readonly email: string;
  consumed: boolean;
}

/** A refresh token the token endpoint issued, bound to its subject and role. */
interface IssuedRefresh {
  readonly subject: string;
  readonly role: string;
  readonly email: string;
}

/** What the last token exchange received — asserted by the PKCE specs. */
export interface StubExchangeRecord {
  readonly codeVerifier: string;
  readonly subject: string;
}

/**
 * The stub issuer. Start it, point `OIDC_ISSUER` at {@link origin}, and
 * drive the API's login flow against it over real HTTP.
 */
export class StubOidcIssuer {
  private server?: Server;
  private issuerOrigin = '';
  private privateKey?: Parameters<SignJWT['sign']>[0];
  private jwks: Record<string, unknown> = { keys: [] };
  private readonly codes = new Map<string, IssuedCode>();
  private readonly refreshTokens = new Map<string, IssuedRefresh>();
  private exchangeCount = 0;
  private lastExchange?: StubExchangeRecord;
  private refuseRefresh = false;

  /** The issuer's origin — the value to set `OIDC_ISSUER` to. */
  get origin(): string {
    return this.issuerOrigin;
  }

  /** How many token-endpoint exchanges this issuer has served. */
  get exchanges(): number {
    return this.exchangeCount;
  }

  /** The `code_verifier` of the most recent exchange, for PKCE assertions. */
  get lastCodeExchange(): StubExchangeRecord | undefined {
    return this.lastExchange;
  }

  /**
   * Refuse every refresh grant — the IdP session has ended (D-103's
   * "the IdP session ended, force a full re-login" leg).
   */
  setRefuseRefresh(refuse: boolean): void {
    this.refuseRefresh = refuse;
  }

  /** Start the issuer on an ephemeral loopback port. */
  async start(): Promise<void> {
    const keyPair = await generateKeyPair('ES256');
    this.privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    this.jwks = {
      keys: [{ ...publicJwk, kid: STUB_KEY_ID, alg: 'ES256', use: 'sig' }],
    };

    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.server as Server;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('StubOidcIssuer did not bind a TCP port');
    }
    this.issuerOrigin = `http://127.0.0.1:${address.port}`;
  }

  /** Stop the issuer. Idempotent, so a failed spec can still clean up. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', this.issuerOrigin || 'http://127.0.0.1');
    switch (url.pathname) {
      case '/.well-known/openid-configuration':
        this.handleDiscovery(res);
        return;
      case '/jwks':
        this.handleJwks(res);
        return;
      case '/authorize':
        this.handleAuthorize(url, res);
        return;
      case '/token':
        await this.handleToken(req, res);
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  }

  private handleDiscovery(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        issuer: this.issuerOrigin,
        authorization_endpoint: `${this.issuerOrigin}/authorize`,
        token_endpoint: `${this.issuerOrigin}/token`,
        jwks_uri: `${this.issuerOrigin}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES256'],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: [
          'client_secret_basic',
          'client_secret_post',
        ],
        scopes_supported: ['openid', 'profile', 'email'],
      }),
    );
  }

  private handleJwks(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(this.jwks));
  }

  /**
   * The authorize endpoint: issue a single-use code bound to the
   * request's PKCE challenge and the test-supplied claims, then
   * redirect back to the caller's `redirect_uri` with `code` and `state`.
   */
  private handleAuthorize(url: URL, res: ServerResponse): void {
    const params = url.searchParams;
    const redirectUri = params.get('redirect_uri');
    if (redirectUri === null) {
      res.writeHead(400);
      res.end('missing redirect_uri');
      return;
    }

    const issued: IssuedCode = {
      code: randomUUID(),
      codeChallenge: params.get('code_challenge') ?? '',
      redirectUri,
      subject: params.get('stub_subject') ?? DEFAULT_STUB_SUBJECT,
      role: params.get('stub_role') ?? DEFAULT_STUB_ROLE,
      acr: params.get('stub_acr') ?? DEFAULT_STUB_ACR,
      amr: (params.get('stub_amr') ?? DEFAULT_STUB_AMR).split(','),
      email: params.get('stub_email') ?? DEFAULT_STUB_EMAIL,
      consumed: false,
    };
    this.codes.set(issued.code, issued);

    const location = new URL(redirectUri);
    location.searchParams.set('code', issued.code);
    const state = params.get('state');
    if (state !== null) {
      location.searchParams.set('state', state);
    }
    res.writeHead(302, { location: location.toString() });
    res.end();
  }

  /**
   * The token endpoint: exchange an authorization code (verifying the
   * S256 `code_verifier` against the stashed challenge) or rotate a
   * refresh token, issuing a jose-signed ID token with the claims the
   * authorization request carried.
   */
  private async handleToken(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    this.exchangeCount += 1;
    const form = new URLSearchParams(await readBody(req));

    const credentials = this.clientCredentials(req, form);
    if (
      credentials === undefined ||
      credentials.clientId !== STUB_CLIENT_ID ||
      credentials.clientSecret !== STUB_CLIENT_SECRET
    ) {
      this.oauthError(res, 401, 'invalid_client');
      return;
    }

    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      await this.exchangeCode(form, res);
      return;
    }
    if (grantType === 'refresh_token') {
      this.exchangeRefresh(form, res);
      return;
    }
    this.oauthError(res, 400, 'unsupported_grant_type');
  }

  /**
   * Client authentication: `client_secret_basic` (the Authorization
   * header openid-client sends by default) or `client_secret_post`
   * (the form fields). Both are accepted so the stub stays agnostic to
   * the auth method openid-client picks.
   */
  private clientCredentials(
    req: IncomingMessage,
    form: URLSearchParams,
  ): { clientId: string; clientSecret: string } | undefined {
    const authorization = req.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Basic ')) {
      const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator < 0) {
        return undefined;
      }
      return {
        clientId: decoded.slice(0, separator),
        clientSecret: decoded.slice(separator + 1),
      };
    }
    const clientId = form.get('client_id');
    const clientSecret = form.get('client_secret');
    if (clientId === null || clientSecret === null) {
      return undefined;
    }
    return { clientId, clientSecret };
  }

  private async exchangeCode(
    form: URLSearchParams,
    res: ServerResponse,
  ): Promise<void> {
    const codeValue = form.get('code');
    const issued = codeValue === null ? undefined : this.codes.get(codeValue);
    if (issued === undefined || issued.consumed) {
      this.oauthError(res, 400, 'invalid_grant');
      return;
    }

    // S256: the verifier hashes to exactly the challenge the authorize
    // request carried. A mismatch is a failed exchange, not a warning —
    // that is what makes a passing PKCE test meaningful.
    const verifier = form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (challenge !== issued.codeChallenge) {
      this.oauthError(res, 400, 'invalid_grant');
      return;
    }
    if ((form.get('redirect_uri') ?? '') !== issued.redirectUri) {
      this.oauthError(res, 400, 'invalid_grant');
      return;
    }

    issued.consumed = true;
    this.lastExchange = { codeVerifier: verifier, subject: issued.subject };

    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({
      iss: this.issuerOrigin,
      sub: issued.subject,
      aud: STUB_CLIENT_ID,
      exp: now + STUB_EXPIRES_IN_SECONDS,
      iat: now,
      acr: issued.acr,
      amr: issued.amr,
      role: issued.role,
      email: issued.email,
    })
      .setProtectedHeader({ alg: 'ES256', kid: STUB_KEY_ID })
      .sign(this.privateKey as Parameters<SignJWT['sign']>[0]);

    const refreshToken = randomUUID();
    this.refreshTokens.set(refreshToken, {
      subject: issued.subject,
      role: issued.role,
      email: issued.email,
    });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        access_token: randomUUID(),
        token_type: 'Bearer',
        expires_in: STUB_EXPIRES_IN_SECONDS,
        refresh_token: refreshToken,
        id_token: idToken,
      }),
    );
  }

  private exchangeRefresh(form: URLSearchParams, res: ServerResponse): void {
    if (this.refuseRefresh) {
      this.oauthError(res, 400, 'invalid_grant');
      return;
    }
    const refreshToken = form.get('refresh_token');
    const issued =
      refreshToken === null ? undefined : this.refreshTokens.get(refreshToken);
    if (issued === undefined) {
      this.oauthError(res, 400, 'invalid_grant');
      return;
    }
    this.refreshTokens.delete(refreshToken);

    const rotated = randomUUID();
    this.refreshTokens.set(rotated, issued);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        access_token: randomUUID(),
        token_type: 'Bearer',
        expires_in: STUB_EXPIRES_IN_SECONDS,
        refresh_token: rotated,
      }),
    );
  }

  private oauthError(res: ServerResponse, status: number, error: string): void {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error }));
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
