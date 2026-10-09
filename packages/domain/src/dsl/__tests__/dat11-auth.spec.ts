/**
 * DAT-11: auth invariant tests (D-74, D-78).
 *
 * Tests the authorization filter builder and its invariants:
 * - view_all true -> auth is exactly {deleted_at: null}
 * - view_all false -> has both deleted_at and real_user_id
 * - OR group doesn't bypass auth
 * - Unknown keys rejected
 * - limit > MAX_QUERY_LIMIT rejected
 */
import { describe, expect, it } from "vitest";

import { MAX_QUERY_LIMIT } from "@akane/contract";

import type { QueryCtx } from "../ast.js";
import { DslService } from "../dsl.service.js";
import { buildAuthFilter } from "../filter-builder.js";
import { parseQueryDsl } from "../dsl.schema.js";
import { compileQuery } from "../compiler.js";

describe("DAT-11: auth filter invariants", () => {
  const viewerId = "u_1";
  const ctx: QueryCtx = { viewerId, hasViewAll: false, appId: "app_1" };
  const viewAllCtx: QueryCtx = { viewerId, hasViewAll: true, appId: "app_1" };

  it("always injects deleted_at: null - with and without view_all (D-78)", () => {
    expect(buildAuthFilter(viewerId, false)).toEqual({
      $and: [{ deleted_at: null }, { real_user_id: viewerId }],
    });
    expect(buildAuthFilter(viewerId, true)).toEqual({ deleted_at: null });
  });

  it("view_all bypasses real_user_id only - auth equals {deleted_at:null}", () => {
    const auth = buildAuthFilter(viewerId, true);
    expect(auth).toEqual({ deleted_at: null });
    expect(JSON.stringify(auth)).not.toContain("real_user_id");
  });

  it("without view_all both constraints are present structurally", () => {
    const auth = buildAuthFilter(viewerId, false) as { $and: unknown[] };
    expect(Array.isArray(auth.$and)).toBe(true);
    expect(auth.$and).toEqual([{ deleted_at: null }, { real_user_id: viewerId }]);
  });

  it("ANDs auth with user filter at the root (D-74)", () => {
    const compiled = compileQuery(
      { filters: { op: "eq", field: "status", value: "open" } },
      ctx,
    );
    expect(compiled.filter).toEqual({
      $and: [
        { $and: [{ deleted_at: null }, { real_user_id: viewerId }] },
        { status: "open" },
      ],
    });
  });

  it("a top-level OR is a sibling of auth, never a replacement (D-74)", () => {
    const compiled = compileQuery(
      {
        filters: {
          op: "or",
          filters: [
            { op: "eq", field: "team", value: "platform" },
            { op: "eq", field: "team", value: "runtime" },
          ],
        },
      },
      ctx,
    );
    const root = (compiled.filter as { $and?: unknown[] }).$and;
    expect(Array.isArray(root)).toBe(true);
    expect(root?.[0]).toEqual({
      $and: [{ deleted_at: null }, { real_user_id: viewerId }],
    });
    expect(root?.[1]).toEqual({
      $or: [{ team: "platform" }, { team: "runtime" }],
    });
    expect(JSON.stringify(root?.[1])).not.toContain("deleted_at");
  });

  it("view_all still gets deleted_at at root when user filter exists", () => {
    const compiled = compileQuery(
      { filters: { op: "eq", field: "status", value: "open" } },
      viewAllCtx,
    );
    expect(compiled.filter).toEqual({
      $and: [{ deleted_at: null }, { status: "open" }],
    });
    expect(JSON.stringify(compiled.filter)).not.toContain("real_user_id");
  });

  it("with no user filter the emitted filter IS auth verbatim", () => {
    expect(compileQuery({}, ctx).filter).toEqual({
      $and: [{ deleted_at: null }, { real_user_id: viewerId }],
    });
    expect(compileQuery({}, viewAllCtx).filter).toEqual({ deleted_at: null });
  });

  it("OR group does not bypass auth - auth wraps at root", () => {
    const service = new DslService();
    const result = service.compile(
      {
        filters: {
          op: "or",
          filters: [
            { op: "eq", field: "team", value: "platform" },
            { op: "eq", field: "team", value: "runtime" },
          ],
        },
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.query.filter as { $and?: unknown[] };
    expect(root.$and?.[0]).toEqual({
      $and: [{ deleted_at: null }, { real_user_id: viewerId }],
    });
    expect(JSON.stringify(root.$and?.[1])).not.toContain("deleted_at");
    expect(JSON.stringify(root.$and?.[1])).not.toContain("real_user_id");
  });

  it("unknown keys are rejected before compilation", () => {
    const result = parseQueryDsl({ limit: 10, sneaky: "exfiltrate" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("sneaky");
  });

  it("limit above MAX_QUERY_LIMIT is rejected", () => {
    const result = parseQueryDsl({ limit: MAX_QUERY_LIMIT + 1 });
    expect(result.ok).toBe(false);
  });

  it("limit at MAX_QUERY_LIMIT is accepted", () => {
    const result = parseQueryDsl({ limit: MAX_QUERY_LIMIT });
    expect(result.ok).toBe(true);
  });
});
