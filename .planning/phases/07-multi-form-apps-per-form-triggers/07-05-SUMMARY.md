---
phase: 07-multi-form-apps-per-form-triggers
plan: 05
subsystem: ui
tags: [app-builder, spa, design-rulings, triggers, forms-manager]

# Dependency graph
requires:
  - phase: 07-multi-form-apps-per-form-triggers (07-UI-SPEC)
    provides: "Undepicted Surfaces U-1…U-6, Copywriting Contract, Component Inventory"
provides:
  - "Six recorded design rulings (U-1…U-6) that gate 07-06 (form manager) and 07-07 (trigger panel + config surfaces)"
affects: [07-multi-form-apps-per-form-triggers-06, 07-multi-form-apps-per-form-triggers-07]

# Actuals (#2632) — updated as rulings land; plan still in progress (1/6 rulings recorded)
actuals:
  tokens: 4800
  tasks: 1
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Design rulings recorded verbatim per surface (U-1…U-6) before implementation — AGENTS.md rule 3"

key-files:
  created:
    - ".planning/phases/07-multi-form-apps-per-form-triggers/07-05-SUMMARY.md"
  modified: []

key-decisions:
  - "U-1: inline-collapsible trigger panel under the form row; example phrases local-only (never persisted, sub-line omitted); disabled panel + note for show/edit kinds"

patterns-established:
  - "Undepicted-surface ruling pattern: mockup silence is confirmed by the user, never improvised (AGENTS.md rule 3)"

requirements-completed: []  # plan still executing; marked at final close-out

# Metrics
duration: in-progress
completed: pending
status: in-progress
---

# Phase 7 Plan 5: Undepicted-Surface Design Rulings Summary

**Six user rulings (U-1…U-6) gating the Phase-7 SPA surfaces the mockup does not depict — U-1 (in-form trigger panel) recorded; U-2…U-6 pending their checkpoints**

This SUMMARY is the design contract 07-06 and 07-07 cite in `read_first`. Each ruling is
recorded verbatim as received, under its own `U-n` heading. Later rulings are appended under
their headings; earlier rulings are never re-written or re-litigated.

## Rulings

### U-1 — in-form trigger panel placement, fields, and copy ✅ RECORDED

**Chosen option: `inline-collapsible`** (plan Task 1).

1. **Placement:** Inline collapsible panel under the form row in the manager, for every form
   kind; collapsed by default; reuses `list-row` / `field` / `empty` chrome; no new navigation.
2. **Example phrases: LOCAL-ONLY.** The wizard's example inputs are working state, discarded by
   `normalizeTriggers` (the persisted D-06/D-07 shape carries `{intents[], aliases[], threshold}`
   only). Panel intent rows render **without** the `Examples:` sub-line — the sub-line is
   omitted, never blank-filled.
3. **Disabled-state note (`show`/`edit` kinds):** the panel renders disabled with the note
   `This form opens from an existing link, so it has no trigger.`

**Locked context for consistency (binding on 07-06/07-07):**

- Persisted trigger shape stays `{intents[], aliases[], threshold}` (D-06/D-07); the panel saves
  through the same `forms`-section PATCH — BLD-03's section permission governs it (T-07-12).
- Panel is read-only/disabled for `show`/`edit` kinds (D-08).
- The mockup's two JEV switches ("Present alternatives when within 10% of top confidence",
  "Allow no-JEV deterministic mode for slash commands") are **omitted** — no contract field
  exists for them; the frozen contract beats the mockup (UI-SPEC constraint 2).
- All other copy is verbatim from the retired mockup `tabTriggers`:
  - Row titles: `Intent · {intent}` / `Slash command · {command}`
  - Slash sub-line: `Deterministic routing — bypasses JEV (no-JEV mode).`
  - Remove affordance: `icon-btn` with `aria-label="Remove trigger"`, no confirmation modal
  - Threshold input: `0`–`1`, step `0.05`, helper
    `Below threshold → clarification prompt or fall back to rule-based.`
  - JEV helper: `Only triggers for the requesting user are sent to the JEV decision engine. Intents match on example phrases; slash commands route deterministically.`
  - Empty state: `No triggers yet` / `Add an intent or slash command so users can launch this app from chat.`
  - CTA: `Add trigger`

### U-2 — `list`/`show` per-form designer config surfaces ⏳ PENDING

Awaiting Task 2 checkpoint (`checkpoint:decision`, gate `blocking-human`). To decide:
`checklist-picker` vs `table-editor`, plus the no-queries empty-state copy.

### U-3 — "New form" kind picker ⏳ PENDING

Awaiting Task 3 checkpoint (`checkpoint:decision`, gate `blocking`).

### U-4 — remove-form destructive confirm ⏳ PENDING

Awaiting Task 4 checkpoint (`checkpoint:decision`, gate `blocking`).

### U-5 — publish-gate SC#2 error copy and placement (+ long-copy wrap) ⏳ PENDING

Awaiting Task 5 checkpoint (`checkpoint:decision`, gate `blocking`).

### U-6 — kind-specific `forms[]` metadata in the manager row ⏳ PENDING

Awaiting Task 6 checkpoint (`checkpoint:decision`, gate `blocking`).

## Deviations from Plan

None — plan executed as written (rulings recorded one checkpoint at a time).

## Task Commits

1. **Task 1: U-1 — in-form trigger panel** — recorded in this SUMMARY (commit `docs(07-05): record U-1 ruling`)

## Next Phase Readiness

07-06/07-07 must not finalise any SPA surface for U-1…U-6 until the corresponding ruling above
is marked ✅ RECORDED. U-1 is now available to implement; U-2…U-6 remain gated.

---
*Phase: 07-multi-form-apps-per-form-triggers*
*Status: in progress — 1/6 rulings recorded*
