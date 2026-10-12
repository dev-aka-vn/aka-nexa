/**
 * The connector request form (BLD-10,
 * D-99, T-06-23) — the self-service boundary
 * a department admin drives.
 *
 * ## The D-99 definition, minus the sealed
 * material
 *
 * The form collects **exactly** the frozen
 * `ConnectorRequestDefinitionSchema` field
 * set: the connector type, the display name,
 * the base URL, and the optional operational
 * policy (timeout, retries, rate limit,
 * mapping, taxonomy). **No sealed-material
 * field exists anywhere in the form**
 * (D-97/FND-10) — the operator fills the
 * sealed material through the existing
 * audited provision seam, and the submitted
 * body carries no key that could carry it
 * (T-06-23: the strict contract's field set
 * only).
 *
 * ## Validation (BLD-07)
 *
 * The three required fields are validated
 * inline before the POST fires; an optional
 * policy field that is not valid JSON is
 * refused inline, naming the field — never a
 * generic message, and never a request that
 * would be rejected downstream.
 */

import {
  useCallback,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  ConnectorRequestViewSchema,
  type ConnectorRequestView,
} from '../api/connectors.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';

/**
 * The platform's known connector ids — the
 * connector-type vocabulary the request
 * form offers. `redmine` is the domain's
 * built-in external-system adapter; the
 * IM connectors (Slack, Teams, Zalo OA,
 * Telegram) are the platform's integration
 * family.
 */
export const KNOWN_CONNECTOR_IDS = [
  'redmine',
  'slack',
  'teams',
  'zalo-oa',
  'telegram',
] as const;

export interface ConnectorRequestFormProps {
  /** The app the request belongs to. */
  readonly appId: string;
  /** The definition POSTed; the queue refreshes on success. */
  readonly onSubmitted: (
    request: ConnectorRequestView,
  ) => void;
  /** Close the drawer without submitting. */
  readonly onCancel: () => void;
}

/** The form's field state. */
interface FormState {
  readonly connectorId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly timeoutMs: string;
  readonly retries: string;
  readonly rateLimit: string;
  readonly mapping: string;
  readonly taxonomy: string;
}

const INITIAL_FORM: FormState = {
  connectorId: KNOWN_CONNECTOR_IDS[0],
  name: '',
  baseUrl: '',
  timeoutMs: '',
  retries: '',
  rateLimit: '',
  mapping: '',
  taxonomy: '',
};

/** A field-level validation failure, named inline (BLD-07). */
interface FormError {
  readonly field: string;
  readonly message: string;
}

/**
 * The request form drawer. Submits the D-99
 * definition minus the operator-held material.
 */
