import type { ReadLinkAction } from '@akane/contract';

export interface IssueLinkInput {
  readonly appId: string;
  readonly realUserId: string;
  readonly formId: string;
  readonly formVersion: number;
  readonly action: ReadLinkAction;
}

/**
 * Tracer stand-in for the Phase 2 signed-link issuer (01-CONTEXT D-21 frozen
 * claim set, jose ES256). Returns the deterministic app-scoped link path both
 * the slash path and the message path emit through, so parity is observable
 * end-to-end. Real KMS-backed signing replaces this body without changing the
 * seam.
 */
export class LinkIssuerService {
  async issue(input: IssueLinkInput): Promise<string> {
    return `/l/${encodeURIComponent(input.appId)}?u=${encodeURIComponent(input.realUserId)}&a=${encodeURIComponent(input.action)}&f=${encodeURIComponent(input.formId)}&fv=${input.formVersion}`;
  }
}
