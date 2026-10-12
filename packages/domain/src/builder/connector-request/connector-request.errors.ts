/**
 * The connector-request refusals (BLD-10, BLD-07).
 *
 * Every refusal is **inline and specific**: a `BuilderError`
 * carrying a `code` and a message that names the rule, which
 * the {@link BuilderExceptionFilter} maps to a status and
 * renders as `{error: {code, message}}` — never a generic
 * "something went wrong".
 */

import { BuilderError } from '../app-lifecycle.js';

/**
 * A pending request already exists for the `(app_id,
 * connector_id)` pair (T-06-24).
 *
 * The message **names the pending `request_id`** the new
 * request would duplicate, so the admin's next step is
 * visible: wait for the operator, or cancel the pending
 * request first.
 */
export class ConnectorRequestPendingExistsError extends BuilderError {
  constructor(
    appId: string,
    connectorId: string,
    requestId: string,
  ) {
    super(
      'CONNECTOR_REQUEST_PENDING_EXISTS',
      `a pending connector request already exists for ${appId}/${connectorId}: ${requestId}`,
    );
  }
}
