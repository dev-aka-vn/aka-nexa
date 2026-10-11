import { ConnectorExecuteOutcome } from '@akane/contract';

export type TaxonomyCode =
  | 'credential_rejected'
  | 'endpoint_unreachable'
  | 'failed_permanent'
  | 'mapping_error'
  | 'unknown';

export interface ClassifiedFailure {
  readonly outcome: ConnectorExecuteOutcome;
  readonly code: TaxonomyCode;
}

export type TransportError = {
  readonly code?: string;
  readonly message?: string;
  readonly cause?: unknown;
  readonly name?: string;
};

export function classifyError(
  statusOrError: number | TransportError,
  context?: { isCreate?: boolean },
): ClassifiedFailure {
  // Handle network/timeout errors
  if (typeof statusOrError === 'object') {
    const err = statusOrError;
    const errMsg = String(err.message || err.code || err.name || '').toLowerCase();
    if (
      errMsg.includes('timeout') ||
      errMsg.includes('network') ||
      errMsg.includes('econnrefused') ||
      errMsg.includes('connect') ||
      errMsg.includes('fetch failed') ||
      errMsg.includes('abort') ||
      errMsg.includes('enotfound') ||
      errMsg.includes('etimedout')
    ) {
      return {
        code: 'endpoint_unreachable',
        outcome: {
          externalId: null,
          status: 'failed_transient',
          code: 'endpoint_unreachable',
        },
      };
    }
    // For other transport errors, be conservative
    return {
      code: 'failed_permanent',
      outcome: {
        externalId: null,
        status: 'failed_permanent',
        code: 'failed_permanent',
      },
    };
  }

  const status = statusOrError;

  // 401 / 403 / 412 → credential_rejected, retryable = false
  if (status === 401 || status === 403 || status === 412) {
    return {
      code: 'credential_rejected',
      outcome: {
        externalId: null,
        status: 'failed_permanent',
        code: 'credential_rejected',
      },
    };
  }

  // 422 / 404-on-create / 406 → failed_permanent, retryable = false
  if (status === 422 || status === 406) {
    return {
      code: 'failed_permanent',
      outcome: {
        externalId: null,
        status: 'failed_permanent',
        code: 'failed_permanent',
      },
    };
  }

  // Special handling for 404 on create - per plan
  if (status === 404) {
    if (context?.isCreate) {
      return {
        code: 'failed_permanent',
        outcome: {
          externalId: null,
          status: 'failed_permanent',
          code: 'failed_permanent',
        },
      };
    }
    // 404 in general context might be different, but plan specifies 404-on-create
    // For safety, classify as failed_permanent
    return {
      code: 'failed_permanent',
      outcome: {
        externalId: null,
        status: 'failed_permanent',
        code: 'failed_permanent',
      },
    };
  }

  // 5xx → endpoint_unreachable, retryable = true
  if (status >= 500) {
    return {
      code: 'endpoint_unreachable',
      outcome: {
        externalId: null,
        status: 'failed_transient',
        code: 'endpoint_unreachable',
      },
    };
  }

  // No 429 branch exists (Redmine has no core rate limiting) - falls through to default

  // Unknown status - conservative failed_permanent (never auto-retried)
  return {
    code: 'failed_permanent',
    outcome: {
      externalId: null,
      status: 'failed_permanent',
      code: 'failed_permanent',
    },
  };
}
