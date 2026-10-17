/**
 * The audit browse endpoint (AUD-01, D-43,
 * T-06-32) — the read-only Audit Log's
 * backend.
 *
 * ## Read-only by construction
 *
 * AUD-01 is an append-only log: the
 * {@link AuditRepository} exposes `append`
 * and reads, and **no update or delete
 * path exists anywhere** — so this
 * controller exposes exactly one route,
 * `GET /audit`, and no mutation endpoint
 * can be written against the store. The
 * read-only posture is structural, not a
 * convention.
 *
 * ## The global-admin gate (T-06-32)
 *
 * The session middleware has already
 * resolved `req.user` from the session
 * record, whose `role` is the ID token's
 * `role` claim. The browse surface is
 * global-admin territory: any other role —
 * including an app owner — gets the named
 * 403 `GLOBAL_ADMIN_REQUIRED` refusal, the
 * same named error the users surface
 * answers with (D-110).
 *
 * ## The field allowlist (D-43)
 *
 * Entries are projected through the
 * allowlist **before** serialization: a
 * served entry carries exactly `timestamp`,
 * `actor`, `action`, `target`, and the
 * optional `previous_state`, `new_state`,
 * `request_id`. The repository's `ip` field
 * and any non-allowlisted key an append
 * carried are unreachable in the response by
 * construction — the projection is the
 * single serialization path.
 *
 * ## Ordering and pagination
 *
 * The stream is sorted `timestamp`
 * descending (newest first — the ordering
 * both the Audit page's pager and the
 * dashboard's recent-activity widget read)
 * and sliced by `limit` (default 20, ceiling
 * 100) and `offset` (default 0). The
 * response echoes the applied parameters and
 * the total, so the pager is a pure
 * function of the response.
 */

import {
  Controller,
  Get,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';

import type { Request } from 'express';

import {
  AuditRepository,
  BuilderError,
  type AuditEntry,
} from '@akane/domain';

import { BuilderExceptionFilter } from '../app-builder/app-builder.controller.js';

/**
 * A non-global-admin session attempted the
 * browse surface — the named 403 refusal
 * (T-06-32). Rendered by the
 * {@link BuilderExceptionFilter} as
 * `{error: {code, message}}`.
 */
export class AuditForbiddenError extends BuilderError {
  constructor() {
    super(
      'GLOBAL_ADMIN_REQUIRED',
      'global-admin session required',
    );
  }
}

/** A pagination parameter that failed validation, naming the offending field. */
export class AuditValidationError extends BuilderError {
  constructor(field: string, constraint: string) {
    super(
      'AUDIT_VALIDATION',
      `invalid audit pagination field: ${field} (${constraint})`,
    );
  }
}

/** The default page size. */
export const AUDIT_DEFAULT_LIMIT = 20;

/** The page-size ceiling — a bounded read. */
export const AUDIT_MAX_LIMIT = 100;

/**
 * One served audit entry — the D-43
 * allowlist and nothing else. Optional
 * fields are present only when the append
 * carried them.
 */
export interface AuditEntryView {
  readonly timestamp: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly previous_state?: string;
  readonly new_state?: string;
  readonly request_id?: string;
}

/** The browse response — the pager's entire state. */
export interface AuditBrowseResponse {
  readonly entries: readonly AuditEntryView[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

@Controller('audit')
@UseFilters(new BuilderExceptionFilter())
export class AuditController {
  constructor(private readonly audit: AuditRepository) {}

  /**
   * `GET /audit?limit=&offset=` — the
   * global-admin's paginated browse of the
   * append-only AUD-01 log, newest first,
   * projected through the field allowlist.
   */
  @Get()
  async browse(
    @Query() query: unknown,
    @Req() req: Request,
  ): Promise<AuditBrowseResponse> {
    this.assertGlobalAdmin(req);
    const { limit, offset } = this.parsePagination(
      query,
    );

    const all = await this.audit.findAll();
    // Newest first — the ordering every
    // recent-activity surface reads.
    const newestFirst = [...all].sort(
      (left, right) =>
        right.timestamp.getTime() -
        left.timestamp.getTime(),
    );

    return {
      entries: newestFirst
        .slice(offset, offset + limit)
        .map(toAuditEntryView),
      total: newestFirst.length,
      limit,
      offset,
    };
  }

  /**
   * The global-admin gate (T-06-32). The
   * role assertion is here, at the surface
   * the session middleware authenticates —
   * a missing principal is a non-admin, not
   * a pass.
   */
  private assertGlobalAdmin(req: Request): void {
    const user = (
      req as Request & {
        user?: { role?: string };
      }
    ).user;
    if (user?.role !== 'global-admin') {
      throw new AuditForbiddenError();
    }
  }

  /** Parse and validate the pagination set, naming the offending field. */
  private parsePagination(
    query: unknown,
  ): { limit: number; offset: number } {
    const raw = (query ?? {}) as {
      limit?: unknown;
      offset?: unknown;
    };

    let limit = AUDIT_DEFAULT_LIMIT;
    if (raw.limit !== undefined) {
      const parsed = Number(raw.limit);
      if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > AUDIT_MAX_LIMIT
      ) {
        throw new AuditValidationError(
          'limit',
          `expected an integer 1..${AUDIT_MAX_LIMIT}`,
        );
      }
      limit = parsed;
    }

    let offset = 0;
    if (raw.offset !== undefined) {
      const parsed = Number(raw.offset);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new AuditValidationError(
          'offset',
          'expected an integer >= 0',
        );
      }
      offset = parsed;
    }

    return { limit, offset };
  }
}

/**
 * The D-43 projection: exactly the allowlisted
 * fields, in their wire form. `ip` and every
 * non-allowlisted key the append carried are
 * dropped here — before serialization.
 */
function toAuditEntryView(
  entry: AuditEntry,
): AuditEntryView {
  return {
    timestamp:
      entry.timestamp instanceof Date
        ? entry.timestamp.toISOString()
        : new Date(entry.timestamp).toISOString(),
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    ...(entry.previous_state !== undefined
      ? { previous_state: entry.previous_state }
      : {}),
    ...(entry.new_state !== undefined
      ? { new_state: entry.new_state }
      : {}),
    ...(entry.request_id !== undefined
      ? { request_id: entry.request_id }
      : {}),
  };
}
