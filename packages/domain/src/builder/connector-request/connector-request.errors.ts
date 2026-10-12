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

/** No request carries that `request_id` (or it belongs to another app). */
export class ConnectorRequestNotFoundError extends BuilderError {
  constructor(requestId: string) {
    super(
      'CONNECTOR_REQUEST_NOT_FOUND',
      `connector request not found: ${requestId}`,
    );
  }
}

/**
 * The request is not in a state the transition may
 * leave: cancel operates on `pending` only, retry
 * requires the previous request for the pair to be
 * terminal, reject operates on `pending` only.
 */
export class ConnectorRequestTransitionError extends BuilderError {
  constructor(
    requestId: string,
    from: string,
    rule: string,
  ) {
    super(
      'CONNECTOR_REQUEST_ILLEGAL_TRANSITION',
      `connector request ${requestId} is ${from}: ${rule}`,
    );
  }
}
