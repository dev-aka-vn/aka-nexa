import type { PublishedApp } from '../../decision/published-app-loader.js';

import {
  type RoutingOutcomeRecord,
  type RoutingOutcomeStore,
} from './routing-outcome.repository.js';

/**
 * The routing-share computer (OBS-05, APP-07 substrate — Pitfall 9).
 *
 * `routing_share{app_id}` is a **distribution over the labelled
 * intent set**, never a per-app counter: an app's share is its
 * fraction of the routings across its declared intent labels.
 * Theft is only detectable as a relative shift — an app whose
 * absolute count keeps rising can still be losing its share —
 * so every computation divides by the label set's total, over
 * the same rolling window the publish dry-run reads. One
 * implementation serves both consumers, so the gate's
 * prediction and the exported metric cannot disagree.
 */

/** The rolling window the share — and the dry-run baseline — reads. */
export const ROUTING_SHARE_WINDOW_MS = 24 * 60 * 60 * 1000;

export class RoutingShareComputer {
  constructor(
    private readonly outcomes: RoutingOutcomeStore,
    /**
     * The published-app catalog, read fresh per call: the share
     * is over the app's *declared* labels, and the published
     * set changes as apps publish and deprecate.
     */
    private readonly catalog: () => Promise<readonly PublishedApp[]>,
  ) {}

  /**
   * The app's share of the routings across its own declared
   * labels — the `routing_share{app_id}` value. Zero when the
   * app is unknown, declares no labels, or has no in-window
   * traffic on them.
   */
  async share(
    appId: string,
    windowMs: number = ROUTING_SHARE_WINDOW_MS,
  ): Promise<number> {
    const labels = await this.labelsOf(appId);
    return this.shareOverLabels(appId, labels, windowMs);
  }

  /**
   * The app's share over an explicit label set — the publish
   * dry-run's substrate: the candidate's domain labels are the
   * set whose distribution the gate measures.
   */
  async shareOverLabels(
    appId: string,
    labels: readonly string[],
    windowMs: number = ROUTING_SHARE_WINDOW_MS,
  ): Promise<number> {
    const { appCount, labelCount } = await this.countsOverLabels(
      appId,
      labels,
      windowMs,
    );
    return labelCount === 0 ? 0 : appCount / labelCount;
  }

  /**
   * The raw counts the share divides: in-window records on
   * the label set, and how many of them routed to the app.
   * The dry-run needs the counts themselves — the
   * post-publish share is `(appCount + picks) / (labelCount + labels)`.
   */
  async countsOverLabels(
    appId: string,
    labels: readonly string[],
    windowMs: number = ROUTING_SHARE_WINDOW_MS,
  ): Promise<{ appCount: number; labelCount: number }> {
    let appCount = 0;
    let labelCount = 0;
    for (const label of new Set(labels)) {
      const records: RoutingOutcomeRecord[] =
        await this.outcomes.outcomesForIntent(label, windowMs);
      labelCount += records.length;
      appCount += records.filter((record) => record.app_id === appId).length;
    }
    return { appCount, labelCount };
  }

  /** Every catalog app's current share — the gauge's observation set. */
  async snapshot(
    windowMs: number = ROUTING_SHARE_WINDOW_MS,
  ): Promise<readonly { appId: string; share: number }[]> {
    const out: { appId: string; share: number }[] = [];
    for (const app of await this.catalog()) {
      out.push({ appId: app.id, share: await this.share(app.id, windowMs) });
    }
    return out;
  }

  private async labelsOf(appId: string): Promise<string[]> {
    const app = (await this.catalog()).find((entry) => entry.id === appId);
    return app === undefined ? [] : [...app.intents, ...app.aliases];
  }
}
