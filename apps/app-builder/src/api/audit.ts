/**
 * The audit browse contract (AUD-01, D-43,
 * T-06-32).
 *
 * The served projection the Audit page and
 * the dashboard's recent-activity widget
 * render. The API projects entries through
 * the D-43 field allowlist **before**
 * serialization, and this structural schema
 * validates the same key set at the SPA
 * boundary — an unvalidated payload never
 * reaches a component (BLD-07's discipline,
 * the same shape `api/definition.ts`
 * enforces for the definition projection).
 *
 * The schema is structural (not a Zod
 * import) for the same reason the definition
 * schema is: the served shape is the
 * projection's own, and the SPA compiles
 * against it without a second frozen copy.
 */

/**
 * One served audit entry — the D-43
 * allowlist and nothing else. Optional
 * fields are present only when the append
 * carried them; `ip` and any non-allowlisted
 * key are unreachable by construction.
 */
export interface AuditEntryView {
  readonly timestamp: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly app_id?: string;
  readonly previous_state?: string;
  readonly new_state?: string;
  readonly ip?: string;
  readonly request_id?: string;
}

/** The browse response — the pager's entire state. */
export interface AuditBrowseResponse {
  readonly entries: readonly AuditEntryView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/** The served key set of one entry (the D-43 allowlist). */
const ENTRY_ALLOWLIST = new Set([
  'timestamp',
  'actor',
  'action',
  'target',
  'app_id',
  'previous_state',
  'new_state',
  'ip',
  'request_id',
]);

/**
 * The structural response schema. A malformed
 * payload throws at the boundary; an entry
 * carrying a key outside the allowlist is
 * refused here too — the projection is the
 * contract, and a server that leaks an
 * internal field fails the SPA's parse
 * rather than reaching a component.
 */
export const AuditBrowseSchema = {
  parse: (data: unknown): AuditBrowseResponse => {
    const payload = data as {
      entries?: unknown;
      total?: unknown;
      limit?: unknown;
      offset?: unknown;
    };
    if (!Array.isArray(payload.entries)) {
      throw new Error('malformed audit browse response');
    }
    if (
      typeof payload.total !== 'number' ||
      typeof payload.limit !== 'number' ||
      typeof payload.offset !== 'number'
    ) {
      throw new Error('malformed audit browse envelope');
    }
    const entries = payload.entries.map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new Error('malformed audit entry');
      }
      const record = entry as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (!ENTRY_ALLOWLIST.has(key)) {
          throw new Error(
            `audit entry carries a non-allowlisted field: ${key}`,
          );
        }
      }
      const {
        timestamp,
        actor,
        action,
        target,
        app_id,
        previous_state,
        new_state,
        ip,
        request_id,
      } = record;
      if (
        typeof timestamp !== 'string' ||
        typeof actor !== 'string' ||
        typeof action !== 'string' ||
        typeof target !== 'string'
      ) {
        throw new Error('malformed audit entry');
      }
      return {
        timestamp,
        actor,
        action,
        target,
        ...(typeof app_id === 'string' ? { app_id } : {}),
        ...(typeof previous_state === 'string'
          ? { previous_state }
          : {}),
        ...(typeof new_state === 'string' ? { new_state } : {}),
        ...(typeof ip === 'string' ? { ip } : {}),
        ...(typeof request_id === 'string'
          ? { request_id }
          : {}),
      } as AuditEntryView;
    });
    return {
      entries,
      total: payload.total,
      limit: payload.limit,
      offset: payload.offset,
    };
  },
};
