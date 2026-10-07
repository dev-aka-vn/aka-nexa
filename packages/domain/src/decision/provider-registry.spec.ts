import { describe, expect, it, vi } from 'vitest';
import { RULE_BASED_PROVIDER_NAME, type JevProvider } from '@akane/contract';

import { ProviderRegistry } from './provider-registry.js';

function stubProvider(name: string, capabilities: JevProvider['capabilities'] = ['tool_selection']): JevProvider {
  return {
    name,
    spec_version: '1.0',
    capabilities,
    async decide() {
      throw new Error('not used');
    },
    async healthCheck() {
      return { status: 'healthy', model_version: `${name}-0`, spec_version: '1.0', capabilities, uptime_seconds: 0 };
    },
  };
}

const rules = () => stubProvider(RULE_BASED_PROVIDER_NAME, ['tool_selection', 'clarification', 'multi_turn']);

describe('ProviderRegistry (RTE-04/RTE-05, D-56/D-58/D-59)', () => {
  it('honors config order in the chain', () => {
    const a = stubProvider('hosted-a');
    const b = stubProvider('hosted-b');
    const registry = new ProviderRegistry({
      providers: [
        { provider: a, hosted: true, attestation: { regionApproval: 'eu', noTrainingRetention: 'v1' } },
        { provider: b, hosted: true, attestation: { regionApproval: 'eu', noTrainingRetention: 'v1' } },
        { provider: rules() },
      ],
    });
    expect(registry.chain().map((p) => p.name)).toEqual(['hosted-a', 'hosted-b', RULE_BASED_PROVIDER_NAME]);
  });

  it('throws at construction when the terminal link is not the rule-based provider', () => {
    expect(
      () => new ProviderRegistry({ providers: [{ provider: stubProvider('hosted-a') }, { provider: stubProvider('hosted-b') }] }),
    ).toThrow(/PROVIDER_CHAIN_TERMINAL_MISSING/);
  });

  it('throws at construction on an empty chain', () => {
    expect(() => new ProviderRegistry({ providers: [] })).toThrow(/PROVIDER_REGISTRY_EMPTY/);
  });

  it('drops a hosted entry without a region attestation, with a loud boot log', () => {
    const log = vi.fn();
    const hosted = stubProvider('hosted-x');
    const registry = new ProviderRegistry(
      {
        providers: [
          { provider: hosted, hosted: true },
          { provider: rules() },
        ],
      },
      log,
    );
    expect(registry.chain().map((p) => p.name)).toEqual([RULE_BASED_PROVIDER_NAME]);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('hosted-x');
  });

  it('drops a hosted entry attested only for the wrong dimension (region without no-training)', () => {
    const hosted = stubProvider('hosted-y');
    const registry = new ProviderRegistry(
      {
        providers: [
          { provider: hosted, hosted: true, attestation: { regionApproval: 'eu', noTrainingRetention: '' } },
          { provider: rules() },
        ],
      },
      () => {},
    );
    expect(registry.chain().map((p) => p.name)).toEqual([RULE_BASED_PROVIDER_NAME]);
  });

  it('boots clean in local-only mode (zero hosted providers, never a failure)', () => {
    const registry = new ProviderRegistry({ providers: [{ provider: rules() }] });
    expect(registry.isLocalOnly()).toBe(true);
    expect(registry.chain()).toHaveLength(1);
  });

  it('capability-gated shape skips an unqualified provider', () => {
    const singleTurn = stubProvider('hosted-single', ['tool_selection']);
    const registry = new ProviderRegistry({
      providers: [
        { provider: singleTurn, hosted: true, attestation: { regionApproval: 'eu', noTrainingRetention: 'v1' } },
        { provider: rules() },
      ],
    });
    const multiTurnChain = registry.chain(['multi_turn']);
    expect(multiTurnChain.map((p) => p.name)).toEqual([RULE_BASED_PROVIDER_NAME]);
    expect(registry.chain(['tool_selection']).map((p) => p.name)).toEqual(['hosted-single', RULE_BASED_PROVIDER_NAME]);
  });

  it('exposes per-attempt caps keyed by provider name', () => {
    const registry = new ProviderRegistry({
      providers: [{ provider: rules(), attemptCapMs: 250 }],
    });
    expect(registry.attemptCaps().get(RULE_BASED_PROVIDER_NAME)).toBe(250);
  });
});
