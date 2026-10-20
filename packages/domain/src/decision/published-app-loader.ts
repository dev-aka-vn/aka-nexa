import type { ToolDescriptor } from '@akane/contract';
import { createAclMetricsRecorder } from '../acl/acl.metrics.js';
import type { AppFormKind, ReadLinkAction } from '@akane/contract';

/**
 * One form of a published app that declares a trigger (D-06/D-07).
 * The catalog is the set of forms that declare a trigger: a form with
 * `triggers: null` yields no entry.
 */
export interface PublishedAppForm {
  readonly form_id: string;
  readonly kind: AppFormKind;
  readonly action: ReadLinkAction;
  readonly intents: readonly string[];
  readonly aliases: readonly string[];
  readonly threshold: number;
  readonly description: string;
  readonly form_version: number;
}

/**
 * One app's owner-declared triggers (D-52): intents and aliases live on the
 * app's own publication record, never in a central phrase catalogue.
 */
export interface PublishedApp {
  readonly id: string;
  readonly description: string;
  readonly parameters: readonly string[];
  readonly intents: readonly string[];
  readonly aliases: readonly string[];
  /** Per-app configured confidence gate (D-53). */
  readonly threshold: number;
  readonly status: 'published' | 'draft' | 'deprecated';
  /** Form-level projection: one entry per triggered form. */
  readonly forms: readonly PublishedAppForm[];
}

/** Fresh per-app authorization check, supplied by the caller (T-03-01). */
export type AuthorizeApp = (appId: string, realUserId: string) => Promise<boolean>;

export interface AuthorizedApp {
  readonly tool: ToolDescriptor;
  /** The app's declared intent labels (D-52) — the OBS-05 record's label source. */
  readonly intents: readonly string[];
  readonly aliases: readonly string[];
  readonly threshold: number;
  /** The form this authorized tool routes to. */
  readonly form: PublishedAppForm;
  /** Re-check current permission at the execution boundary. */
  canOpenNow(): Promise<boolean>;
}

/**
 * Split a form-scoped tool id back into its app id. Tool ids are
 * `${app_id}:${form_id}`; AppIdSchema forbids ':' in app_id and form_id is a
 * kind string, so the split is unambiguous.
 */
export function appIdOfToolId(toolId: string): string {
  const idx = toolId.indexOf(':');
  return idx === -1 ? toolId : toolId.slice(0, idx);
}

/**
 * Exposes only apps that are published, non-deprecated, and currently
 * authorized for the requesting user. Deprecated apps carry no triggers:
 * they stay functional for existing links but gain nothing new (D-52).
 *
 * The RBAC filter runs BEFORE the form projection (S8): an app the
 * authorize seam excludes yields no tools even though its forms declare
 * triggers.
 */
export class PublishedAppLoader {
  constructor(
    private readonly catalog: readonly PublishedApp[],
    private readonly authorize: AuthorizeApp,
  ) {}

  async listAuthorized(realUserId: string): Promise<AuthorizedApp[]> {
    const out: AuthorizedApp[] = [];
    for (const app of this.catalog) {
      if (app.status !== 'published') continue;
      const aclStartedAt = Date.now();
      const allowed = await this.authorize(app.id, realUserId);
      createAclMetricsRecorder().recordResolution({
        outcome: allowed ? 'allowed' : 'denied',
        durationMs: Date.now() - aclStartedAt,
      });
      if (!allowed) continue;
      // Form projection runs AFTER the RBAC filter (S8).
      for (const form of app.forms ?? []) {
        // Per-form tool, id scoped to the form.
        out.push({
          tool: {
            id: `${app.id}:${form.form_id}`,
            description: form.description,
            parameters: [],
          },
          intents: [...form.intents],
          aliases: form.aliases,
          threshold: form.threshold,
          form,
          canOpenNow: () => this.authorize(app.id, realUserId),
        });
      }
    }
    return out;
  }
}