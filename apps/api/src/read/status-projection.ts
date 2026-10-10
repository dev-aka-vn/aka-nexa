import type { QueryRow } from '@akane/domain';
import type {
  OutboundState,
  SubmissionRevisionDocument,
} from '@akane/domain';

export type TaxonomyCode =
  | 'credential_rejected'
  | 'endpoint_unreachable'
  | 'failed_permanent'
  | 'mapping_error'
  | 'unknown';

export interface StatusRow {
  app_id: string;
  form_id: string;
  submittedAt: Date | string;
  status: 'completed' | 'partial' | 'failed' | 'pending_external';
  destination: string;
  downstreamRef?: string | null;
  reason?: string;
}

function mapFailureReason(code: TaxonomyCode, connectorName?: string): string {
  const connector = connectorName ?? 'Connector';
  switch (code) {
    case 'credential_rejected':
      return `The ${connector} integration is not available right now. Your submission is saved.`;
    case 'endpoint_unreachable':
      return `${connector} is temporarily unavailable. Your submission is saved and will be retried.`;
    case 'failed_permanent':
    case 'mapping_error':
    case 'unknown':
    default:
      return `This submission couldn't be delivered to ${connector}. Our team has been notified.`;
  }
}

export interface StatusProjectionInput {
  submission?: {
    app_id?: string;
    form_id?: string;
    created_at?: Date | string;
    status?: string;
    [key: string]: unknown;
  };
  queryRow?: QueryRow;
  latestRevision: SubmissionRevisionDocument | null;
  connectorName?: string;
  taxonomyCode?: TaxonomyCode;
}

export function projectSubmissionStatus(
  input: StatusProjectionInput,
): StatusRow {
  const base = input.queryRow ?? input.submission ?? {};

  const appId = (base as any).app_id ?? (input.submission as any)?.app_id ?? '';
  const formId = (base as any).form_id ?? (input.submission as any)?.form_id ?? '';
  const submittedAt =
    (base as any).submittedAt ??
    (base as any).submitted_at ??
    (base as any).created_at ??
    (input.submission as any)?.created_at ??
    new Date();

  const connector = input.connectorName ?? 'Connector';

  const latest = input.latestRevision;

  if (!latest) {
    const status = ((input.submission as any)?.status ??
      (base as any)?.status ??
      'completed') as StatusRow['status'];
    return {
      app_id: String(appId),
      form_id: String(formId),
      submittedAt,
      status,
      destination: 'Internal saved',
    };
  }

  // Determine presentation based on outbound state
  if (latest.outbound === 'confirmed') {
    return {
      app_id: String(appId),
      form_id: String(formId),
      submittedAt,
      status: 'completed',
      destination: `${connector} · ${latest.downstreamReference ?? ''}`.trim(),
      downstreamRef: latest.downstreamReference ?? null,
    };
  }

  // If taxonomy code indicates failure, treat as failed
  if (input.taxonomyCode) {
    const reason = mapFailureReason(input.taxonomyCode, connector);
    return {
      app_id: String(appId),
      form_id: String(formId),
      submittedAt,
      status: 'failed',
      destination: reason,
      reason,
    };
  }

  if (latest.outbound === 'not_sent' || latest.outbound === 'sent_unconfirmed') {
    return {
      app_id: String(appId),
      form_id: String(formId),
      submittedAt,
      status: 'partial',
      destination: `Internal saved · ${connector}: retrying`,
    };
  }

  // Default/fallback - treat as failed with default reason
  const reason = mapFailureReason('failed_permanent', connector);
  return {
    app_id: String(appId),
    form_id: String(formId),
    submittedAt,
    status: 'failed',
    destination: reason,
    reason,
  };
}

export const statusProjection = projectSubmissionStatus;