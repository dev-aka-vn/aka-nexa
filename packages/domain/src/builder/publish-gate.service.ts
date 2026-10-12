import {
  JEV_SPEC_VERSION,
  type ToolDescriptor,
} from '@akane/contract';

import type { AppDefinitionDocument } from './data-access/app-definition.repository.js';
import { AppNotFoundError } from './data-access/app-definition.repository.js';
import type { PublishedApp } from '../decision/published-app-loader.js';
import type { RoutingOrchestrator } from '../decision/routing-orchestrator.js';
import type { RoutingInput } from '../decision/routing-orchestrator.js';
import type { ChangeSummaryRow, PublishGateResult, ShareDrop } from '@akane/contract';
export type { PublishGateResult, ShareDrop } from '@akane/contract';
import type { RoutingOutcomeStore } from './routing-share/routing-outcome.repository.js';
import { RoutingShareComputer } from './routing-share/routing-share.computer.js';
import { ROUTING_SHARE_WINDOW_MS } from './routing-share/routing-share.computer.js';

/**
 * The publish gate (APP-07, APP-08, BLD-06).
 *
 * Publishing is the moment a mistake becomes live: the
 * gate is the last enforcement point before an app's
 * triggers enter the routing distribution. `evaluate`
 * runs **before any state change** and is read-only —
 * the dry-run executes the real RoutingOrchestrator
 * (Pitfall 8: the prediction is the live router's own
 * computation, never a second implementation), and a
 * blocked publish leaves every app's lifecycle state
 * and every outcome record untouched.
 *
 * ## The share-drop model (APP-07)
 *
 * The drop is **additive dilution** over the candidate's
 * declared labels: the dry-run simulates one routing
 * per label with the candidate included, so every
 * existing app's share is measured against a denominator
 * grown by the label count. An app's post-publish share
 * is `(cA + sA) / (cL + K)` — its in-window count on
 * the domain labels plus its simulated picks, over the
 * domain's in-window count plus the simulated routings.
 * The comparison is strictly greater-than: exactly 5.00
 * points passes, 5.01 blocks.
 */

/** The APP-07 threshold: a drop of more than this many points blocks. */
export const PUBLISH_SHARE_DROP_THRESHOLD_POINTS = 5;

/** The APP-08 threshold: a token Jaccard at or above this blocks. */
export const DESCRIPTION_COLLISION_JACCARD_THRESHOLD = 0.9;

/** The dry-run's per-label routing budget, matching the live router's. */
const DRY_RUN_BUDGET_MS = 2000;

/** The confidence gate for a candidate that carries no configured threshold. */
const UNCONFIGURED_THRESHOLD = 0.5;

export class PublishGateService {
  private readonly shares: RoutingShareComputer;

  constructor(
    private readonly orchestrator: RoutingOrchestrator,
    /**
     * The outcome store the share baseline reads — the
     * same seam the gauge reads, so the dry-run's
     * prediction and the exported metric cannot disagree.
     */
    outcomes: RoutingOutcomeStore,
    private readonly definitions: {
      findByAppId(
        appId: string,
      ): Promise<AppDefinitionDocument | null>;
      listPublished(): Promise<AppDefinitionDocument[]>;
    },
  ) {
    this.shares = new RoutingShareComputer(
      outcomes,
      async () =>
        (await this.definitions.listPublished()).map(
          publishedAppFromDefinition,
        ),
    );
  }

