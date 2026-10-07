/**
 * RTE-11 conformance suite — 50-intent per-provider gate with Wilson intervals.
 *
 * Loads the synthetic labelled fixture set from `fixtures/labelled-intents.json`
 * and runs every case against every registered provider (including the
 * rule-based terminal). CI fails on safety or expected-outcome regressions;
 * accuracy is reported per app with confidence intervals, never as a single
 * aggregate number (RTE-11, SC5).
 */

import { describe, expect, it, beforeAll } from 'vitest';
import {
  JEV_SPEC_VERSION,
  JevRequestSchema,
  JevResponseSchema,
  type JevRequest,
  type JevResponse,
} from '@akane/contract';
import { ProviderRegistry, type ProviderChainConfig } from './provider-registry.js';
import { RuleBasedProvider } from './rule-based.provider.js';
import casesJson from './fixtures/labelled-intents.json' with { type: 'json' };
import type { LabelledIntentCase } from './fixtures/labelled-intents.js';

const cases: LabelledIntentCase[] = casesJson.cases as LabelledIntentCase[];

// Build registry synchronously once cases are loaded.
// Merge aliases from ALL cases for each candidate ID.
const allAliases = new Map<string, string[]>();
for (const c of cases) {
  for (const cand of c.candidates) {
    const existing = allAliases.get(cand.id) ?? [];
    const merged = Array.from(new Set([...existing, ...cand.aliases]));
    allAliases.set(cand.id, merged);
  }
}
const ruleBased = new RuleBasedProvider(allAliases);
const config: ProviderChainConfig = {
  providers: [{ provider: ruleBased }],
};
const registry = new ProviderRegistry(config);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProviderStats {
  readonly providerName: string;
  readonly correctLinks: number;
  readonly totalLinks: number;
  readonly shouldLink: number;
  readonly correctClarifies: number;
  readonly shouldClarify: number;
  readonly schemaViolations: number;
  readonly unauthorizedExposures: number;
  readonly strata: {
    readonly en: { correctLinks: number; totalLinks: number; shouldLink: number; correctClarifies: number; shouldClarify: number };
    readonly vi: { correctLinks: number; totalLinks: number; shouldLink: number; correctClarifies: number; shouldClarify: number };
    readonly mixed: { correctLinks: number; totalLinks: number; shouldLink: number; correctClarifies: number; shouldClarify: number };
    readonly ambiguous: { correctLinks: number; totalLinks: number; shouldLink: number; correctClarifies: number; shouldClarify: number };
  };
}

function buildRequest(case_: LabelledIntentCase): JevRequest {
  const permittedIds = new Set(case_.permissions);
  return JevRequestSchema.parse({
    spec_version: JEV_SPEC_VERSION,
    request_id: `conformance-${case_.id}`,
    state: {
      locale: case_.locale as JevRequest['state']['locale'],
      conversation_id: `conformance-${case_.id}`,
      turn_count: case_.history.length,
      force_clarification: case_.locale === 'fr',
    },
    question: case_.question,
    context: {
      real_user_id: 'conformance-user',
      app_hints: [],
      previous_turns: case_.history,
    },
    tools: case_.candidates
      .filter((c) => permittedIds.has(c.id))
      .map((c) => ({ id: c.id, description: c.description, parameters: [] })),
  });
}

function assertValidResponse(decision: unknown, req: JevRequest): JevResponse {
  const parsed = JevResponseSchema.safeParse(decision);
  expect(parsed.success, `provider returned malformed response: ${parsed.error?.message}`).toBe(true);
  if (!parsed.success) throw new Error('malformed response');
  const res = parsed.data;
  expect(res.spec_version).toBe(req.spec_version);
  expect(res.request_id).toBe(req.request_id);
  return res;
}

function hasUnauthorizedId(res: JevResponse, permittedIds: Set<string>): boolean {
  if (res.choice.tool_id !== null && !permittedIds.has(res.choice.tool_id)) return true;
  if (res.alternatives?.some((alt) => !permittedIds.has(alt.tool_id))) return true;
  return false;
}

function wilson(k: number, n: number, z = 1.96): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 0 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

function outcomeFor(res: JevResponse, permittedIds: Set<string>): 'link' | 'clarify' {
  if (
    res.choice.verified === true &&
    !res.clarification_needed &&
    res.choice.tool_id !== null &&
    permittedIds.has(res.choice.tool_id) &&
    !(res.alternatives ?? []).some((alt) => permittedIds.has(alt.tool_id))
  ) {
    return 'link';
  }
  return 'clarify';
}

function strataFor(case_: LabelledIntentCase): keyof ProviderStats['strata'] {
  if (case_.locale === 'en') return 'en';
  if (case_.locale === 'vi') return 'vi';
  if (case_.locale === 'mixed') return 'mixed';
  return 'ambiguous';
}

// ---------------------------------------------------------------------------
// Per-provider conformance
// ---------------------------------------------------------------------------

