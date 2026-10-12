/**
 * The shared API-client hook.
 *
 * One client per surface — they share the
 * cookie posture (D-101) and the one-shot
 * 401 hook semantics, so every routed page
 * builds its own client once and reuses it
 * across renders and retries.
 */

import { useMemo } from 'react';

import {
  createApiClient,
  type ApiClient,
} from './api/client.js';
import { redirectToOidcBegin } from './auth/oidc-redirect.js';

/** Build (once) the page's API client. */
export function useApiClient(): ApiClient {
  return useMemo(
    () => createApiClient({ onUnauthorized: redirectToOidcBegin }),
    [],
  );
}
