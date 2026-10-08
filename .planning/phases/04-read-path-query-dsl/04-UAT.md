---
phase: "04-read-path-query-dsl"
created: "2026-10-08"
status: "ready-for-verification"
---

# Phase 4 UAT Checklist

Phase Goal: A 90-day view or query link lets a user read their own data with no stored session, and dies the instant their permission changes.

## SC#1: View link works without session (LNK-05)
- [ ] View link opens in browser with no cookie set
- [ ] User sees only their own submission
- [ ] JWT verified with public key alone (LNK-05) - stateless
- [ ] FormIO renders in read-only mode (D-68)

## SC#2: Permission changes take effect; distinct denial reasons (LNK-06, LNK-08)
- [ ] Revoking permission makes existing link fail on next click
- [ ] Failure recorded with distinct reason (not aggregate)
- [ ] Reasons include: expired, consumed, revoked, wrong_app, wrong_version, deactivated_user, bad_signature
- [ ] LNK-08: per-reason denial counts recorded via OTel with reason label
- [ ] Dead link shows specific reason + "request a new one via IM" (D-70, LNK-11)

## SC#3: Auth filters correct (DAT-11, D-78, D-79)
- [ ] Manager with view_all sees whole team's records via query
- [ ] Regular user never sees another user's records
- [ ] Soft-deleted rows excluded for everyone
- [ ] Filter builder emits deleted_at:null always (even with view_all)
- [ ] Filter builder emits real_user_id only when !view_all
- [ ] View link enforces submission owned by sub (D-79)
- [ ] Auth injected at root via $and; cannot be bypassed (DAT-11)

## SC#4: Dual-key rotation (SC#4)
- [ ] Links signed by previous key remain valid during dual-key window
- [ ] Verifier accepts kid-based keys; backward compatible
- [ ] New key can be added without breaking existing links

## Query DSL & Versioning (DAT-10, DAT-11, DAT-12, D-75)
- [ ] JSON DSL → AST → Mongo; no raw Mongo exposed (DAT-10)
- [ ] Strict schema rejects unknown keys (DAT-10)
- [ ] Query link enforces query_version; wrong_version on mismatch (D-75)
- [ ] Each DSL construct preserves auth filters (DAT-12)
- [ ] limit max 100 enforced; offset>=0
- [ ] OR/AND groups don't bypass auth

## Query UI (D-69)
- [ ] Query results page shows server-paginated table
- [ ] Columns respect projection if specified
- [ ] Table has proper semantic HTML
- [ ] WCAG considerations addressed
- [ ] No cookies required

## Requirements Coverage
- [ ] LNK-05: Stateless JWT verify with public key ✓
- [ ] LNK-06: Fresh perm check + perm_version on every access ✓
- [ ] LNK-08: Per-reason denial counts (7 reasons) ✓
- [ ] DAT-10: DSL → AST → Mongo; raw Mongo never exposed ✓
- [ ] DAT-11: Inject real_user_id (unless view_all) + deleted_at:null always ✓
- [ ] DAT-12: One test per DSL construct asserting filters survive ✓