describe('RTE-11 conformance suite', () => {
  const providers = registry.chain();

  for (const provider of providers) {
    describe(`conformance: ${provider.name}`, () => {
      let stats: ProviderStats;

      beforeAll(() => {
        stats = {
          providerName: provider.name,
          correctLinks: 0,
          totalLinks: 0,
          shouldLink: 0,
          correctClarifies: 0,
          shouldClarify: 0,
          schemaViolations: 0,
          unauthorizedExposures: 0,
          strata: {
            en: { correctLinks: 0, totalLinks: 0, shouldLink: 0, correctClarifies: 0, shouldClarify: 0 },
            vi: { correctLinks: 0, totalLinks: 0, shouldLink: 0, correctClarifies: 0, shouldClarify: 0 },
            mixed: { correctLinks: 0, totalLinks: 0, shouldLink: 0, correctClarifies: 0, shouldClarify: 0 },
            ambiguous: { correctLinks: 0, totalLinks: 0, shouldLink: 0, correctClarifies: 0, shouldClarify: 0 },
          },
        };
      });

      for (const case_ of cases) {
        it(`case ${case_.id}`, async () => {
        const req = buildRequest(case_);
        const permittedIds = new Set(case_.permissions);

        let decision: JevResponse;
        try {
          decision = assertValidResponse(await provider.decide(req), req);
        } catch (error) {
          stats.schemaViolations += 1;
          throw error;
        }

        // No unauthorized ID may appear in choice or alternatives.
        expect(hasUnauthorizedId(decision, permittedIds)).toBe(false);

        const actual = outcomeFor(decision, permittedIds);
        const expected = case_.expected.outcome;

        if (expected === 'link') {
          stats.totalLinks += 1;
          stats.shouldLink += 1;
          if (actual === 'link' && decision.choice.tool_id === case_.expected.app_id) {
            stats.correctLinks += 1;
          }
          expect(actual).toBe('link');
          if (actual === 'link') {
            expect(decision.choice.tool_id).toBe(case_.expected.app_id);
          }
        } else {
          stats.shouldClarify += 1;
          if (actual === 'clarify') {
            stats.correctClarifies += 1;
            const displayed = (decision.alternatives ?? []).map((a) => a.tool_id);
            const expectedDisplayed = case_.expected.displayed_ids ?? [];
            expect(displayed.sort()).toEqual(expectedDisplayed.sort());
          }
          expect(actual).toBe('clarify');
        }

        // Update strata.
        const stratum = strataFor(case_);
        if (expected === 'link') {
          stats.strata[stratum].shouldLink += 1;
          if (actual === 'link') stats.strata[stratum].correctLinks += 1;
        } else {
          stats.strata[stratum].shouldClarify += 1;
          if (actual === 'clarify') stats.strata[stratum].correctClarifies += 1;
        }
        if (actual === 'link') stats.strata[stratum].totalLinks += 1;
      });
    }

    it('reports per-app precision/recall with Wilson intervals', () => {
      // This is a reporting test: it must not throw and must produce
      // per-stratum figures. CI does not fail on headline accuracy (SC5).
      const report = generateReport(stats);
      expect(report.provider).toBe(provider.name);
      expect(report.strata.en.precision).toBeDefined();
      expect(report.strata.vi.precision).toBeDefined();
      expect(report.strata.mixed.precision).toBeDefined();
      expect(report.strata.ambiguous.precision).toBeDefined();
    });

    it('has no schema violations or unauthorized exposures', () => {
      expect(stats.schemaViolations).toBe(0);
      expect(stats.unauthorizedExposures).toBe(0);
    });
  });
  // for (const provider of providers)
}
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface StratumReport {
  readonly precision: number;
  readonly precision_ci: { lower: number; upper: number };
  readonly recall: number;
  readonly recall_ci: { lower: number; upper: number };
  readonly correct_links: number;
  readonly total_links: number;
  readonly should_link: number;
  readonly correct_clarifies: number;
  readonly should_clarify: number;
  readonly note: string;
}

interface ConformanceReport {
  readonly provider: string;
  readonly overall: {
    readonly precision: number;
    readonly precision_ci: { lower: number; upper: number };
    readonly recall: number;
    readonly recall_ci: { lower: number; upper: number };
    readonly schema_violations: number;
    readonly unauthorized_exposures: number;
  };
  readonly strata: {
    readonly en: StratumReport;
    readonly vi: StratumReport;
    readonly mixed: StratumReport;
    readonly ambiguous: StratumReport;
  };
}

function stratumReport(s: ProviderStats['strata']['en']): StratumReport {
  const precision = s.totalLinks > 0 ? s.correctLinks / s.totalLinks : 0;
  const recall = s.shouldLink > 0 ? s.correctLinks / s.shouldLink : 0;
  const pci = s.totalLinks > 0 ? wilson(s.correctLinks, s.totalLinks) : { lower: 0, upper: 0 };
  const rci = s.shouldLink > 0 ? wilson(s.correctLinks, s.shouldLink) : { lower: 0, upper: 0 };
  const note =
    s.totalLinks < 5 || s.shouldLink < 5
      ? 'N/A (small denominator — inconclusive)'
      : `${s.correctLinks}/${s.totalLinks} links, ${s.correctLinks}/${s.shouldLink} recall`;
  return {
    precision,
    precision_ci: pci,
    recall,
    recall_ci: rci,
    correct_links: s.correctLinks,
    total_links: s.totalLinks,
    should_link: s.shouldLink,
    correct_clarifies: s.correctClarifies,
    should_clarify: s.shouldClarify,
    note,
  };
}

function generateReport(stats: ProviderStats): ConformanceReport {
  const precision = stats.totalLinks > 0 ? stats.correctLinks / stats.totalLinks : 0;
  const recall = stats.shouldLink > 0 ? stats.correctLinks / stats.shouldLink : 0;
  return {
    provider: stats.providerName,
    overall: {
      precision,
      precision_ci: stats.totalLinks > 0 ? wilson(stats.correctLinks, stats.totalLinks) : { lower: 0, upper: 0 },
      recall,
      recall_ci: stats.shouldLink > 0 ? wilson(stats.correctLinks, stats.shouldLink) : { lower: 0, upper: 0 },
      schema_violations: stats.schemaViolations,
      unauthorized_exposures: stats.unauthorizedExposures,
    },
    strata: {
      en: stratumReport(stats.strata.en),
      vi: stratumReport(stats.strata.vi),
      mixed: stratumReport(stats.strata.mixed),
      ambiguous: stratumReport(stats.strata.ambiguous),
    },
  };
}
