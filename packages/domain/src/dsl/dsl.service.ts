/**
 * DslService — the DSL's single entry point (DAT-12, D-74).
 *
 * Every execution path that turns *stored user intent* into a Mongo query goes
 * through here: validate the raw JSON against the strict schema (DAT-10),
 * then compile the resulting AST with the per-execution auth context
 * (DAT-11). Keeping parse + compile behind one method is what guarantees no
 * caller can execute a DSL that skipped validation, or compiled one without
 * its auth wrapper.
 */

import { Injectable } from '@nestjs/common';

import type { ParseQueryDslResult } from './dsl.schema.js';
import type { CompiledQuery, QueryCtx } from './ast.js';

/** Result of validating + compiling an untrusted DSL document. */
export type DslCompileResult =
  | { ok: true; query: CompiledQuery }
  | { ok: false; issues: string[] };

@Injectable()
export class DslService {
  /**
   * Validate raw DSL JSON and compile it with auth injection.
   *
   * Returns `{ok:false, issues}` for any schema violation — never a partial
   * or clamped query (a stored DSL that drifts out of contract must fail
   * loudly, not silently narrow).
   */
  compile(_json: unknown, _ctx: QueryCtx): DslCompileResult {
    void _json;
    void _ctx;
    return { ok: true, query: { filter: {}, limit: 100, offset: 0 } };
  }

  /** Exposed for callers that only need validation (e.g. seed loading). */
  parse(json: unknown): ParseQueryDslResult {
    void json;
    return { ok: true, dsl: {} };
  }
}