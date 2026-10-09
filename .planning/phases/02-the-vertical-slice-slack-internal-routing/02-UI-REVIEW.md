# Phase 02 — UI Review

**Audited:** 2026-10-06T15:12:00Z
**Baseline:** 02-UI-SPEC.md (design contract)
**Screenshots:** not captured (no dev server running)
**Interaction captures:** off

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Copy strings exist in spec but renderer implementation doesn't render them yet |
| 2. Visuals | 2/4 | Renderer is minimal placeholder with no styling matching design contract |
| 3. Color | 1/4 | No CSS implementing color tokens from design contract |
| 4. Typography | 1/4 | No font stack implementation; basic HTML with default browser typography |
| 5. Spacing | 1/4 | No spacing scale implementation |
| 6. Experience Design | 2/4 | Prefill service logic exists but no state handling, loading/error/success UIs |

**Overall: 10/24**

---

## Top 3 Priority Fixes

1. **Implement renderer UI with @formio/js** — Renderer currently shows only "Leave Request Form" placeholder. Must integrate @formio/js 5.6.1 Webform per UI-SPEC and render forms from schema. **Impact:** High (core vertical slice surface). **Fix:** Expand apps/renderer/index.html and add JS to load form schema, apply CSP, implement form rendering.

2. **Apply design tokens and styling** — No CSS implementing the color palette (60/30/10), spacing scale, or typography system from UI-SPEC. **Impact:** High (visual contract not met). **Fix:** Add CSS (same-origin, CSP-compliant) defining :root tokens and component styles matching prototypes/mockup.html patterns.

3. **Implement state UIs (loading/error/success/empty/expired)** — UI-SPEC defines specific copy and states (expired/invalid links, submission success/failure, loading). Currently no UI for these states. **Impact:** High (experience design, matches SC requirements). **Fix:** Implement state views with exact copy from copywriting contract.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
**Evidence:** 02-UI-SPEC.md §Copywriting Contract defines all required strings (Submit request, expired link, invalid link, denied, rate limited, submission success/failure, empty states, validation messages). Renderer has no UI rendering these strings yet - only placeholder text "Leave Request Form". Prefill service has no copy. No generic labels ("Submit/Click Here") found in renderer code. The contract is comprehensive and actionable.

**Findings:**
- **WARNING:** Copy strings are specified but not implemented in renderer UI (apps/renderer/index.html:4 shows placeholder only)
- **PASS:** No generic CTA labels in existing renderer files
- **PASS:** Copy contract aligns with requirements (LNK-11, SC#3-5, IM-08)

**Recommendation:** Implement state-specific UI components using exact copy strings from the contract.

### Pillar 2: Visuals (2/4)
**Evidence:** UI-SPEC states no component library, uses @formio/js 5.6.1 with minimal local CSS. Current renderer has no CSS, no layout structure beyond div. No visual hierarchy, no styling. No icon usage. Design contract calls for FormIO Webform rendering.

**Findings:**
- **WARNING:** No visual hierarchy implemented (apps/renderer/index.html is unstyled)
- **WARNING:** No layout/container structure as per typical form renderer
- **BLOCKER:** Does not use @formio/js Webform rendering yet - core visual surface missing
- **PASS:** CSP requirement noted (system fonts only)

**Recommendation:** Implement FormIO Webform integration with proper container/layout styling.

### Pillar 3: Color (1/4)
**Evidence:** UI-SPEC defines full color palette: canvas #f6f8fa (60%), surface #ffffff (30%), accent #0f9d8f (10%), with semantic colors (red/green/amber/blue), borders #e2e8f0, text #101828/#475467. No CSS files found in renderer implementing these tokens. No hardcoded colors in current code.

**Findings:**
- **BLOCKER:** No CSS implementing design tokens (:root custom properties missing)
- **BLOCKER:** No 60/30/10 split applied (no styling at all)
- **PASS:** No hardcoded colors in existing renderer source (just HTML/TS)

**Recommendation:** Add renderer.css with :root tokens matching UI-SPEC exactly, apply to body/form containers per 60/30/10.

### Pillar 4: Typography (1/4)
**Evidence:** UI-SPEC specifies system-first font stack (--sans, --display, --mono) with specific sizes/weights (Body 16px/400/1.55, Label 14px/600/1.4, Heading 20px/600/1.2). CSP-safe per FRM-07. No CSS implementing typography. Browser defaults are not matching the specified scale.

**Findings:**
- **BLOCKER:** No font-family declaration using specified system stack
- **BLOCKER:** No font-size/weight/line-height scale applied
- **PASS:** Compliant with no external font loading requirement

**Recommendation:** Implement typography tokens in CSS with system stack as specified.

### Pillar 5: Spacing (1/4)
**Evidence:** Spacing scale defined: xs=4px, sm=8px, md=16px, lg=24px, xl=32px, 2xl=48px, 3xl=64px. No CSS implementing spacing tokens or utility classes. Current HTML has no padding/margins applied.

**Findings:**
- **BLOCKER:** No spacing scale tokens defined in CSS
- **BLOCKER:** No spacing applied to form elements/layout
- **PASS:** No arbitrary spacing values found (no CSS yet)

**Recommendation:** Define spacing CSS variables and apply consistent spacing per scale.

### Pillar 6: Experience Design (2/4)
**Evidence:** PrefillService exists with buildPrefill/getPrefillMode logic - handles profile prefill from config. But no UI states implemented. UI-SPEC lists states: loading, validation errors, expired link, invalid/used, permission denied, rate limited, submission success/failure, empty. No loading spinners, error boundaries, disabled states visible. No interaction handling code beyond basic structure.

**Findings:**
- **WARNING:** Prefill logic exists (good foundation) but no UI surfaces for different states
- **WARNING:** No loading states, error states, empty states implemented in renderer UI
- **WARNING:** No handling for expired/invalid link states (critical per LNK-11)
- **PASS:** Prefill service covers field modes (prefill/prefill-editable)
- **PASS:** Defensive handling when profile is null/empty

**Recommendation:** Implement state router/view layer in renderer to show appropriate state based on URL params/query or API response (expired, invalid, denied, rate-limited, success, error, form).

---

## Registry Safety
Registry audit: shadcn not initialized (components.json not found; UI-SPEC shows shadcn_initialized: false). No third-party registries to audit. Skipping.

---

## Files Audited
- apps/renderer/index.html
- apps/renderer/src/prefill.ts
- apps/renderer/README.md
- .planning/phases/02-the-vertical-slice-slack-internal-routing/02-UI-SPEC.md
- .planning/phases/02-the-vertical-slice-slack-internal-routing/02-VERIFICATION.md
- .planning/phases/02-the-vertical-slice-slack-internal-routing/02-CONTEXT.md
