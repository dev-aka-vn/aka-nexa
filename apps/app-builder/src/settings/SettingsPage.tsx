/**
 * The settings page (`#/settings`) —
 * the **deferred** platform knobs,
 * named (D-109).
 *
 * The JEV provider chain, the decision
 * cache, and the circuit breaker are
 * **platform-admin territory**: they
 * ship with the deployment's platform
 * configuration, not the department
 * admin's self-service surface (D-109).
 * The page is therefore **read-only** —
 * it names each knob and its semantics
 * so the operator can find it in the
 * deployment config, and offers no fake
 * input that goes nowhere. The builder's
 * self-service surfaces are the app,
 * form, role, and connector definitions
 * the rest of the SPA owns.
 */

import type { ReactElement } from 'react';

/**
 * One deferred knob: its name and the
 * semantics the deployment's platform
 * configuration attaches to it.
 */
interface Knob {
  readonly name: string;
  readonly semantics: string;
}

/** One deferred settings card. */
function SettingsCard({
  testId,
  title,
  description,
  knobs,
  note,
}: {
  readonly testId: string;
  readonly title: string;
  readonly description: string;
  readonly knobs: readonly Knob[];
  readonly note?: string;
}): ReactElement {
  return (
    <section
      className="card"
      data-testid={testId}
    >
      <div className="card-head">
        <div className="od-fill">
          <h2>{title}</h2>
          <p
            className="sub"
            style={{ margin: '4px 0 0' }}
          >
            {description}
          </p>
        </div>
        <span className="pill-mono">
          platform-admin
        </span>
      </div>
      <div className="card-body">
        <dl className="kv">
          {knobs.map((knob) => (
            <div key={knob.name}>
              <dt>{knob.name}</dt>
              <dd>{knob.semantics}</dd>
            </div>
          ))}
        </dl>
        {note !== undefined ? (
          <p className="helper" style={{ marginTop: 12 }}>
            {note}
          </p>
        ) : null}
        <div
          className="callout callout-accent"
          style={{ marginTop: 14 }}
        >
          <div>
            <b>Deferred — platform-admin territory
            (D-109).</b> This surface ships with the
            deployment's platform configuration;
            it is not a builder self-service knob.
          </div>
        </div>
      </div>
    </section>
  );
}

/** The JEV provider chain's knobs. */
const JEV_CHAIN_KNOBS: readonly Knob[] = [
  {
    name: 'Provider order',
    semantics:
      'The fallback chain, applied top to bottom — an unhealthy provider is skipped for the next in line.',
  },
  {
    name: 'Decision spec',
    semantics:
      'The JEV spec revision each provider is evaluated against.',
  },
  {
    name: 'Request timeout',
    semantics:
      'Per-provider decision request timeout, in milliseconds.',
  },
  {
    name: 'Minimum confidence',
    semantics:
      'The confidence floor a provider result must meet before the routing pipeline accepts it.',
  },
];

/** The decision cache's knobs. */
const DECISION_CACHE_KNOBS: readonly Knob[] = [
  {
    name: 'Cache TTL',
    semantics:
      'How long a cached JEV decision is served before re-evaluation, in seconds.',
  },
  {
    name: 'Health check interval',
    semantics:
      'How often the provider chain health is re-probed, in seconds.',
  },
  {
    name: 'Cache key strategy',
    semantics:
      'How the cache keys a decision — the identity and scope dimensions the key covers.',
  },
  {
    name: 'Decision caching',
    semantics:
      'Whether cached decisions are served at all (the enable toggle).',
  },
];

/** The circuit breaker's knobs. */
const CIRCUIT_BREAKER_KNOBS: readonly Knob[] = [
  {
    name: 'Failure threshold',
    semantics:
      'The consecutive failures after which a provider is tripped open.',
  },
  {
    name: 'Reset timeout',
    semantics:
      'How long a tripped provider is skipped before it is probed again, in seconds.',
  },
];

/**
 * The settings page: the three deferred
 * platform-knob cards, named and marked.
 */
export function SettingsPage(): ReactElement {
  return (
    <div data-testid="settings-page">
      <div className="page-head">
        <div className="titles">
          <h1>Settings</h1>
          <p className="sub">
            Platform defaults, JEV provider
            chain, and operational guardrails.
          </p>
        </div>
        <div className="page-actions">
          <span className="pill-mono">
            read-only · platform-admin
          </span>
        </div>
      </div>
      <div
        className="callout callout-accent"
        style={{ marginBottom: 18 }}
      >
        <div>
          <b>These knobs ship with the
          deployment.</b> The JEV chain, the
          decision cache, and the circuit
          breaker are platform-admin
          configuration (D-109) — the
          deployment's platform team owns
          them. The builder's self-service
          surfaces are the app, form, role,
          and connector definitions in the
          rest of this console.
        </div>
      </div>
      <div
        className="od-stack"
        style={{ '--od-gap': '18px' } as never}
      >
        <SettingsCard
          testId="settings-jev-chain"
          title="JEV provider chain"
          description="The decision-model chain the routing pipeline consults."
          knobs={JEV_CHAIN_KNOBS}
          note="If the primary provider is unhealthy, the next in the chain is used automatically. If all are down, decisions fall back to rule-based matching."
        />
        <SettingsCard
          testId="settings-decision-cache"
          title="Decision cache"
          description="The cached-decision layer in front of the provider chain."
          knobs={DECISION_CACHE_KNOBS}
        />
        <SettingsCard
          testId="settings-circuit-breaker"
          title="Circuit breaker"
          description="The guardrail that trips a failing provider out of the chain."
          knobs={CIRCUIT_BREAKER_KNOBS}
          note="After the threshold is reached, the provider is skipped until the reset timeout elapses."
        />
      </div>
    </div>
  );
}
