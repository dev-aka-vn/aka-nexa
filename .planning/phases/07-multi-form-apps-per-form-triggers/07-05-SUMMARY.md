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

# Actuals (#2632) — updated as rulings land; plan still in progress (4/6 rulings recorded)
actuals:
  tokens: 9400
  tasks: 4
  commits: 7

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
  - "U-2: checklist-picker surfaces — show = ordered checklist over submit keys ({fields[]}); list = query reference picker + column multiselect ({query_id, columns[]}); up/down ordering (dragula submit-only); empty state 'No saved queries'"
  - "U-3: radio-card-picker kind chooser for New form — only unclaimed kinds shown (claimed kinds omitted uniformly, submit never addable twice); per-kind .rc-d descriptions carry the guidance; standalone helper line omitted"
  - "U-4: modal-block-last-submit — remove affordance on the form-manager row; removing the app's only submit form is BLOCKED in the modal by a callout-warn (confirm disabled); kind-aware modal body copy (with-trigger vs show/edit variant); submissions always keep their data"

patterns-established:
  - "Undepicted-surface ruling pattern: mockup silence is confirmed by the user, never improvised (AGENTS.md rule 3)"

requirements-completed: []  # plan still executing; marked at final close-out

# Metrics
duration: in-progress
completed: pending
status: in-progress
---

# Phase 7 Plan 5: Undepicted-Surface Design Rulings Summary

**Six user rulings (U-1…U-6) gating the Phase-7 SPA surfaces the mockup does not depict — U-1 (in-form trigger panel), U-2 (`list`/`show` config surfaces), U-3 (New-form `radio-card` kind picker with per-kind descriptions), and U-4 (`modal-block-last-submit` remove-form confirm with kind-aware copy) recorded; U-5…U-6 pending their checkpoints**

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

### U-2 — `list`/`show` per-form designer config surfaces ✅ RECORDED

**Chosen option: `checklist-picker`** (plan Task 2). User ruling verbatim:

1. Surfaces: `checklist-picker` — `show`: checklist + up/down ordering of the submit schema's
   keys (ordered subset, min 1). `list`: query reference picker (only queries resolvable for
   this app — Phase-4 seeds; today only `leave-request` has any) + column multiselect from the
   chosen query (min 1). Maps 1:1 onto the frozen payloads `show.config = { fields[] }` and
   `list.config = { query_id, columns[] }`. Neither is drag-and-drop; FormIO canvas does not
   apply. Reuse `field`/`input`/`select`/`helper` chrome; BLD-07 validation errors render
   inline per field. Ordering via up/down buttons (dragula stays submit-only).
2. Empty state (app has no resolvable saved queries, author opens a `list` config): title
   `No saved queries`, body `Saved queries for this app appear here once they exist. A
   `list` form needs one.` — exactly this copy, sanctioned empty-state pattern.

**Locked context for consistency (binding on 07-06/07-07):**

