import type { ToolDescriptor } from '@akane/contract';

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
}

/** Fresh per-app authorization check, supplied by the caller (T-03-01). */
export type AuthorizeApp = (appId: string, realUserId: string) => Promise<boolean>;

export interface AuthorizedApp {
  readonly tool: ToolDescriptor;
  readonly aliases: readonly string[];
  readonly threshold: number;
  /** Re-check current permission at the execution boundary. */
  canOpenNow(): Promise<boolean>;
}

/**
 * Exposes only apps that are published, non-deprecated, and currently
 * authorized for the requesting user. Deprecated apps carry no triggers:
 * they stay functional for existing links but gain nothing new (D-52).
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
      if (!(await this.authorize(app.id, realUserId))) continue;
      out.push({
        tool: { id: app.id, description: app.description, parameters: [...app.parameters] },
        aliases: app.aliases,
        threshold: app.threshold,
        canOpenNow: () => this.authorize(app.id, realUserId),
      });
    }
    return out;
  }
}
