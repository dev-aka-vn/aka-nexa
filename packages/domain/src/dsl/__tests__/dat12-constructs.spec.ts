/**
 * DAT-12: per-construct auth survival tests (D-72, D-74).
 *
 * One test per D-72 construct proving injected filters survive compilation
 * structurally - they sit at the root of the emitted filter, outside
 * whatever the user tree said.
 */
import { describe, expect, it } from "vitest";

import type { FilterExpr, QueryCtx } from "@akane/contract";

import { DslService } from "../dsl.service.js";

describe("DAT-12: per-construct auth survival", () => {
  const service = new DslService();
  const ctx: QueryCtx = { viewerId: "u_1", hasViewAll: false, appId: "app_1" };
  const OWNED_AUTH = { $and: [{ deleted_at: null }, { real_user_id: "u_1" }] };

  const CONSTRUCTS: Array<{ name: string; filters: FilterExpr; user: Record<string, unknown> }> = [
    { name: "eq", filters: { op: "eq", field: "status", value: "open" }, user: { status: "open" } },
    { name: "ne", filters: { op: "ne", field: "assignee", value: "u_2" }, user: { assignee: { $ne: "u_2" } } },
    { name: "in", filters: { op: "in", field: "priority", values: ["p1", "p2", null] }, user: { priority: { $in: ["p1", "p2", null] } } },
    { name: "gte", filters: { op: "gte", field: "created_at", value: 1700000000 }, user: { created_at: { $gte: 1700000000 } } },
    { name: "lte", filters: { op: "lte", field: "updated_at", value: 1800000000 }, user: { updated_at: { $lte: 1800000000 } } },
    { name: "contains", filters: { op: "contains", field: "title", value: "deploy" }, user: { title: { $regex: "deploy", $options: "i" } } },
    { name: "AND group", filters: { op: "and", filters: [{ op: "eq", field: "team", value: "platform" }, { op: "eq", field: "status", value: "open" }] }, user: { $and: [{ team: "platform" }, { status: "open" }] } },
    { name: "OR group", filters: { op: "or", filters: [{ op: "eq", field: "team", value: "platform" }, { op: "eq", field: "team", value: "runtime" }] }, user: { $or: [{ team: "platform" }, { team: "runtime" }] } },
  ];

  for (const { name, filters, user } of CONSTRUCTS) {
    it(`${name}: auth survives at the root, outside the user fragment`, () => {
      const result = service.compile({ filters }, ctx);
      expect(result.ok, result.ok ? "" : result.issues.join("; ")).toBe(true);
      if (!result.ok) return;
      const root = result.query.filter as { $and?: unknown[] };
      expect(root.$and?.[0]).toEqual(OWNED_AUTH);
      expect(root.$and?.[1]).toEqual(user);
      expect(JSON.stringify(root.$and?.[1])).not.toContain("deleted_at");
      expect(JSON.stringify(root.$and?.[1])).not.toContain("real_user_id");
    });
  }

  it("sort, limit and offset survive alongside auth", () => {
    const result = service.compile({ sort: [{ field: "created_at", dir: "desc" }], limit: 25, offset: 50 }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.sort).toEqual({ created_at: -1 });
    expect(result.query.limit).toBe(25);
    expect(result.query.offset).toBe(50);
    expect(result.query.filter).toEqual(OWNED_AUTH);
  });

  it("projection survives; filter is still auth-wrapped", () => {
    const result = service.compile({ projection: { status: 1, title: 1 } }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.projection).toEqual({ status: 1, title: 1 });
    expect(result.query.filter).toEqual(OWNED_AUTH);
  });

  it("view_all: deleted_at survives at root, real_user_id absent", () => {
    const viewAllCtx: QueryCtx = { viewerId: "u_1", hasViewAll: true, appId: "app_1" };
    const result = service.compile({
      filters: { op: "or", filters: [{ op: "eq", field: "team", value: "platform" }, { op: "eq", field: "team", value: "runtime" }] },
    }, viewAllCtx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const root = result.query.filter as { $and?: unknown[] };
    expect(root.$and?.[0]).toEqual({ deleted_at: null });
    expect(JSON.stringify(result.query.filter)).not.toContain("real_user_id");
  });

  it("unknown keys rejected before compilation", () => {
    const result = service.compile({ limit: 10, sneaky: "exfiltrate" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("sneaky");
  });

  it("limit above MAX_QUERY_LIMIT is rejected", () => {
    const result = service.compile({ limit: 101 }, ctx);
    expect(result.ok).toBe(false);
  });
});
