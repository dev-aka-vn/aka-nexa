/**
 * Wizard step 5 — Routing (BLD-01).
 *
 * Where the data lives and how it moves: the
 * data mode is **chosen here** (the mockup's
 * radio-cards with their descriptions), the
 * connector is selected when the mode routes
 * externally, and the field-mapping link
 * opens the designer's mapping surface.
 *
 * The connector options are the app's own
 * provisioned connector requests (BLD-10,
 * plan 06's endpoint) — an app references a
 * connector; credentials are owned and
 * managed globally, never by the app.
 *
 * Finishing PATCHes two sections against the
 * draft: `metadata` (the data mode) and
 * `data-routing` (the routing config the
 * mode implies).
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type { ApiClient } from '../api/client.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

/** The mockup's mode descriptions (tabRouting). */
export const MODE_DESCRIPTIONS: Record<
  'internal' | 'external' | 'hybrid',
  string
> = {
  internal:
    'Write to MongoDB collections owned by this app. Queries use the Query DSL with an auto-injected user filter.',
  external:
    'Route to a referenced connector with field mapping. No internal storage.',
  hybrid:
    'Internal write (synchronous) plus external call (asynchronous via BullMQ). Internal write must succeed to confirm.',
};

export const DATA_MODES = [
  'internal',
  'external',
  'hybrid',
] as const;

export type DataMode = (typeof DATA_MODES)[number];

/** One provisioned connector request, as the list serves it. */
export interface ConnectorOption {
  connector_id: string;
  name: string;
  base_url: string;
  state: string;
}

export interface RoutingValue {
  mode: DataMode;
  connectorId: string;
}

export interface RoutingStepProps {
  /** The draft's app_id — the sections PATCH against it. */
  appId: string;
  value: RoutingValue;
  onChange: (value: RoutingValue) => void;
  client: ApiClient;
}

interface ConnectorRequestsResponse {
  requests: ConnectorOption[];
}

/** The connector-request list's wire shape. */
const ConnectorRequestsSchema = {
  parse: (data: unknown): ConnectorRequestsResponse => {
    const payload = data as { requests?: unknown };
    if (!Array.isArray(payload.requests)) {
      throw new Error('malformed connector-request list');
    }
    return {
      requests: payload.requests.filter(
        (request): request is ConnectorOption =>
          typeof request === 'object' &&
          request !== null &&
          typeof (request as ConnectorOption).connector_id ===
            'string',
      ),
    };
  },
};

/** Whether the step's required fields pass inline validation. */
export function routingValid(value: RoutingValue): boolean {
  return value.mode === 'internal' || value.connectorId.length > 0;
}

export function RoutingStep({
  appId,
  value,
  onChange,
  client,
}: RoutingStepProps): ReactElement {
  // The app's provisioned connector requests
  // (the selectable connectors). Async —
  // skeleton while loading, inline error on
  // failure (BLD-07/BLD-09).
  const [connectors, setConnectors] = useState<
    ConnectorOption[] | null
  >(null);
  const [connectorsError, setConnectorsError] =
    useState<unknown>(null);

  const loadConnectors = useCallback(async () => {
    setConnectorsError(null);
    try {
      const response = await client.get(
        `/apps/${appId}/connector-requests`,
        ConnectorRequestsSchema,
      );
      // Only provisioned connectors are
      // referenceable — a pending or rejected
      // request cannot be routed to.
      setConnectors(
        response.requests.filter(
          (request) => request.state === 'provisioned',
        ),
      );
    } catch (error) {
      setConnectorsError(error);
    }
  }, [client, appId]);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const setMode = (mode: DataMode): void => {
    onChange({ ...value, mode });
  };

  const valid = routingValid(value);

  /**
   * External routing needs a connector. Internal
   * does not (the connector select is hidden and
   * the choice cannot block finishing).
   */
  const connectorRequired = value.mode !== 'internal';

  return (
    <div data-testid="wizard-step-routing">
      <section className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h2>Data routing</h2>
        </div>
        <div className="card-body">
          <div className="field">
            <span className="label">Mode</span>
            <div
              className="od-stack"
              style={{ '--od-gap': '10px' } as never}
            >
              {DATA_MODES.map((mode) => (
                <label
                  key={mode}
                  className={`radio-card${
                    value.mode === mode ? ' sel' : ''
                  }`}
                  data-testid={`wizard-mode-${mode}`}
                >
                  <input
                    type="radio"
                    name="wizard-data-mode"
                    checked={value.mode === mode}
                    onChange={() => setMode(mode)}
                  />
                  <span>
                    <span className="rc-t">
                      {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </span>
                    <span className="rc-d">
                      {MODE_DESCRIPTIONS[mode]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          {connectorRequired ? (
            <div className="field">
              <label htmlFor="wizard-connector-select">
                Connector<span className="req">*</span>
              </label>
              {connectorsError ? (
                <InlineError
                  operation="load the app's connectors"
                  error={connectorsError}
                  onRetry={() => void loadConnectors()}
                />
              ) : connectors === null ? (
                <Skeleton label="Loading connectors" />
              ) : (
                <select
                  id="wizard-connector-select"
                  className={`select${
                    connectorRequired && value.connectorId.length === 0
                      ? ' invalid'
                      : ''
                  }`}
                  data-testid="wizard-connector-select"
                  value={value.connectorId}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      connectorId: event.target.value,
                    })
                  }
                >
                  <option value="">
                    Select a connector…
                  </option>
                  {connectors.map((connector) => (
                    <option
                      key={connector.connector_id}
                      value={connector.connector_id}
                    >
                      {connector.name} ({connector.connector_id})
                    </option>
                  ))}
                </select>
              )}
              <span className="helper">
                Apps reference connectors; credentials are owned and
                managed globally. Need a connector? Request one from
                the Connectors page after the wizard.
              </span>
              {connectorRequired && value.connectorId.length === 0 ? (
                <span
                  className="error-text"
                  data-testid="wizard-connector-error"
                  role="alert"
                >
                  A connector is required for {value.mode} routing
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Field mapping</h2>
        </div>
        <div className="card-body">
          {value.mode === 'internal' ? (
            <p className="helper" style={{ fontSize: 14 }}>
              Internal-only mode stores the submission as-is; no
              field mapping is needed.
            </p>
          ) : (
            <p className="helper" style={{ fontSize: 14 }}>
              Map the form's fields to the connector's fields in the
              designer's mapping surface — a per-field pairing that
              round-trips through the app definition.
            </p>
          )}
          <div style={{ marginTop: 14 }}>
            <a
              className="btn"
              data-testid="wizard-open-mapping"
              href={`#/apps/${appId}/designer`}
            >
              Open field mapping
            </a>
          </div>
        </div>
      </section>
      <span
        data-testid="wizard-routing-valid"
        data-valid={valid ? 'true' : 'false'}
        hidden
      />
    </div>
  );
}

/**
 * The two section PATCHes finishing emits:
 * the data mode on `metadata`, and the
 * routing config it implies on
 * `data-routing`.
 */
export function routingPatches(
  value: RoutingValue,
): Array<{ section: string; patch: Record<string, unknown> }> {
  const routingConfig: Record<string, unknown> = {
    data_mode: value.mode,
  };
  if (value.mode !== 'internal' && value.connectorId.length > 0) {
    routingConfig['connector_id'] = value.connectorId;
  }
  return [
    { section: 'metadata', patch: { data_mode: value.mode } },
    { section: 'data-routing', patch: { routing_config: routingConfig } },
  ];
}
