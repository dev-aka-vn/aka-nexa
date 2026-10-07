import {
  RULE_BASED_PROVIDER_NAME,
  type JevCapability,
  type JevProvider,
} from '@akane/contract';

/**
 * Operator attestation record (D-56/D-58). Both halves are required: a
 * region-approved hosted provider that trains on our payloads, or a no-train
 * provider outside the deployment's locked region, fails the gate.
 */
export interface ProviderAttestation {
  /** Naming the deployment's locked-region approval, e.g. 'eu-central-1-approved-2026-09'. */
  readonly regionApproval: string;
  /** Naming the no-training / no-retention commitment, e.g. 'no-train-no-retain-v1'. */
  readonly noTrainingRetention: string;
}

export interface ProviderChainEntry {
  readonly provider: JevProvider;
  /** Hosted providers cross the D-56/D-58 trust gate; local ones do not. */
  readonly hosted?: boolean;
  readonly attestation?: ProviderAttestation;
  /** Provider-specific per-attempt budget cap; the shared absolute deadline still wins. */
  readonly attemptCapMs?: number;
}

export interface ProviderChainConfig {
  /** Ordered candidates; the last entry MUST be the rule-based terminal link (RTE-05). */
  readonly providers: readonly ProviderChainEntry[];
}

function isAttested(entry: ProviderChainEntry): boolean {
  return (
    typeof entry.attestation?.regionApproval === 'string' &&
    entry.attestation.regionApproval.length > 0 &&
    typeof entry.attestation?.noTrainingRetention === 'string' &&
    entry.attestation.noTrainingRetention.length > 0
  );
}

/**
 * Config-ordered decision-provider registry (RTE-04/RTE-05, D-56/D-58/D-59).
 *
 * Invariants asserted at construction (a boot failure, never a runtime one):
 *  - the chain terminates in the named rule-based provider;
 *  - every `hosted: true` entry carries an explicit region + no-training
 *    attestation, otherwise it is dropped with a loud boot log naming it.
 *
 * A zero-hosted-provider deployment is a fully supported local-only mode —
 * it constructs cleanly and never throws.
 */
export class ProviderRegistry {
  readonly #entries: readonly ProviderChainEntry[];

  constructor(
    config: ProviderChainConfig,
    private readonly bootLog: (message: string) => void = (message) =>
      console.error(message),
  ) {
    if (config.providers.length === 0) {
      throw new Error('PROVIDER_REGISTRY_EMPTY: at least the rule-based provider is required');
    }
    const terminal = config.providers[config.providers.length - 1];
    if (terminal.provider.name !== RULE_BASED_PROVIDER_NAME) {
      throw new Error(
        `PROVIDER_CHAIN_TERMINAL_MISSING: chain must end with '${RULE_BASED_PROVIDER_NAME}', got '${terminal.provider.name}'`,
      );
    }

    const admitted: ProviderChainEntry[] = [];
    for (const entry of config.providers) {
      if (entry.hosted === true && !isAttested(entry)) {
        this.bootLog(
          `[provider-registry] dropping hosted provider '${entry.provider.name}': missing region approval or no-training/no-retention attestation (D-56/D-58); local-only routing continues`,
        );
        continue;
      }
      admitted.push(entry);
    }
    if (admitted[admitted.length - 1]?.provider.name !== RULE_BASED_PROVIDER_NAME) {
      throw new Error(
        `PROVIDER_CHAIN_TERMINAL_DROPPED: the rule-based terminal link was excluded (marked hosted without attestation?)`,
      );
    }
    this.#entries = admitted;
  }

  /**
   * The ordered chain, filtered to providers that can serve the required
   * conversation shape. A shape requiring `multi_turn` skips a provider that
   * does not advertise it — a capability list that is decorative would be how
   * a single-turn-only hosted provider ends up serving follow-ups.
   */
  chain(requiredCapabilities: readonly JevCapability[] = []): readonly JevProvider[] {
    return this.#entries
      .filter((entry) =>
        requiredCapabilities.every((cap) => entry.provider.capabilities.includes(cap)),
      )
      .map((entry) => entry.provider);
  }

  /** Per-attempt caps keyed by provider name, for the orchestrator's min(remaining, cap) budget. */
  attemptCaps(): ReadonlyMap<string, number> {
    const caps = new Map<string, number>();
    for (const entry of this.#entries) {
      if (typeof entry.attemptCapMs === 'number' && Number.isFinite(entry.attemptCapMs)) {
        caps.set(entry.provider.name, entry.attemptCapMs);
      }
    }
    return caps;
  }

  /** The terminal offline provider — guaranteed present by the construction assertion. */
  localProvider(): JevProvider {
    return this.#entries[this.#entries.length - 1].provider;
  }

  /** True when no hosted provider was admitted; a first-class supported mode. */
  isLocalOnly(): boolean {
    return this.#entries.every((entry) => entry.hosted !== true);
  }
}
