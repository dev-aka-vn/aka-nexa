/**
 * The provider seam (D-23).
 *
 * Transcribed from PRD §11.2 with two D-23 amendments, and published as a
 * **first-party named interface** rather than a vendor wire protocol: "JEV" is
 * a PRD invention with no industry standard, and the PRD's "OpenJev" reference
 * implementations are unofficial reconstructions. A vendor protocol would make
 * an unofficial server definition load-bearing; a named interface makes the
 * platform's own type the contract.
 *
 * Amendments over the PRD:
 *  - `JevResponse.choice` is **required** (the PRD types it `choice?`), and
 *  - `JevChoice` carries `verified: boolean | null`.
 *
 * Nothing here imports `jose` or any transport. The provider is reached through
 * whatever HTTP client the routing phase wires up; the boundary lint rule (R2)
 * keeps asymmetric signing primitives inside the crypto owner regardless.
 */
import type { JevRequest, JevResponse } from './v1/index.js';
import {
  JEV_SPEC_VERSION,
  JevRequestSchema,
  JevResponseSchema,
} from './v1/index.js';

export type { JevRequest, JevResponse };

/**
 * What a provider can actually do. A provider advertises these and the routing
 * phase refuses to route a conversation shape a provider cannot serve — a
 * capability list that is decoration rather than a gate is how a
 * single-turn-only provider ends up in a multi-turn fallback chain.
 */
export type JevCapability = 'tool_selection' | 'clarification' | 'multi_turn' | 'streaming';

/** PRD §11.1 `GET /health`. Kept structural — the routing phase owns the transport. */
export interface HealthStatus {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly model_version: string;
  readonly spec_version: string;
  readonly capabilities: readonly JevCapability[];
  readonly uptime_seconds: number;
}

export interface JevProvider {
  readonly name: string;
  readonly spec_version: string;
  readonly capabilities: JevCapability[];
  /** Takes and returns the frozen v1 shapes; a provider that validates its own input is the cheap half of conformance. */
  decide(req: JevRequest): Promise<JevResponse>;
  healthCheck(): Promise<HealthStatus>;
}

/**
 * The terminal fallback in the PRD §11.4 chain (regex + keyword matching, no
 * external dependency) is **named here**, in the contract, so that its absence
 * is a startup assertion failure rather than a runtime surprise discovered when
 * a vendor provider is unreachable. Naming the fallback is the only part of
 * the chain this package owes; the chain itself, its timeouts and its
 * `min_confidence` thresholds belong to the routing phase.
 */
export const RULE_BASED_PROVIDER_NAME = 'rule-based';

/** The only spec version this contract package speaks. A v2 gets a sibling directory, not a branch on a field. */
export const SUPPORTED_JEV_SPEC_VERSION = JEV_SPEC_VERSION;

export { JevRequestSchema, JevResponseSchema };
