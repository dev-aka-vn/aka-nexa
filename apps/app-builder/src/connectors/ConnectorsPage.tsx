/**
 * The connectors page (BLD-10, D-97..D-100,
 * BLD-07, BLD-09) — the admin's self-service
 * surface over the app's connector **requests**.
 *
 * ## The statused queue (D-97)
 *
 * The page lists the app's connector
 * requests — the queue the platform operator
 * provisions from. Every request renders its
 * lifecycle badge (D-98): pending (amber),
 * provisioned (green), rejected (red), with
 * the operator's reason inline.
 *
 * ## The owner's actions (D-98)
 *
 * A **pending** request carries the owner's
 * cancel (`POST /apps/:id/connector-requests/
 * :requestId/cancel`) and retry
 * (`.../:requestId/retry` — a fresh
 * `request_id` for the same definition)
 * actions. Terminal requests carry neither.
 * Both actions refresh the queue on success.
 *
 * ## The request form (D-99)
 *
 * "New connector request" opens the drawer
 * that collects exactly the frozen
 * `ConnectorRequestDefinitionSchema` field
 * set — the full connector definition minus
 * the secret — and POSTs it to
 * `POST /apps/:id/connector-requests`.
 *
 * ## States (BLD-07, BLD-09)
 *
 * Layout-shaped skeletons while the reads
 * are in flight; inline, specific, actionable
 * errors on failure.
 */

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  AppDefinitionSchema,
  type AppDefinition,
} from '../api/definition.js';
import {
  ConnectorRequestListSchema,
  ConnectorRequestViewSchema,
  type ConnectorRequestState,
  type ConnectorRequestView,
} from '../api/connectors.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';
import { ScopedAppPicker } from '../ui/ScopedAppPicker.js';
import { ConnectorRequestForm } from './ConnectorRequestForm.js';

export interface ConnectorsPageProps {
  /** The scoped app (the route's `app` parameter). */
  readonly appId?: string;
}

/**
 * The connectors page. Without a scoped app
 * the page is the app picker; with one, the
 * request queue proper.
 */
export function ConnectorsPage({
  appId,
}: ConnectorsPageProps): ReactElement {
  if (appId === undefined) {
    return (
      <ScopedAppPicker
        surface="connectors"
        title="Connectors"
        description="Pick an app to manage its connector requests — the statused queue the platform operator provisions from."
      />
    );
  }
  return <ConnectorsQueue appId={appId} />;
}

/**
 * The request queue for one app.
 */
