/**
 * The API client (BLD-12, D-101, BLD-07).
 *
 * The single fetch wrapper every SPA surface uses.
 * Its contract is the session posture the whole
 * plan compiles against:
 *
 *  - **Cookie-only** (D-101): every call carries
 *    `credentials: 'same-origin'` so the httpOnly
 *    `__Host-` session cookie rides the request, and
 *    no call ever carries an Authorization header —
 *    the SPA holds no token anywhere.
 *  - **Zod-4-validated responses**: the caller
 *    passes the response schema; an unvalidated
 *    payload never reaches a component.
 *  - **Inline, specific errors** (BLD-07): a refusal
 *    is the API's named `{error: {code, message}}`
 *    body, surfaced verbatim — never a generic
 *    "something went wrong".
 *  - **One redirect per 401**: the unauthorized hook
 *    fires once per client, so a burst of concurrent
 *    401s cannot redirect-loop.
 *
 * The module is DOM-free at import time (the
 * Pattern 1 guard): importing it from Node is a
 * no-op-safe operation, which is what the session
 * client's vitest specs rely on.
 */

/**
 * The minimal structural contract of a Zod-4
 * response schema: the client validates at the
 * boundary without depending on Zod's generic
 * variance.
 */
export interface ResponseSchema<T> {
  parse: (data: unknown) => T;
}

/** A named API refusal (BLD-07: code + message, inline). */
export class ApiError extends Error {
  constructor(
    /** The API's named error code, verbatim. */
    readonly code: string,
    message: string,
    /** The HTTP status (0 = network failure). */
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A 401 refusal — the session is missing or expired.
 * The SPA's only correct response is the OIDC
 * redirect (fired by the client's hook).
 */
export class SessionAuthError extends ApiError {
  constructor(code: string, message: string) {
    super(code, message, 401);
    this.name = 'SessionAuthError';
  }
}

export interface ApiClientDeps {
  /**
   * The path prefix every API call carries. `/api` is
   * the dev-proxy key (the vite dev server forwards
   * it to the API origin); in production the SPA is
   * served same-origin from the API's static surface.
   */
  basePath?: string;
  /**
   * Fired exactly once per client on the first 401 —
   * the SPA's redirect-to-OIDC hook.
   */
  onUnauthorized?: () => void;
  /**
   * The fetch implementation (defaults to the global
   * fetch; injectable so the specs can stub it).
   */
  fetchImpl?: typeof fetch;
}

/** The HTTP surface the SPA's surfaces consume. */
export interface ApiClient {
  get<T>(path: string, schema: ResponseSchema<T>): Promise<T>;
  post<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
  ): Promise<T>;
  put<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
  ): Promise<T>;
  patch<T>(
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
  ): Promise<T>;
}

/**
 * Build the API client. One client per SPA surface is
 * fine — they share the cookie posture and the
 * one-shot 401 hook semantics.
 */
export function createApiClient(
  deps: ApiClientDeps = {},
): ApiClient {
  const basePath = deps.basePath ?? '/api';
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  let unauthorizedFired = false;

  const request = async <T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
    schema: ResponseSchema<T>,
  ): Promise<T> => {
    const init: RequestInit = {
      method,
      // D-101: the session cookie rides every call.
      credentials: 'same-origin',
      // Never follow a redirect silently — the API's
      // refusals are JSON bodies, and a followed
      // redirect would mask them (the edit.ts
      // precedent).
      redirect: 'manual',
    };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetchImpl(`${basePath}${path}`, init);
    } catch {
      throw new ApiError(
        'NETWORK_ERROR',
        `network error during ${method} ${path}`,
        0,
      );
    }

    // The session is gone (SESSION_MISSING /
    // SESSION_EXPIRED): fire the redirect hook once
    // and refuse the call.
    if (res.status === 401) {
      if (!unauthorizedFired) {
        unauthorizedFired = true;
        deps.onUnauthorized?.();
      }
      throw new SessionAuthError(
        'SESSION_MISSING',
        'session missing or expired — sign in again',
      );
    }

    const text = await res.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!res.ok) {
      // BLD-07: the API's named error, verbatim. The
      // controller filter renders {error: {code,
      // message}}; anything else is still surfaced
      // with the operation named, never generic.
      const error = (
        payload as { error?: { code?: string; message?: string } }
      )?.error;
      throw new ApiError(
        error?.code ?? 'API_ERROR',
        error?.message ?? `request failed: ${method} ${path}`,
        res.status,
      );
    }

    // The response is Zod-4 validated at the boundary.
    return schema.parse(payload);
  };

  return {
    get: (path, schema) => request('GET', path, undefined, schema),
    post: (path, body, schema) =>
      request('POST', path, body, schema),
    put: (path, body, schema) =>
      request('PUT', path, body, schema),
    patch: (path, body, schema) =>
      request('PATCH', path, body, schema),
  };
}