  /**
   * The gate's decision for one candidate. Throws
   * `AppNotFoundError` when no definition carries the
   * app_id; returns the full `PublishGateResult`
   * otherwise — the endpoint renders it inline and the
   * audit log retains it (T-06-20).
   */
  async evaluate(
    candidateAppId: string,
    realUserId: string,
  ): Promise<PublishGateResult> {
    const candidate = await this.definitions.findByAppId(candidateAppId);
    if (candidate === null) {
      throw new AppNotFoundError(candidateAppId);
    }

    // BLD-06 boundary: an already-published app has
    // nothing to gate — its triggers are already in the
    // distribution, so no dry-run runs and no drop is
    // measurable. The publish is a no-op the endpoint
    // names inline.
    if (candidate.lifecycle === 'published') {
      return {
        allowed: true,
        shareDrops: [],
        descriptionCollisionWith: null,
        changeSummary: [],
      };
    }

    const candidateLabels = declaredLabels(candidate);
    const candidateLabelSet = new Set(candidateLabels);
    const publishedApps = (await this.definitions.listPublished())
      .map(publishedAppFromDefinition)
      .filter((app) => app.id !== candidateAppId);

    // APP-08: the collision check runs against published
    // apps only — a draft's unpublished description is
    // not yet user-visible.
    const descriptionCollisionWith = publishedApps.find((app) =>
      descriptionsCollide(candidate.description, app.description),
    )?.id ?? null;

    // (1) The labelled intent set: every published app
    // sharing any of the candidate's declared labels —
    // the apps whose share the candidate's entry dilutes.
    const intentSet = publishedApps.filter((app) =>
      [...app.intents, ...app.aliases].some((label) =>
        candidateLabelSet.has(label),
      ),
    );

    // (2) The dry-run: each label's representative input
    // (the label text itself) through the real
    // orchestrator, read-only, with the candidate
    // excluded and then included.
    const toolsById = new Map<string, ToolDescriptor>();
    const thresholds = new Map<string, number>();
    for (const app of intentSet) {
      toolsById.set(app.id, {
        id: app.id,
        description: app.description,
        parameters: [...app.parameters],
      });
      thresholds.set(app.id, app.threshold);
    }
    toolsById.set(candidate.app_id, {
      id: candidate.app_id,
      description: candidate.description,
      parameters: [],
    });
    thresholds.set(candidate.app_id, thresholdOf(candidate));

    const threshold = (toolId: string): number =>
      thresholds.get(toolId) ?? UNCONFIGURED_THRESHOLD;
    const domainLabels = [...candidateLabelSet];
    const includedPicks = new Map<string, number>();
    const excludedTools = [...toolsById.values()].filter(
      (tool) => tool.id !== candidateAppId,
    );
    for (const label of domainLabels) {
      // The excluded run models the live distribution
      // without the candidate; its holder attribution
      // rides the share drops below.
      await this.orchestrator.route(
        dryRunInput(label, realUserId, candidateAppId, excludedTools, threshold),
      );

      const outcome = await this.orchestrator.route(
        dryRunInput(
          label,
          realUserId,
          candidateAppId,
          [...toolsById.values()],
          threshold,
        ),
      );
      if (outcome.kind === 'link') {
        includedPicks.set(
          outcome.toolId,
          (includedPicks.get(outcome.toolId) ?? 0) + 1,
        );
      }
    }
    const simulatedRoutings = domainLabels.length;

    // (3) Each existing app's drop against its own
    // pre-publish share — never against the candidate.
    const shareDrops: ShareDrop[] = [];
    for (const app of intentSet) {
      const { appCount, labelCount } = await this.shares.countsOverLabels(
        app.id,
        domainLabels,
        ROUTING_SHARE_WINDOW_MS,
      );
      const picks = includedPicks.get(app.id) ?? 0;
      const preShare = labelCount === 0 ? 0 : appCount / labelCount;
      const postShare =
        labelCount + simulatedRoutings === 0
          ? 0
          : (appCount + picks) / (labelCount + simulatedRoutings);
      const points = Math.round(
        100 * (preShare - postShare) * 100,
      ) / 100;
      shareDrops.push({ app_id: app.id, points });
    }

    const allowed =
      shareDrops.every((drop) => drop.points <= PUBLISH_SHARE_DROP_THRESHOLD_POINTS) &&
      descriptionCollisionWith === null;

    return {
      allowed,
      shareDrops,
      descriptionCollisionWith,
      changeSummary: buildChangeSummary(candidate),
    };
  }
}

/** One label's dry-run routing input through the real orchestrator. */
function dryRunInput(
  label: string,
  realUserId: string,
  requestIdSeed: string,
  authorizedTools: readonly ToolDescriptor[],
  threshold: (toolId: string) => number,
): RoutingInput {
  return {
    draft: {
      spec_version: JEV_SPEC_VERSION,
      request_id: `publish-dry-run:${requestIdSeed}:${label}`,
      state: {
        locale: 'en',
        conversation_id: 'publish-gate',
        turn_count: 0,
        force_clarification: false,
      },
      question: label,
      context: {
        real_user_id: realUserId,
        app_hints: [],
        previous_turns: [],
      },
    },
    authorizedTools,
    threshold,
    // The dry-run models the distribution across the
    // intent set; the live router re-checks permission
    // at real routing time.
    canOpenNow: async () => true,
    deadlineEpochMs: Date.now() + DRY_RUN_BUDGET_MS,
  };
}

/**
 * The app's declared intent labels: every trigger's
 * declared `intents`/`aliases`, falling back to the
 * trigger's `id` and `command` — the owner-declared
 * triggers (D-52) the intent set is built from.
 */
