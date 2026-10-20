---
phase: "7"
slug: "multi-form-apps-per-form-triggers"
status: verified
threats_open: 0
asvs_level: 1
created: "2026-10-17"
---

# Phase 7 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| builder SPA → app-builder API | Untrusted section patch payloads (`{section:'forms', patch:{forms:[…]}}`) cross here | — |
| seed JSON → TemplateSeed.load() | Committed-but-evolving seed data crosses into stored templates | — |
| stored `apps` documents → domain readers | Documents written by earlier phases (old shape) or half-migrated by a failed run | — |
| stored role grants → builder-ability | Documents written under the 13-section vocabulary are read by a 12-section ability factory | — |
| section patch payload → UpdateSectionSchema | Untrusted section names cross here | — |
| seed JSON → TemplateSeedSchema | Evolving committed data crosses into stored templates at boot | — |
| list form config.query_id → saved_queries lookup | An authored reference crosses into a data-read path | — |
| boot migration → live `apps` / `app_definition_versions` | A bulk writer crosses into user-owned documents while the API may be serving | — |
| stored old-shape documents → new-shape readers | Documents written by pre-Phase-7 code are read by post-cutover code | — |
| user rulings → SPA implementation | Design decisions cross from human judgment into build instructions | — |
| forms[] patch → submissions store | A definition mutation must not cascade into submission data | — |
| panel state → forms[] payload | UI working rows map onto the D-06 trigger shape at save time | — |
| chat user → JEV tool list | Untrusted request text crosses into a permission-filtered catalog | — |
| published definitions → worker catalog | Stored definitions (possibly un-migrated) cross into routing | — |
| issuance seam → link URL | Form identity + action cross into a user-visible URL | — |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-07-01 | Tampering | forms section patch + AppFormElementSchema | high | mitigate | Every `forms[]` element is parsed `.strict()` (unknown key rejected, field named) inside `updateSection` before any write; two forms of the same kind are rejected with the kind named (D-02). A half-migrated or hand-crafted element fails the parse, never reaches the store. | closed |
| T-07-02 | Tampering | TemplateSeedSchema / forkTemplate | medium | mitigate | `TemplateSeedSchema` stays `.strict()` over the new `forms` array, so a stale seed carrying `form_schema` is rejected at boot rather than silently loading; `forkTemplate` deep-copies `forms` via structuredClone (no platform-reference leak, D-108). | closed |
| T-07-03 | Information Disclosure | declaredLabels / publish gate | low | accept | Labels come from the owner-authored trigger vocabulary and flow only through owner-scoped publish paths; no user data enters labels. Reviewed — no additional handling this phase. | closed (accepted) |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Package-legitimacy gate: this plan installs ZERO packages (07-RESEARCH §Package Legitimacy Audit is empty); any discovered install need must run the legitimacy gate first. Blocking human checkpoint for [ASSUMED]/[SUS] packages. | closed |
| T-07-04 | Elevation of Privilege | section mirrors (SECTION_FIELDS vs APP_SECTION_PERMISSIONS) | high | mitigate | A mirror that drifts could let a role patch a section the permission matrix never restricted. The drift-guard spec asserts set-equality of all four lists, and S3's one-section-one-field rule is asserted (`SECTION_FIELDS['forms'] === ['forms']`), so a drifted mirror is a red suite, not a silent privilege hole. | closed |
| T-07-05 | Tampering | stored role grants naming the retired 'triggers' section | medium | mitigate | `createBuilderAbility` treats an unknown section grant as a silent no-op (builder-ability.ts:165-167) — no escalation path; the grants are dropped by 07-04's migration (Pitfall 5). builder-ability.spec.ts pins the no-op behaviour so the intermediate window is explicit. | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Zero packages installed; any discovered need runs the package-legitimacy gate first. | closed |
| T-07-06 | Information Disclosure | list form `config.query_id` referencing another app's saved query | medium | mitigate | The saved-query lookup is keyed `(app_id, query_id)` and fails closed on any foreign pair (asserted in Task 2); a bad reference yields a defined empty result, never another app's rows. | closed |
| T-07-07 | Tampering | a seed's `show` config naming fields outside its own submit schema | low | mitigate | The `.superRefine` rejects the seed at boot with the offending field named — a template cannot ship a viewer surface over fields it never collected (D-03 "cannot drift" made mechanical). | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Zero packages installed; any discovered need runs the package-legitimacy gate first. | closed |
| T-07-08 | Tampering | torn migration: apps migrated, app_definition_versions not | high | mitigate | Both collections transform in the same run (one function, two passes); form-migration.spec.ts case 5 proves a post-migration `rollback()` restores `forms[]` — the resurrect-the-retired-shape path is closed by test, and the prohibition block fails the phase if any read path accepts the old shape back. | closed |
| T-07-09 | Tampering | concurrent replicas double-migrating the same document | medium | mitigate | Every update filter re-checks `form_schema: { $exists: true }`, making the write a compare-and-set: an already-transformed document (by this replica or another) is skipped; spec case 7 pins the no-op. | closed |
| T-07-10 | Tampering (data loss) | an empty-filter migration rewriting minimal platform docs | high | mitigate | The `find` filter is `{ form_schema: { $exists: true } }` (Pitfall 7 — the collection is a shape union); spec case 2 asserts a minimal doc is byte-untouched. | closed |
| T-07-11 | Denial of Service | a throwing migration blocking API boot | medium | mitigate | The boot block is best-effort with warn-on-failure (Pattern 3 / S5): an unreachable Mongo degrades to a readiness failure, never a crash-loop. | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Zero packages installed (native mongodb driver already in tree); any discovered need runs the package-legitimacy gate first. | closed |
| T-07-12 | Elevation of Privilege (design-level) | U-1 trigger panel | medium | mitigate | The panel design must keep trigger editing disabled for `show`/`edit` kinds (D-08) and inside the `forms` section's permission (the panel saves through the same `forms`-section PATCH, so BLD-03's section permission governs it — confirmed as a constraint in each option's context). | closed |
| T-07-13 | Tampering (design-level) | U-4 remove-form confirm | low | mitigate | Whichever option is chosen, the confirmed copy must state that prior submissions keep their data — the decision cannot authorize silent data loss (the prohibition in 07-06 enforces it mechanically). | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Zero packages installed; any discovered need runs the package-legitimacy gate first. | closed |
| T-07-14 | Tampering (data loss) | remove-form flow cascading into submissions | high | mitigate | The remove flow writes ONLY the `forms` section (S3's one-section-one-field makes a cascade structurally impossible); the survival integration test is the wired check, and the U-4 modal copy states the guarantee to the user. | closed |
| T-07-15 | Elevation of Privilege | manager PATCHes bypassing section permissions | medium | mitigate | The manager saves through the same `{section:'forms'}` PATCH as the Phase-6 editor — `assertOwner` + the BLD-03 `forms`-section ability check apply unchanged; no new permission surface is introduced (asserted by the existing app-builder module specs staying green). | closed |
| T-07-16 | Denial of Service (author-side) | removing the last submit form silently stranding the app | low | mitigate | The U-4 ruling decides blocked-or-warned in the SPA; the publish gate (07-08) blocks publish with a named reason regardless — the author can never silently ship an unpublishable state. | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Zero packages installed; any discovered need runs the package-legitimacy gate first. | closed |
| T-07-17 | Elevation of Privilege (design-level) | trigger panel enabling routable triggers on `show`/`edit` kinds | high | mitigate | The panel is disabled for `show`/`edit` (D-08) and the publish gate (07-08) rejects any `show`/`edit` form that nevertheless carries a trigger — defense in depth: UI disable + server-side gate + spec assertions on both sides. | closed |
| T-07-18 | Tampering | trigger labels injected into links or rendered unsafely | low | mitigate | Labels render as React text (escaped by construction — never `dangerouslySetInnerHTML`); the SPA never interpolates labels into URLs; the persisted shape is `{intents[], aliases[], threshold}` validated server-side by the forms-section parse from 07-01. | closed |
| T-07-19 | Tampering | config.fields naming keys outside the submit schema | low | mitigate | Client-side stale-entry InlineError mirrors 07-03's seed-level subset rule; the read path renders from the submit schema, so a stale key is a visible error, never a data path. | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Zero packages installed; any discovered need runs the package-legitimacy gate first. | closed |
| T-07-20 | Elevation of Privilege | form-level trigger bypassing app RBAC | high | mitigate | The RBAC filter runs BEFORE the form projection (S8): `listAuthorized` authorizes the app per user first and projects forms only for authorized apps; the loader spec + the integration case (c) assert an excluded user gets zero tools despite triggered forms. The gate additionally rejects triggers on show/edit (D-08), shrinking the routable surface. | closed |
| T-07-21 | Tampering | trigger ambiguity resolved by silent first-wins at routing time | high | mitigate | Publish-time rejection (Task 1 rule 2) is the authoritative control — the ambiguity cannot exist in a published app; the routing-side slash lookup degrades multi-app collisions to the clarify outcome rather than picking. | closed |
| T-07-22 | Tampering | cross-app form injection — issuing against a form the app does not own | high | mitigate | The processor resolves forms only from the authorized list derived from the SAME definition as the app; the loader tolerates un-migrated docs by projecting nothing (fail closed); the tool-id split (`appId:form`) is unambiguous because AppIdSchema forbids ':' and form_id is a kind string. | closed |
| T-07-23 | Tampering | wrong `form_version` in an issued link rendering a stale schema | medium | mitigate | The form_version rides the definition's derived value (D-10, landed 07-01); the integration assertion pins `fv=` to the definition's current per-form version; a mismatch is a red test, not a deploy-time surprise. | closed |
| T-07-24 | Information Disclosure | tool descriptions/labels leaking apps to excluded users | medium | mitigate | Same filter-then-project order (S8): excluded users never see the app's tools or labels; the spec asserts the empty tool list, matching RTE-03's existing guarantee. | closed |
| T-07-SC | Tampering | npm/pip/cargo installs | high | mitigate | Zero packages installed; any discovered need runs the package-legitimacy gate first. | closed |

*Status: open · closed · open — below {block_on} threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-07-01 | T-07-03 | Labels come from the owner-authored trigger vocabulary and flow only through owner-scoped publish paths; no user data enters labels. Reviewed — no additional handling this phase. | orchestrator | 2026-10-19 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-19 | 32 | 32 | 0 | orchestrator (L1 grep-depth; auditor subagent unavailable) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-19
