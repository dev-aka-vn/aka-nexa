import {
  JevRequestSchema,
  JevResponseSchema,
  RULE_BASED_PROVIDER_NAME,
  type JevProvider,
  type JevRequest,
  type ToolDescriptor,
} from '@akane/contract';

import type { ProviderHealthService } from './provider-health.service.js';

export interface RoutingInput {
  readonly draft: Omit<JevRequest, 'tools'>;
  /** RBAC-filtered candidates — never the global catalogue (T-03-01). */
  readonly authorizedTools: readonly ToolDescriptor[];
  /** Per-app configured confidence gate. */
  readonly threshold: (toolId: string) => number;
  /** Fresh permission re-check at the execution boundary. */
  readonly canOpenNow: (toolId: string) => Promise<boolean>;
  /** Absolute epoch ms; expires never revives (T-03-04). */
  readonly deadlineEpochMs: number;
}

export type RoutingOutcome =
  | { readonly kind: 'link'; readonly toolId: string }
  | { readonly kind: 'clarify'; readonly toolIds: readonly string[] };

/**
 * The authorization-and-contract gate every decision must cross (AI-SPEC §4).
 *
 * Chain semantics for this plan: providers are tried in config order; the first
 * decision that passes the full gate routes to a link. Any failure at any
 * boundary — malformed request, provider throw, schema mismatch, deadline,
 * `verified !== true`, below-threshold confidence, competing permitted
 * alternative, stale permission — yields the worker-owned clarification
 * outcome. 03-02 expands the chain (health, cache, per-provider deadline);
 * this class's gate contract does not change.
 */
export class RoutingOrchestrator {
  constructor(
    private readonly providers: readonly JevProvider[],
    private readonly options: {
      readonly health?: ProviderHealthService;
      readonly attemptCaps?: ReadonlyMap<string, number>;
    } = {},
  ) {}

  async route(input: RoutingInput): Promise<RoutingOutcome> {
    const permitted = new Set(input.authorizedTools.map((tool) => tool.id));
    let lastAlternatives: { tool_id: string; confidence: number }[] = [];

    const parsedRequest = JevRequestSchema.safeParse({
      ...input.draft,
      context: {
        ...(input.draft?.context ?? {}),
        app_hints: (input.draft?.context?.app_hints ?? []).filter((id) => permitted.has(id)),
      },
      tools: [...input.authorizedTools],
    });
    if (!parsedRequest.success) return { kind: 'clarify', toolIds: [] };
    const req = parsedRequest.data;
    if (req.state.force_clarification || req.tools.length === 0 || Date.now() >= input.deadlineEpochMs) {
      return { kind: 'clarify', toolIds: [] };
    }

    for (const provider of this.providers) {
      // One absolute epoch per request (T-03-04): the budget each hop gets is
      // `deadline - now`, never a fresh 2000ms (Pitfall 2).
      const remaining = input.deadlineEpochMs - Date.now();
      if (remaining <= 0) return { kind: 'clarify', toolIds: [] };

      // The local provider is the only guarantee — its unhealthiness is a
      // hard failure, never a silent skip (RTE-07). Hosted-only outages
      // degrade to the local link instead.
      if (provider.name === RULE_BASED_PROVIDER_NAME) {
        this.options.health?.assertLocalHealthy(provider.name);
      } else if (this.options.health?.isSkipped(provider.name)) {
        continue;
      }

      // Per-attempt budget: min(remaining, provider cap), from the same epoch.
      const cap = this.options.attemptCaps?.get(provider.name);
      const budget = cap !== undefined ? Math.min(remaining, cap) : remaining;

      let decision: unknown;
      try {
        decision = await withBudget(provider.decide(req), budget);
      } catch {
        continue; // provider failure never becomes a link
      }
      if (decision === BUDGET_EXHAUSTED) continue; // slow/hung provider: degrade, never a late link
      const parsed = JevResponseSchema.safeParse(decision);
      if (
        !parsed.success ||
        parsed.data.spec_version !== req.spec_version ||
        parsed.data.request_id !== req.request_id ||
        Date.now() >= input.deadlineEpochMs
      ) {
        continue;
      }
      const result = parsed.data;
      const id = result.choice.tool_id;
      const gate = id !== null && permitted.has(id) ? input.threshold(id) : Number.NaN;

      if (
        result.choice.verified === true &&
        !result.clarification_needed &&
        id !== null &&
        permitted.has(id) &&
        Number.isFinite(result.choice.confidence) &&
        result.choice.confidence >= 0 &&
        result.choice.confidence <= 1 &&
        Number.isFinite(gate) &&
        gate >= 0 &&
        gate <= 1 &&
        result.choice.confidence >= gate &&
        !(result.alternatives ?? []).some((alt) => permitted.has(alt.tool_id)) &&
        (await input.canOpenNow(id)) &&
        Date.now() < input.deadlineEpochMs
      ) {
        return { kind: 'link', toolId: id };
      }
      lastAlternatives = result.alternatives ?? [];
    }

    const toolIds: string[] = [];
    for (const alt of lastAlternatives) {
      if (toolIds.length >= 3) break;
      if (Date.now() >= input.deadlineEpochMs) return { kind: 'clarify', toolIds: [] };
      if (permitted.has(alt.tool_id) && (await input.canOpenNow(alt.tool_id))) {
        toolIds.push(alt.tool_id);
      }
    }
    return { kind: 'clarify', toolIds };
  }
}

const BUDGET_EXHAUSTED = Symbol('budget_exhausted');

/**
 * Race a provider attempt against its per-attempt budget. The attempt keeps
 * running in the background (a dangling handle must not crash the process),
 * but its result is discarded the moment the budget closes — the chain
 * degrades to the next link instead of waiting out a hung provider.
 */
async function withBudget(attempt: Promise<unknown>, budgetMs: number): Promise<unknown> {
  if (budgetMs <= 0) return BUDGET_EXHAUSTED;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<unknown>((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_EXHAUSTED), budgetMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // A slow attempt that loses the race rejects later — swallow it so the
    // rejection never surfaces as an unhandledRejection.
    attempt.catch(() => {});
  }
}
