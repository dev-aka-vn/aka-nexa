---
phase: "04-read-path-query-dsl"
created: "2026-10-08"
status: "ready-for-verification"
---

# Phase 4 UAT Checklist

Phase Goal: A 90-day view or query link lets a user read their own data with no stored session, and dies the instant their permission changes.

## SC#1: View link works without session (LNK-05)

- [ ] **1.1** View link opens in browser with no cookie set
- [ ] **1.2** User sees only their own submission
- [ ] **1.3** JWT verified with public key alone (LNK-05) - stateless
- [ ] **1.4** FormIO renders in read-only mode (D-68)

## SC#2: Permission changes take effect; distinct denial reasons (LNK-06, LNK-08)

- [ ] **2.1** Revoking permission makes existing link fail on next click
- [ ] **2.2** Failure recorded with distinct reason (not aggregate)
- [ ] **2.3** Reasons include: expired, consumed, revoked, wrong_app, wrong_version, deactivated_user, bad_signature
- [ ] **2.4** LNK-08: per-reason denial counts recorded via OTel with reason label
- [ ] **2.5** Dead link shows specific reason + "request a new one via IM" (D-70, LNK-11)

## SC#3: Auth filters correct (DAT-11, D-78, D-79)

- [ ] **3.1** Manager with view_all sees whole team's records via query
- [ ] **3.2** Regular user never sees another user's records
- [ ] **3.3** Soft-deleted rows excluded for everyone
- [ ] **3.4** Filter builder emits deleted_at:null always (even with view_all)
- [ ] **3.5** Filter builder emits real_user_id only when !view_all
- [ ] **3.6** View link enforces submission owned by sub (D-79)
- [ ] **3.7** Auth injected at root via $and; cannot be bypassed (DAT-11)

## SC#4: Dual-key rotation (SC#4)

- [ ] **4.1** Links signed by previous key remain valid during dual-key window
- [ ] **4.2** Verifier accepts kid-based keys; backward compatible
- [ ] **4.3** New key can be added without breaking existing links

## Query DSL & Versioning (DAT-10, DAT-11, DAT-12, D-75)

- [ ] **5.1** JSON DSL → AST → Mongo; no raw Mongo exposed (DAT-10)
- [ ] **5.2** Strict schema rejects unknown keys (DAT-10)
- [ ] **5.3** Query link enforces query_version; wrong_version on mismatch (D-75)
- [ ] **5.4** Each DSL construct preserves auth filters (DAT-12)
- [ ] **5.5** limit max 100 enforced; offset>=0
- [ ] **5.6** OR/AND groups don't bypass auth

## Query UI (D-69)

- [ ] **6.1** Query results page shows server-paginated table
- [ ] **6.2** Columns respect projection if specified
- [ ] **6.3** Table has proper semantic HTML
- [ ] **6.4** WCAG considerations addressed
- [ ] **6.5** No cookies required

## Requirements Coverage

- [ ] **7.1** LNK-05: Stateless JWT verify with public key
- [ ] **7.2** LNK-06: Fresh perm check + perm_version on every access
- [ ] **7.3** LNK-08: Per-reason denial counts (7 reasons)
- [ ] **7.4** DAT-10: DSL → AST → Mongo; raw Mongo never exposed
- [ ] **7.5** DAT-11: Inject real_user_id (unless view_all) + deleted_at:null always
- [ ] **7.6** DAT-12: One test per DSL construct asserting filters survive