- Config payloads stay inside the frozen contract: `show.config = { fields[] }` (ordered
  subset of the submit schema's keys, min 1), `list.config = { query_id, columns[] }`
  (`columns[]` min 1, drawn from the chosen query).
- The query picker lists ONLY queries resolvable for this app (Phase-4 saved-query seeds,
  keyed `(app_id, query_id)`); no saved-query authoring surface is built this phase (the
  deferred idea stays deferred).
- No FormIO/drag-and-drop on either surface — dragula stays submit-schema-only; `show`
  ordering uses up/down buttons.
- BLD-07 validation errors render inline per field (existing `error-text` / `.invalid`
  chrome).
- Empty-state copy (no resolvable saved queries, author opens a `list` config) is EXACTLY:
  title `No saved queries`, body `Saved queries for this app appear here once they exist. A
  `list` form needs one.`

### U-3 — "New form" kind picker ✅ RECORDED

**Chosen option: `radio-card-picker`** (plan Task 3). User ruling verbatim:

1. **Picker:** `radio-card-picker` — the "New form" flow opens a `radio-card` kind picker
   (chrome `.rc-t`/`.rc-d`, the mockup Data-routing mode picker pattern). It offers ONLY
   unclaimed kinds (D-02: at most one form per kind; kinds already taken are omitted entirely —
   `submit` is never addable twice). When `submit` has NOT yet been added, it appears as a normal
   choice card; the disabled+selected-card explainer variant is therefore not needed for
   submit-already-exists — in that state `submit` is simply omitted like any claimed kind, and
   the picker lists the remaining unclaimed kinds. (Ruling note: the disabled-selected submit
   card concept from the option description applies only if you elect to still show submit when
   claimed; per this ruling, claimed kinds are omitted uniformly.)
2. **Per-kind descriptions (new copy, confirmed verbatim):**
   - `submit` → `A form users fill in from chat. Required before an app can be published.`
   - `list` → `Lists this app's submissions from a saved query.`
   - `show` → `Opens one submission read-only, from a link.`
   - `edit` → `Opens one submission for editing, from a link.`
3. **Helper line under the picker: OMITTED** — under `radio-card-picker` the per-kind
   descriptions carry the guidance; the standalone helper
   `Every app needs a submit form before it can be published.` is not rendered (redundant).

**Locked context for consistency (binding on 07-06/07-07):**

- The picker reuses the shipped `radio-card` / `.rc-t` (14px 600 title) / `.rc-d` (12.5px muted
  description) chrome (mockup L283-288, `chrome.css` L230-235 — mockup Data-routing-mode picker
  pattern, `mockup.html` L1199-1200).
- Only unclaimed kinds render; a claimed kind (D-02: one form per kind) is omitted entirely —
  no disabled card, no explainer variant. `submit` is never addable twice (D-02/D-05).
- The four `.rc-d` descriptions above are NEW copy (not in the mockup) — verbatim as ruled; any
  other phrasing is a defect.
- The standalone helper `Every app needs a submit form before it can be published.` is NOT
  rendered anywhere in the New-form flow — the submit card's description carries it.
- The four kind labels use the domain kind names `submit`/`list`/`show`/`edit` (D-01 bijection
  to wire actions; kind side is canonical in the picker copy).

### U-4 — remove-form destructive confirm ✅ RECORDED

**Chosen option: `modal-block-last-submit`** (plan Task 4). User ruling verbatim:

1. **Policy:** `modal-block-last-submit` — form removal is offered from the form-manager row;
   removing the LAST `submit` form is BLOCKED in the confirm modal, replaced by a
   `callout-warn`. (Removing any non-last form proceeds through the modal confirm.)
2. **Copy (confirmed as proposed):**
   - **Modal body (kinds WITH a trigger, i.e. submit/list):**
     `Remove "‹form label›"? This removes the form and its trigger. Submissions already created through it keep their data. This can't be undone from here.`
   - **Kind-aware variant for show/edit (no trigger, D-08/U-1):**
     `Remove "‹form label›"? This removes the form. Submissions already created through it keep their data. This can't be undone from here.`
   - **Remove affordance:** `icon-btn` with `aria-label="Remove form"`, `i-trash` icon, on the
     form-manager row; modal footer = ghost Cancel + `btn-danger` `Remove form` (chrome:
     `.modal`/`.modal-head/body/foot` + `.scrim`, Escape/scrim dismiss).
   - **Block state callout-warn (last submit):**
     `An app needs a submit form to publish. This is the only one, so the app can't be published until a new submit form is added.` — in the blocked state the Remove confirm action is disabled.
3. **Data-intent T-07-13 consistent:** submissions created through a removed form are never
   deleted; copy states this.

**Locked context for consistency (binding on 07-06/07-07):**

- Removal is offered from the form-manager row (U-6 governs the rest of the row); the
  affordance is `icon-btn` `aria-label="Remove form"` with the `i-trash` icon.
- Removing the last `submit` form is BLOCKED in the modal via a `callout-warn` carrying the
  verbatim block copy; the `Remove form` confirm action is disabled in that state. Any
  non-last form (including a non-last `submit`, which cannot exist — one form per kind,
  D-02 — so "last submit" means the app's only submit form) removes through the modal confirm.
- Both modal-body strings above are verbatim; the `show`/`edit` variant is used because those
  kinds are link-driven only and carry no trigger (D-08, U-1).
- Both bodies state that submissions keep their data — the copy promise backs the mechanical
  07-06 prohibition; submissions are never deleted (T-07-13).
- Chrome: `.modal`/`.modal-head`/`.modal-body`/`.modal-foot` + `.scrim`, Escape/scrim
  dismiss; footer = ghost Cancel + `btn-danger` `Remove form`.

### U-5 — publish-gate SC#2 error copy and placement (+ long-copy wrap) ⏳ PENDING

Awaiting Task 5 checkpoint (`checkpoint:decision`, gate `blocking`).

### U-6 — kind-specific `forms[]` metadata in the manager row ⏳ PENDING

Awaiting Task 6 checkpoint (`checkpoint:decision`, gate `blocking`).

## Deviations from Plan

None — plan executed as written (rulings recorded one checkpoint at a time).

## Task Commits

1. **Task 1: U-1 — in-form trigger panel** — recorded in this SUMMARY (commit `docs(07-05): record U-1 ruling`, `c08443e7`; checkpoint close `af3a88bb`)
2. **Task 2: U-2 — `list`/`show` config surfaces** — recorded in this SUMMARY (commit `docs(07-05): record U-2 ruling`, `edd92a7a`; checkpoint close `242b2a82`)
3. **Task 3: U-3 — "New form" kind picker** — recorded in this SUMMARY (commit `docs(07-05): record U-3 ruling`, `2ec05127`; checkpoint close `48dfe1f2`)
4. **Task 4: U-4 — remove-form destructive confirm** — recorded in this SUMMARY (commit `docs(07-05): record U-4 ruling`)

## Next Phase Readiness

07-06/07-07 must not finalise any SPA surface for U-1…U-6 until the corresponding ruling above
is marked ✅ RECORDED. U-1, U-2, U-3 and U-4 are now available to implement; U-5 and U-6 remain gated.

---
*Phase: 07-multi-form-apps-per-form-triggers*
*Status: in progress — 4/6 rulings recorded*
