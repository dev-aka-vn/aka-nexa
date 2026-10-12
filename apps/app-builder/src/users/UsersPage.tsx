/**
 * The user management page (IDN-08,
 * D-110, ACL-05, ACL-10, D-109).
 *
 * Two governance surfaces, both owned by
 * the **global admin**:
 *
 *  - **SSO identity mapping** (IDN-08,
 *    D-110): search the OIDC-subject →
 *    `real_user_id` mappings by email, and
 *    create the mapping the platform's
 *    identity model is built on.
 *  - **The transfer approval queue**
 *    (ACL-05, ACL-10): the ownership
 *    transfers app owners have requested.
 *    The owner requests, never executes —
 *    only a global admin resolves one
 *    (the service guards again behind the
 *    route, defense in depth).
 *
 * Both surfaces are **global-admin only**.
 * The session contract carries no role, so
 * the gate is the server's: the page
 * renders both sections and surfaces the
 * named 403 refusal inline (BLD-07),
 * verbatim — never a generic error.
 */

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { ReactElement } from 'react';

import {
  ApiError,
} from '../api/client.js';
import {
  SsoMappingCreateResponseSchema,
  SsoMappingListSchema,
  type SsoMappingView,
} from '../api/users.js';
import {
  TransferApprovalQueueSchema,
  TransferRequestViewSchema,
  type TransferRequestView,
} from '../api/transfer.js';
import { useApiClient } from '../apiHooks.js';
import { InlineError } from '../error/InlineError.js';
import { Skeleton } from '../ui/Skeleton.js';

/**
 * The named global-admin refusal, from
 * either error shape the API serves: the
 * transfer surface's `{error: {code:
 * 'GLOBAL_ADMIN_REQUIRED', …}}` and the
 * identity surface's `{error:
 * 'GLOBAL_ADMIN_REQUIRED'}` (a bare
 * string, so the client can only name it
 * by its status).
 */
function isGlobalAdminRefusal(
  error: unknown,
): boolean {
  return (
    error instanceof ApiError &&
    (error.code === 'GLOBAL_ADMIN_REQUIRED' ||
      error.status === 403)
  );
}

/** The global-admin refusal, inline (BLD-07). */
function GlobalAdminRequiredNotice({
  surface,
}: {
  readonly surface: string;
}): ReactElement {
  return (
    <div
      className="callout callout-warn"
      role="alert"
      data-testid={`${surface}-admin-required`}
    >
      <div>
        <b>Global-admin session required.</b>{' '}
        {surface} is a platform-governance
        surface — sign in with a global-admin
        session to use it.
      </div>
    </div>
  );
}

/** The transfer-state badge tone. */
function transferStateTone(state: string): string {
  switch (state) {
    case 'pending':
      return 'badge-partial';
    case 'approved':
      return 'badge-provisioned';
    case 'rejected':
      return 'badge-rejected';
    default:
      return 'badge-neutral';
  }
}

/**
 * The SSO identity-mapping section
 * (IDN-08, D-110): the email search and
 * the create form, over the OIDC-subject
 * → `real_user_id` table.
 */
