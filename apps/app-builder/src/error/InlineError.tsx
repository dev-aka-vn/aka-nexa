/**
 * The inline error surface (BLD-07).
 *
 * Every async failure renders an inline,
 * specific, actionable error **in place of the
 * skeleton** — never a generic message, never a
 * toast that evaporates. The error names the
 * operation that failed and offers the retry
 * action; the API's named error code and message
 * render verbatim (the BLD-07 discipline the
 * plan-04/05/06 controllers already implement
 * with `{error: {code, message}}`).
 */

import type { ReactElement } from 'react';

import { ApiError } from '../api/client.js';

export interface InlineErrorProps {
  /**
   * The operation that failed, named — "load the
   * app list", "create the app", "save the
   * triggers section". The message reads
   * "Failed to {operation}: …" so the user knows
   * what to retry.
   */
  operation: string;
  /** The caught error (an ApiError, or anything). */
  error: unknown;
  /** The retry action, offered inline (BLD-07). */
  onRetry?: () => void;
}

/**
 * Render an error's specific message: an ApiError
 * contributes its named code and verbatim API
 * message; anything else contributes its message.
 */
function errorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code} — ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * An inline, specific, actionable error. Rendered
 * in the layout slot the content would occupy.
 */
export function InlineError({
  operation,
  error,
  onRetry,
}: InlineErrorProps): ReactElement {
  return (
    <div
      role="alert"
      data-testid="inline-error"
      style={{
        border: '1px solid var(--red)',
        background: 'var(--red-soft)',
        borderRadius: 'var(--radius)',
        padding: '12px 16px',
        color: 'var(--red)',
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        Failed to {operation}
      </div>
      <div style={{ marginTop: 4 }}>
        {errorDetail(error)}
      </div>
      {onRetry ? (
        <button
          type="button"
          data-testid="inline-error-retry"
          onClick={onRetry}
          style={{
            marginTop: 10,
            border: '1px solid var(--red)',
            background: 'var(--surface)',
            color: 'var(--red)',
            borderRadius: 'var(--radius-xs)',
            padding: '4px 12px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