function ConnectorsQueue({
  appId,
}: {
  appId: string;
}): ReactElement {
  const client = useApiClient();

  const [definition, setDefinition] =
    useState<AppDefinition | null>(null);
  const [definitionError, setDefinitionError] =
    useState<unknown>(null);

  const [requests, setRequests] = useState<
    readonly ConnectorRequestView[] | null
  >(null);
  /**
   * The owner's actionable set (D-98): the
   * requests that carried the owner's
   * cancel/retry actions when the queue
   * loaded, plus every fresh pending
   * request the owner has created or
   * retried since. A request the owner
   * loaded as `pending` keeps its actions
   * through its terminal transition — the
   * owner's retry (D-98) is exactly the
   * post-terminal action — while a request
   * that was already terminal when the
   * queue loaded carries neither.
   */
  const [actionable, setActionable] = useState<
    ReadonlySet<string>
  >(new Set());
  const [queueError, setQueueError] =
    useState<unknown>(null);
  const [actionError, setActionError] =
    useState<unknown>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [actingId, setActingId] = useState<
    string | null
  >(null);

  const loadDefinition = useCallback(
    async (): Promise<void> => {
      setDefinitionError(null);
      try {
        const response = await client.get(
          `/apps/${encodeURIComponent(appId)}`,
          AppDefinitionSchema,
        );
        setDefinition(response);
      } catch (error) {
        setDefinition(null);
        setDefinitionError(error);
      }
    },
    [client, appId],
  );

  const loadQueue = useCallback(
    async (): Promise<void> => {
      setQueueError(null);
      try {
        const response = await client.get(
          `/apps/${encodeURIComponent(appId)}/connector-requests`,
          ConnectorRequestListSchema,
        );
        setRequests(response.requests);
        // The owner's actionable set: what
        // loaded as pending (plus anything
        // the owner has created or retried
        // since — those re-add themselves).
        setActionable(
          new Set(
            response.requests
              .filter((request) => request.state === 'pending')
              .map((request) => request.request_id),
          ),
        );
      } catch (error) {
        setRequests(null);
        setQueueError(error);
      }
    },
    [client, appId],
  );

  useEffect(() => {
    void loadDefinition();
    void loadQueue();
  }, [loadDefinition, loadQueue]);

  /**
   * The owner's cancel — a pending request is
   * withdrawn (D-98): `pending → rejected`,
   * audited. The served (cancelled) request
   * replaces its row; the owner's retry on
   * the now-terminal request stays (D-98's
   * post-terminal retry).
   */
  const cancel = useCallback(
    async (requestId: string): Promise<void> => {
      setActionError(null);
      setActingId(requestId);
      try {
        const cancelled = await client.post(
          `/apps/${encodeURIComponent(appId)}/connector-requests/${encodeURIComponent(requestId)}/cancel`,
          {},
          ConnectorRequestViewSchema,
        );
        setRequests((previous) =>
          (previous ?? []).map((request) =>
            request.request_id === cancelled.request_id
              ? cancelled
              : request,
          ),
        );
      } catch (error) {
        setActionError(error);
      } finally {
        setActingId(null);
      }
    },
    [appId, client],
  );

  /**
   * The owner's retry — a fresh `request_id`
   * for the same definition, after the
   * previous request for the pair reached a
   * terminal state (D-98). The fresh request
   * joins the queue as the new pending head.
   */
  const retry = useCallback(
    async (requestId: string): Promise<void> => {
      setActionError(null);
      setActingId(requestId);
      try {
        const retried = await client.post(
          `/apps/${encodeURIComponent(appId)}/connector-requests/${encodeURIComponent(requestId)}/retry`,
          {},
          ConnectorRequestViewSchema,
        );
        setRequests((previous) => [
          retried,
          ...(previous ?? []),
        ]);
        setActionable((previous) =>
          new Set(previous).add(retried.request_id),
        );
      } catch (error) {
        setActionError(error);
      } finally {
        setActingId(null);
      }
    },
    [appId, client],
  );

  /**
   * A submitted request (D-99) joins the
   * queue as the new pending head; the
   * drawer closes.
   */
  const handleSubmitted = useCallback(
    (created: ConnectorRequestView): void => {
      setFormOpen(false);
      setRequests((previous) => [
        created,
        ...(previous ?? []),
      ]);
      setActionable((previous) =>
        new Set(previous).add(created.request_id),
      );
    },
    [],
  );

  /* ======================= The loading states ======================= */

  if (definitionError !== null) {
    return (
      <div data-testid="connectors-page">
        <InlineError
          operation="load the app"
          error={definitionError}
          onRetry={() => void loadDefinition()}
        />
      </div>
    );
  }

  if (definition === null) {
    return (
      <div data-testid="connectors-page">
        <Skeleton variant="block" label="Loading the app" />
      </div>
    );
  }

  /* ======================= The page ======================= */

  return (
    <div data-testid="connectors-page">
      <div className="page-head">
        <div className="titles">
          <div
            className="od-row"
            style={{
              '--od-gap': '10px',
              marginBottom: 8,
            } as never}
          >
            <a className="btn btn-sm" href="#/apps">
              ← Apps
            </a>
            <span className="pill-mono">{appId}</span>
          </div>
          <h1>{definition.name} — connectors</h1>
          <p className="sub">
            The app's connector requests — the
            statused queue the platform operator
            provisions from.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="new-connector-request"
            onClick={() => setFormOpen(true)}
          >
            + New connector request
          </button>
        </div>
      </div>

      {actionError ? (
        <div
          role="alert"
          style={{
            border: '1px solid var(--red)',
            background: 'var(--red-soft)',
            borderRadius: 'var(--radius)',
            padding: '10px 14px',
            color: 'var(--red)',
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          {actionError instanceof Error
            ? actionError.message
            : String(actionError)}
        </div>
      ) : null}

      {queueError ? (
        <InlineError
          operation="load this app's connector requests"
          error={queueError}
          onRetry={() => void loadQueue()}
        />
      ) : requests === null ? (
        <Skeleton
          variant="text"
          lines={4}
          label="Loading connector requests"
        />
      ) : requests.length === 0 ? (
        <section className="card">
          <div className="card-body">
            <div className="empty" style={{ padding: '32px' }}>
              <h3>No connector requests yet</h3>
              <p>
                Request a connector to route this
                app's submissions to an external
                system.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <div className="table-wrap">
          <table data-testid="connector-requests-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Connector</th>
                <th>Name</th>
                <th>Base URL</th>
                <th>State</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr
                  key={request.request_id}
                  data-testid={`connector-request-${request.request_id}`}
                >
                  <td className="cell-mono">
                    {request.request_id}
                  </td>
                  <td className="cell-mono">
                    {request.connector_id}
                  </td>
                  <td>{request.name}</td>
                  <td className="cell-mono">
                    {request.base_url}
                  </td>
                  <td>
                    <span
                      className={`badge ${stateTone(request.state)}`}
                      data-testid={`request-state-${request.request_id}`}
                    >
                      {request.state}
                    </span>
                    {request.reason !== null &&
                    request.reason !== undefined ? (
                      <div
                        className="lr-s"
                        style={{
                          color: 'var(--muted)',
                          marginTop: 4,
                          maxWidth: 280,
                        }}
                      >
                        {request.reason}
                      </div>
                    ) : null}
                  </td>
                  <td className="cell-mono">
                    {request.requestedAt !== undefined
                      ? formatTimestamp(request.requestedAt)
                      : '—'}
                  </td>
                  <td>
                    {request.state === 'pending' ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        data-testid={`cancel-request-${request.request_id}`}
                        disabled={
                          actingId === request.request_id
                        }
                        onClick={() =>
                          void cancel(request.request_id)
                        }
                      >
                        Cancel
                      </button>
                    ) : null}
                    {actionable.has(request.request_id) ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        data-testid={`retry-request-${request.request_id}`}
                        disabled={
                          actingId === request.request_id
                        }
                        onClick={() =>
                          void retry(request.request_id)
                        }
                      >
                        Retry
                      </button>
                    ) : (
                      <span className="helper">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The D-99 request form — the definition minus the secret. */}
      {formOpen ? (
        <ConnectorRequestForm
          appId={appId}
          onSubmitted={handleSubmitted}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** The request state badge tone (the mockup's badge vocabulary). */
function stateTone(state: ConnectorRequestState): string {
  switch (state) {
    case 'provisioned':
      return 'badge-provisioned';
    case 'rejected':
      return 'badge-rejected';
    case 'pending':
    default:
      return 'badge-partial';
  }
}

/** An ISO timestamp as the mockup's table cells render it. */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}