function SsoMappingSection(): ReactElement {
  const client = useApiClient();
  const [email, setEmail] = useState('');
  const [mappings, setMappings] = useState<
    readonly SsoMappingView[] | null
  >(null);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<
    unknown | null
  >(null);
  const [searching, setSearching] =
    useState(false);
  const [oidcSub, setOidcSub] = useState('');
  const [realUserId, setRealUserId] =
    useState('');
  const [fieldError, setFieldError] =
    useState<string | null>(null);
  const [submitError, setSubmitError] =
    useState<unknown | null>(null);
  const [submitting, setSubmitting] =
    useState(false);

  const search = useCallback(
    async (): Promise<void> => {
      setSearchError(null);
      if (email.trim().length === 0) {
        setSearchError(new Error(
          'Enter an email to search the identity mappings.',
        ));
        return;
      }
      setSearching(true);
      try {
        const list = await client.get(
          `/users/sso-mappings?email=${encodeURIComponent(
            email.trim(),
          )}`,
          SsoMappingListSchema,
        );
        setMappings(list);
        setSearched(true);
      } catch (loadError) {
        setMappings(null);
        setSearchError(loadError);
        setSearched(true);
      } finally {
        setSearching(false);
      }
    },
    [client, email],
  );

  /**
   * The create — the platform's identity
   * seam. Both fields are validated inline
   * before the POST fires (BLD-07); the
   * created mapping joins the search
   * results so the change is visible
   * immediately.
   */
  const createMapping = useCallback(
    async (): Promise<void> => {
      setSubmitError(null);
      setFieldError(null);
      if (
        oidcSub.trim().length === 0 ||
        realUserId.trim().length === 0
      ) {
        setFieldError(
          'Both the OIDC subject and the real user ID are required.',
        );
        return;
      }
      setSubmitting(true);
      try {
        const created = await client.post(
          '/users/sso-mappings',
          {
            oidcSub: oidcSub.trim(),
            realUserId: realUserId.trim(),
          },
          SsoMappingCreateResponseSchema,
        );
        setOidcSub('');
        setRealUserId('');
        setMappings((previous) =>
          previous === null
            ? [created]
            : [created, ...previous],
        );
      } catch (postError) {
        setSubmitError(postError);
      } finally {
        setSubmitting(false);
      }
    },
    [client, oidcSub, realUserId],
  );

  return (
    <section
      className="card"
      data-testid="sso-mapping-section"
    >
      <div className="card-head">
        <div className="od-fill">
          <h2>SSO identity mapping</h2>
          <p
            className="sub"
            style={{ margin: '4px 0 0' }}
          >
            The OIDC-subject → real-user
            mappings the platform's identity
            model is built on (IDN-08).
          </p>
        </div>
        <span className="pill-mono">
          platform · oidc
        </span>
      </div>
      <div className="card-body">
        <div
          className="toolbar"
          style={{ marginBottom: 14 }}
        >
          <div
            className="search"
            style={{ width: 320 }}
          >
            <label className="sr" htmlFor="sso-email">
              Filter identity mappings by email
            </label>
            <input
              id="sso-email"
              className="input"
              type="search"
              placeholder="Search by email…"
              value={email}
              data-testid="sso-email-input"
              onChange={(event) =>
                setEmail(event.target.value)
              }
            />
          </div>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="sso-search-button"
            disabled={searching}
            onClick={() => void search()}
          >
            Search
          </button>
        </div>
        {isGlobalAdminRefusal(searchError) ? (
          <GlobalAdminRequiredNotice surface="SSO identity mapping" />
        ) : searchError ? (
          <InlineError
            operation="search the identity mappings"
            error={searchError}
            onRetry={() => void search()}
          />
        ) : mappings === null && !searched ? (
          <div className="card">
            <div className="empty">
              <h3>Search identity mappings</h3>
              <p>
                Enter the email the identity is
                mapped to — or map a new OIDC
                subject below.
              </p>
            </div>
          </div>
        ) : mappings === null ? (
          <Skeleton
            variant="text"
            lines={2}
            label="Searching identity mappings"
          />
        ) : (
          <div className="table-wrap">
            <table
              style={{ minWidth: 760 }}
              data-testid="sso-table"
            >
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>OIDC subject</th>
                  <th>Real user</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping, index) => (
                  <tr
                    key={`${mapping.oidc_sub}-${index}`}
                    data-testid={`sso-row-${index}`}
                  >
                    <td>
                      <span className="pill-mono">
                        {mapping.platform}
                      </span>
                    </td>
                    <td className="cell-mono">
                      {mapping.oidc_sub}
                    </td>
                    <td className="cell-mono cell-strong">
                      {mapping.real_user_id}
                    </td>
                    <td>{mapping.email ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mappings.length === 0 ? (
              <div className="card">
                <div className="empty">
                  <h3>No mappings match</h3>
                  <p>
                    No identity is mapped to that
                    email yet — map one below.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        )}
        <div
          className="od-row-top"
          style={{
            '--od-gap': '14px',
            marginTop: 22,
          } as never}
        >
          <div className="od-fill">
            <div className="field-row">
              <label className="field">
                <span
                  className="lr-s"
                  style={{ fontWeight: 600 }}
                >
                  OIDC subject
                </span>
                <input
                  type="text"
                  className="input"
                  data-testid="sso-oidc-sub-input"
                  value={oidcSub}
                  placeholder="sub-…"
                  onChange={(event) =>
                    setOidcSub(event.target.value)
                  }
                />
              </label>
              <label className="field">
                <span
                  className="lr-s"
                  style={{ fontWeight: 600 }}
                >
                  Real user ID
                </span>
                <input
                  type="text"
                  className="input"
                  data-testid="sso-real-user-id-input"
                  value={realUserId}
                  placeholder="user-0001"
                  onChange={(event) =>
                    setRealUserId(event.target.value)
                  }
                />
              </label>
            </div>
            {fieldError !== null ? (
              <div
                role="alert"
                style={{
                  border: '1px solid var(--red)',
                  background: 'var(--red-soft)',
                  borderRadius: 'var(--radius)',
                  padding: '10px 14px',
                  color: 'var(--red)',
                  fontSize: 14,
                  marginTop: 10,
                }}
              >
                {fieldError}
              </div>
            ) : null}
            {isGlobalAdminRefusal(submitError) ? (
              <div style={{ marginTop: 10 }}>
                <GlobalAdminRequiredNotice surface="SSO identity mapping" />
              </div>
            ) : submitError ? (
              <div style={{ marginTop: 10 }}>
                <InlineError
                  operation="map the identity"
                  error={submitError}
                  onRetry={() =>
                    void createMapping()
                  }
                />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="sso-map-button"
            disabled={submitting}
            onClick={() => void createMapping()}
          >
            Map user
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * The transfer approval queue (ACL-05,
 * ACL-10): every pending ownership
 * transfer, newest first, which only a
 * global admin may resolve.
 */
function TransferApprovalSection(): ReactElement {
  const client = useApiClient();
  const [queue, setQueue] = useState<
    readonly TransferRequestView[] | null
  >(null);
  const [error, setError] = useState<
    unknown | null
  >(null);
  const [actionError, setActionError] = useState<
    unknown | null
  >(null);
  const [actingId, setActingId] = useState<
    string | null
  >(null);

  const load = useCallback(
    async (): Promise<void> => {
      setError(null);
      setQueue(null);
      try {
        const response = await client.get(
          '/transfer-approvals',
          TransferApprovalQueueSchema,
        );
        setQueue(response.transfers);
      } catch (loadError) {
        setQueue(null);
        setError(loadError);
      }
    },
    [client],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The approval or rejection: the record
   * resolves, ownership moves on approval,
   * and the queue reloads so the row leaves
   * the pending set.
   */
  const act = useCallback(
    async (
      transferId: string,
      action: 'approve' | 'reject',
    ): Promise<void> => {
      setActionError(null);
      setActingId(transferId);
      try {
        await client.post(
          `/transfer-approvals/${transferId}/${action}`,
          undefined,
          TransferRequestViewSchema,
        );
        await load();
      } catch (actError) {
        setActionError(actError);
      } finally {
        setActingId(null);
      }
    },
    [client, load],
  );

  return (
    <section
      className="card"
      data-testid="transfer-approval-section"
    >
      <div className="card-head">
        <div className="od-fill">
          <h2>Ownership transfer approvals</h2>
          <p
            className="sub"
            style={{ margin: '4px 0 0' }}
          >
            App owners request, a global admin
            resolves — the requested ownership
            transfer, its 7-day TTL, and its
            audit trail (ACL-05, ACL-10).
          </p>
        </div>
        <span className="pill-mono">
          global-admin only
        </span>
      </div>
      <div className="card-body">
        {isGlobalAdminRefusal(error) ? (
          <GlobalAdminRequiredNotice surface="the transfer approval queue" />
        ) : error ? (
          <InlineError
            operation="load the transfer approval queue"
            error={error}
            onRetry={() => void load()}
          />
        ) : queue === null ? (
          <Skeleton
            variant="text"
            lines={3}
            label="Loading transfer approvals"
          />
        ) : (
          <>
            {actionError !== null ? (
              <div style={{ marginBottom: 14 }}>
                <InlineError
                  operation="resolve the transfer"
                  error={actionError}
                />
              </div>
            ) : null}
            <div className="table-wrap">
              <table
                style={{ minWidth: 980 }}
                data-testid="transfer-table"
              >
                <thead>
                  <tr>
                    <th>App</th>
                    <th>Transfer</th>
                    <th>Requested</th>
                    <th>Expires</th>
                    <th>State</th>
                    <th>Resolve</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((request) => (
                    <tr
                      key={request.transfer_id}
                      data-testid={`transfer-row-${request.transfer_id}`}
                    >
                      <td className="cell-mono">
                        {request.app_id}
                      </td>
                      <td className="cell-mono od-nowrap">
                        {request.from_user_id}
                        {' → '}
                        {request.to_user_id}
                      </td>
                      <td className="cell-mono od-nowrap">
                        {request.requestedAt}
                      </td>
                      <td className="cell-mono od-nowrap">
                        {request.expiresAt}
                      </td>
                      <td>
                        <span
                          className={`badge ${transferStateTone(
                            request.state,
                          )}`}
                        >
                          {request.state}
                        </span>
                      </td>
                      <td>
                        <div
                          className="od-cluster"
                          style={{
                            '--od-gap': '6px',
                          } as never}
                        >
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            data-testid={`transfer-approve-${request.transfer_id}`}
                            disabled={actingId !== null}
                            onClick={() =>
                              void act(
                                request.transfer_id,
                                'approve',
                              )
                            }
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            data-testid={`transfer-reject-${request.transfer_id}`}
                            disabled={actingId !== null}
                            onClick={() =>
                              void act(
                                request.transfer_id,
                                'reject',
                              )
                            }
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {queue.length === 0 ? (
                <div className="card">
                  <div className="empty">
                    <h3>No pending transfers</h3>
                    <p>
                      Ownership transfers owners
                      request land here for
                      approval.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The user management page (`#/users`):
 * the SSO identity-mapping surface and the
 * transfer approval queue, stacked.
 */
export function UsersPage(): ReactElement {
  return (
    <div data-testid="users-page">
      <div className="page-head">
        <div className="titles">
          <h1>User Management</h1>
          <p className="sub">
            Identity mappings between chat
            accounts and canonical real users,
            and the ownership-transfer queue.
          </p>
        </div>
        <div className="page-actions">
          <span className="pill-mono">
            global-admin surfaces
          </span>
        </div>
      </div>
      <div
        className="od-stack"
        style={{ '--od-gap': '18px' } as never}
      >
        <SsoMappingSection />
        <TransferApprovalSection />
      </div>
    </div>
  );
}