export function declaredLabels(definition: AppDefinitionDocument): string[] {
  const labels: string[] = [];
  for (const trigger of definition.triggers ?? []) {
    for (const key of ['intents', 'aliases', 'id', 'command'] as const) {
      const value = trigger[key];
      if (Array.isArray(value)) {
        for (const label of value) {
          if (typeof label === 'string' && label.length > 0) {
            labels.push(label);
          }
        }
      } else if (typeof value === 'string' && value.length > 0) {
        labels.push(value);
      }
    }
  }
  return [...new Set(labels)];
}

/**
 * The PublishedApp record a definition publishes as —
 * the catalog shape the routing machinery reads. Both
 * `intents` and `aliases` carry the full declared label
 * set: the label union is what the intent set, the
 * share computation and the provider all match on.
 */
export function publishedAppFromDefinition(
  definition: AppDefinitionDocument,
): PublishedApp {
  const labels = declaredLabels(definition);
  return {
    id: definition.app_id,
    description: definition.description,
    parameters: [],
    intents: labels,
    aliases: labels,
    threshold: thresholdOf(definition),
    // Only a published definition reaches this record —
    // the callers read the published set — so the
    // lifecycle narrows to the catalog's published
    // states at every call site.
    status: definition.lifecycle as PublishedApp['status'],
  };
}

/**
 * The app's configured confidence gate (D-53), read
 * from the JEV-behavior section when it carries one —
 * a definition that has not configured a threshold
 * routes at the default gate.
 */
function thresholdOf(definition: AppDefinitionDocument): number {
  const configured = definition.jev_behavior?.['threshold'];
  if (
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured >= 0 &&
    configured <= 1
  ) {
    return configured;
  }
  return UNCONFIGURED_THRESHOLD;
}

/**
 * The APP-08 collision test (planner-owned mechanism):
 * case-fold and whitespace-tokenize both descriptions,
 * block on exact equality after folding, otherwise
 * block at a token Jaccard of {@link DESCRIPTION_COLLISION_JACCARD_THRESHOLD}
 * or higher.
 */
export function descriptionsCollide(
  candidateDescription: string,
  publishedDescription: string,
): boolean {
  const candidateTokens = tokenize(candidateDescription);
  const publishedTokens = tokenize(publishedDescription);
  if (candidateTokens.join(' ') === publishedTokens.join(' ')) {
    return true;
  }
  const candidateSet = new Set(candidateTokens);
  const publishedSet = new Set(publishedTokens);
  if (candidateSet.size === 0 || publishedSet.size === 0) {
    return false;
  }
  let intersection = 0;
  for (const token of candidateSet) {
    if (publishedSet.has(token)) {
      intersection += 1;
    }
  }
  const union = candidateSet.size + publishedSet.size - intersection;
  return intersection / union >= DESCRIPTION_COLLISION_JACCARD_THRESHOLD;
}

/** Case-folded, whitespace-tokenized description words. */
function tokenize(description: string): string[] {
  return description
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * The BLD-06 change summary — the publish-modal rows
 * (prototypes/mockup.html:1580-1585), emitted only for
 * fields that change. Status and version always change
 * on a real publish; form versions, indexes and
 * triggers are conditional on the sections the candidate
 * carries.
 */
export function buildChangeSummary(
  candidate: AppDefinitionDocument,
): ChangeSummaryRow[] {
  const rows: ChangeSummaryRow[] = [
    { field: 'status', from: candidate.lifecycle, to: 'published' },
    {
      field: 'version',
      from: `v${candidate.version}`,
      to: `v${candidate.version + 1}`,
    },
  ];

  if (candidate.form_schema !== null) {
    rows.push({
      field: 'form versions',
      from: 'current',
      to: 'pinned at link creation',
    });
  }

  const collections = declaredCollections(candidate);
  if (collections.length > 0) {
    rows.push({
      field: 'indexes',
      from: '—',
      to: `creation on ${collections.join(', ')}`,
    });
  }

  const triggers = candidate.triggers ?? [];
  if (triggers.length > 0) {
    rows.push({
      field: 'triggers',
      from: 'none',
      to: `${triggers.length} active`,
    });
  }

  return rows;
}

/** The collections the data-routing section declares. */
function declaredCollections(
  candidate: AppDefinitionDocument,
): string[] {
  const collections = candidate.routing_config?.['collections'];
  if (!Array.isArray(collections)) {
    return [];
  }
  return collections.filter(
    (collection): collection is string =>
      typeof collection === 'string' && collection.length > 0,
  );
}
