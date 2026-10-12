/**
 * The OIDC redirect (BLD-12, D-101).
 *
 * A 401 from any surface means the session is
 * gone; the SPA's only correct response is the
 * browser navigation to the API's OIDC begin
 * endpoint, which issues the authorization-code +
 * PKCE (S256) redirect to the corporate IdP.
 * The `code_verifier` and `state` are stashed
 * server-side in the pre-login Redis session —
 * the browser carries nothing but the navigation.
 *
 * The module is DOM-free at import time (the
 * Pattern 1 guard): outside a browser it is a
 * no-op, which is what the Node-executed specs
 * rely on.
 */

/**
 * The begin endpoint, through the `/api` dev
 * proxy (the same origin story every SPA call
 * uses). In production the SPA is served
 * same-origin from the API's static surface and
 * the path resolves directly.
 */
export const OIDC_BEGIN_PATH = '/api/auth/oidc/begin';

/**
 * Navigate the browser to the OIDC begin
 * endpoint. No-op outside a DOM (the Pattern 1
 * guard — importing this module from Node never
 * touches `window`).
 */
export function redirectToOidcBegin(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.location.assign(OIDC_BEGIN_PATH);
}