export function ConnectorRequestForm({
  appId,
  onSubmitted,
  onCancel,
}: ConnectorRequestFormProps): ReactElement {
  const client = useApiClient();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [error, setError] = useState<FormError | null>(null);
  const [submitError, setSubmitError] = useState<
    unknown | null
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const set = useCallback(
    (field: keyof FormState, value: string): void => {
      setForm((previous) => ({ ...previous, [field]: value }));
      setError(null);
    },
    [],
  );

  /**
   * The submitted body — the strict contract's
   * field set only (T-06-23). Optional policy
   * fields ride only when the requester set
   * them, and only when they parse.
   */
  const buildDefinition = useCallback((): {
    body: Record<string, unknown>;
    error: FormError | null;
  } => {
    if (form.connectorId.length === 0) {
      return {
        body: {},
        error: {
          field: 'connector_id',
          message: 'Pick the connector type.',
        },
      };
    }
    if (form.name.trim().length === 0) {
      return {
        body: {},
        error: {
          field: 'name',
          message: 'The connector needs a display name.',
        },
      };
    }
    if (form.baseUrl.trim().length === 0) {
      return {
        body: {},
        error: {
          field: 'base_url',
          message: 'The connector needs its base URL.',
        },
      };
    }

    const body: Record<string, unknown> = {
      connector_id: form.connectorId,
      name: form.name.trim(),
      base_url: form.baseUrl.trim(),
    };

    if (form.timeoutMs.length > 0) {
      const timeoutMs = Number(form.timeoutMs);
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        return {
          body: {},
          error: {
            field: 'timeout_ms',
            message:
              'The timeout is a whole number of milliseconds.',
          },
        };
      }
      body.timeout_ms = timeoutMs;
    }

    if (form.retries.length > 0) {
      const retries = Number(form.retries);
      if (!Number.isInteger(retries) || retries < 0) {
        return {
          body: {},
          error: {
            field: 'retries',
            message: 'The retry count is a whole number ≥ 0.',
          },
        };
      }
      body.retries = retries;
    }

    // The optional JSON policy fields — refused
    // inline when they do not parse, so no
    // invalid payload ever reaches the API.
    for (const [field, stateKey, contractKey] of [
      ['rate-limit', 'rateLimit', 'rate_limit'],
      ['mapping', 'mapping', 'mapping'],
      ['taxonomy', 'taxonomy', 'taxonomy'],
    ] as const) {
      const raw = form[stateKey];
      if (typeof raw === 'string' && raw.length > 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return {
            body: {},
            error: {
              field,
              message: `${field} needs valid JSON.`,
            },
          };
        }
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          return {
            body: {},
            error: {
              field,
              message: `${field} needs a JSON object.`,
            },
          };
        }
        body[contractKey] = parsed;
      }
    }

    return { body, error: null };
  }, [form]);

  const submit = useCallback(async (): Promise<void> => {
    setSubmitError(null);
    const { body, error: formError } = buildDefinition();
    if (formError !== null) {
      setError(formError);
      return;
    }
    setSubmitting(true);
    try {
      const created = await client.post(
        `/apps/${appId}/connector-requests`,
        body,
        ConnectorRequestViewSchema,
      );
      onSubmitted(created);
    } catch (postError) {
      setSubmitError(postError);
    } finally {
      setSubmitting(false);
    }
  }, [appId, buildDefinition, client, onSubmitted]);

  return (
    <aside
      className="drawer on"
      data-testid="connector-request-drawer"
      role="dialog"
      aria-label="New connector request"
    >
      <div className="drawer-head">
        <div className="od-fill">
          <h2>Request a connector</h2>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            The full connector definition minus
            the operator-held material — the
            platform operator fills the sealed
            material through the audited
            provision step.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="cancel-request-form"
          onClick={onCancel}
        >
          Close
        </button>
      </div>
      <div className="drawer-body">
        {submitError ? (
          <div style={{ marginBottom: 16 }}>
            <InlineError
              operation="submit the connector request"
              error={submitError}
              onRetry={() => void submit()}
            />
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Connector type
            </span>
            <select
              className="select"
              data-testid="request-field-connector-id"
              value={form.connectorId}
              onChange={(event) =>
                set('connectorId', event.target.value)
              }
            >
              {KNOWN_CONNECTOR_IDS.map((connectorId) => (
                <option
                  key={connectorId}
                  value={connectorId}
                >
                  {connectorId}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Display name
            </span>
            <input
              type="text"
              className="input"
              data-testid="request-field-name"
              value={form.name}
              placeholder="Redmine Issues"
              onChange={(event) =>
                set('name', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Base URL
            </span>
            <input
              type="url"
              className="input"
              data-testid="request-field-base-url"
              value={form.baseUrl}
              placeholder="https://redmine.example.com"
              onChange={(event) =>
                set('baseUrl', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Timeout (ms) <span className="helper">optional</span>
            </span>
            <input
              type="number"
              className="input"
              data-testid="request-field-timeout-ms"
              value={form.timeoutMs}
              placeholder="30000"
              min={1}
              max={600000}
              onChange={(event) =>
                set('timeoutMs', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Retries <span className="helper">optional</span>
            </span>
            <input
              type="number"
              className="input"
              data-testid="request-field-retries"
              value={form.retries}
              placeholder="3"
              min={0}
              max={10}
              onChange={(event) =>
                set('retries', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Rate limit <span className="helper">optional JSON</span>
            </span>
            <textarea
              className="textarea"
              data-testid="request-field-rate-limit"
              rows={2}
              value={form.rateLimit}
              placeholder='{"per_minute": 120}'
              onChange={(event) =>
                set('rateLimit', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Field mapping <span className="helper">optional JSON</span>
            </span>
            <textarea
              className="textarea"
              data-testid="request-field-mapping"
              rows={3}
              value={form.mapping}
              placeholder='{"issue_id": "external_id"}'
              onChange={(event) =>
                set('mapping', event.target.value)
              }
            />
          </label>
          <label className="field">
            <span className="lr-s" style={{ fontWeight: 600 }}>
              Taxonomy <span className="helper">optional JSON</span>
            </span>
            <textarea
              className="textarea"
              data-testid="request-field-taxonomy"
              rows={3}
              value={form.taxonomy}
              placeholder='{"severity": {"high": 1}}'
              onChange={(event) =>
                set('taxonomy', event.target.value)
              }
            />
          </label>
          {error !== null ? (
            <div
              role="alert"
              style={{
                border: '1px solid var(--red)',
                background: 'var(--red-soft)',
                borderRadius: 'var(--radius)',
                padding: '10px 14px',
                color: 'var(--red)',
                fontSize: 14,
              }}
            >
              {error.message}
            </div>
          ) : null}
        </div>
      </div>
      <div className="drawer-foot">
        <button
          type="button"
          className="btn"
          data-testid="cancel-request-drawer"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="submit-request"
          disabled={submitting}
          onClick={() => void submit()}
        >
          Submit request
        </button>
      </div>
    </aside>
  );
}
