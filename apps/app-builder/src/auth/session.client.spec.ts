/**
 * The session client spec (BLD-12, D-101).
 *
 * The SPA's auth surface is cookie-only: the session is
 * an httpOnly `__Host-` cookie the browser attaches on
 * every same-origin call, and the SPA never reads it,
 * never holds a token, and never sends an Authorization
 * header. These specs pin that contract:
 *
 *  1. `GET /auth/me` is issued with `credentials:
 *     'same-origin'` — the only way the session cookie
 *     rides the request — and no Authorization header.
 *  2. A 401 fires the redirect hook exactly once (the
 *     `/auth/oidc/begin` redirect), and a second 401
 *     does not re-fire it — no redirect loop when
 *     concurrent calls all answer 401.
 *  3. The response is Zod-4 validated: a malformed
 *     payload is refused, never rendered.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createApiClient,
  SessionAuthError,
} from '../api/client.js';
import { fetchSessionUser } from './session.client.js';

const ME_OK = JSON.stringify({
  real_user_id: 'usr_42',
  mfa_at: '2026-10-12T10:00:00.000Z',
});

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('session.client — GET /auth/me (cookie-only, D-101)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls /auth/me with same-origin credentials and no Authorization header', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, ME_OK));

    const client = createApiClient();
    const me = await fetchSessionUser(client);

    expect(me).toEqual({
      real_user_id: 'usr_42',
      mfa_at: '2026-10-12T10:00:00.000Z',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('/api/auth/me');
    expect(init.method).toBe('GET');
    // The session cookie rides the request only through
    // same-origin credentials (D-101).
    expect(init.credentials).toBe('same-origin');
    // The SPA holds no token: no Authorization header (D-101).
    const headers = (init.headers ?? {}) as Record<string, unknown>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['authorization']).toBeUndefined();
  });

  it('fires the 401 redirect hook exactly once and refuses the session', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, JSON.stringify({ error: 'SESSION_MISSING' })),
    );

    const onUnauthorized = vi.fn();
    const client = createApiClient({ onUnauthorized });

    await expect(fetchSessionUser(client)).rejects.toBeInstanceOf(
      SessionAuthError,
    );
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    // A second 401 (e.g. a concurrent call) must not
    // re-fire the redirect — no redirect loop.
    await expect(fetchSessionUser(client)).rejects.toBeInstanceOf(
      SessionAuthError,
    );
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed /auth/me payload (Zod-4 validated response)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, JSON.stringify({ real_user_id: 42 })),
    );

    const client = createApiClient();
    await expect(fetchSessionUser(client)).rejects.toThrow();
  });
});
