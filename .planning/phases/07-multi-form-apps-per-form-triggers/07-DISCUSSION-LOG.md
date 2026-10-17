# Phase 7: Multi-Form Apps & Per-Form Triggers - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-17
**Phase:** 7-Multi-Form Apps & Per-Form Triggers
**Areas discussed:** Form kinds & the action mapping, Read forms — projection vs FormIO schema, Trigger→form binding & routing, Data model / migration / builder UX

---

## Form kinds & the action mapping

**Q1 — How should a form's `kind` relate to the frozen read-link `action`?**

| Option | Description | Selected |
|--------|-------------|----------|
| kind ≡ action (4 kinds) | Form kind is exactly one of the frozen read-link actions: `submit`→create, `list`→query, `show`→view, `edit`→edit. No new enum; the wire's `action` IS the kind. `notification`/`draft` are not form kinds. | ✓ |
| Separate kind vocabulary | A separate, richer `kind` set (e.g. `approval`, `bulk-edit`) that maps onto an action. More expressive; adds a second taxonomy to keep in sync with the frozen action enum. | |
| Domain names, derive action | Keep the user-facing names (new/list/show/edit) as the kind; derive `action` at issuance. Same four values, but the domain names the form. | |

**User's choice:** kind ≡ action (4 kinds).
**Notes:** Maps the user's "list / edit / new / show" onto the frozen D-21 actions. Reuses the published contract with no wire change.

**Q2 — May one app hold more than one form of the same kind?**

| Option | Description | Selected |
|--------|-------------|----------|
| One form per kind | At most one form per kind per app. `form_id` derivable from kind; `(app, action)` resolution still identifies the form — no routing change. | ✓ |
| Multiple forms per kind | Several forms of the same kind (e.g. two `submit` forms). `form_id` becomes load-bearing in routing; the JEV tool list must expose form-level identity. | |

**User's choice:** One form per kind.
**Notes:** Consequence: no routing/granularity change; the frozen claim's `form_id` is still carried but is derivable from the action.

---

## Read forms — projection vs FormIO schema

**Q3 — How should the `show` (view) form render a submission?**

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse submit schema read-only | Renders the app's `submit` schema read-only via FormIO (D-68). `show` is a thin config, not a second schema. | ✓ |
| Own display schema | `show` carries its own full FormIO schema, independent of `submit`. Flexible; risks drift. | |
| Hybrid (projection + optional override) | Default projection with an optional override schema. Most flexible; most surface. | |

**User's choice:** Reuse submit schema read-only.
**Notes:** No schema drift; reuses D-68's existing behaviour.

**Q4 — How should the `list` (query) form be defined?**

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse Phase-4 query path | Reuses the saved-query + viewer-row projection (frozen `query` action, target_id = query_id). No new FormIO schema. | ✓ |
| FormIO list schema | A FormIO table/display schema bound to the collection, rendered like any form. | |

**User's choice:** Reuse Phase-4 query path.
**Notes:** The read path is reused end-to-end; a `list` form is a query reference plus column config.

**Q5 — Which form kinds must an app have in order to publish?**

| Option | Description | Selected |
|--------|-------------|----------|
| submit required, rest optional | `submit` mandatory (matches today's publish gate requiring `form_schema !== null`); `list`/`show`/`edit` optional. | ✓ |
| All four required | Every app must declare all four forms before publishing. | |
| Any one form required | At least one form of any kind; allows browse-only apps. | |

**User's choice:** submit required, rest optional.

---

## Trigger→form binding & routing

**Q6 — Where should a trigger live?**

| Option | Description | Selected |
|--------|-------------|----------|
| Triggers live on the form | Each form owns `{intents[], aliases[], threshold}`; app-level `triggers` retired (migrated into the submit form). JEV tool list = forms declaring triggers. | ✓ |
| App-level triggers + form pointer | Triggers stay app-level (D-52); each entry gains a `kind`/`form_id` pointer. Smaller migration. | |

**User's choice:** Triggers live on the form.

**Q7 — How many triggers may a form declare?**

| Option | Description | Selected |
|--------|-------------|----------|
| At most one per form | A form is triggered or not; one trigger object holds `intents[]`/`aliases[]`. Untriggered forms are link-reachable only. | ✓ |
| Zero or more per form | Several trigger objects per form. More flexible; more rows. | |
| Exactly one per form | Every published form must declare a trigger, including `show`/`edit`. | |

**User's choice:** At most one per form.

**Q8 — Which form kinds may carry a routable trigger?**

| Option | Description | Selected |
|--------|-------------|----------|
| submit + list only | The two chat entry points. `show`/`edit` are link-driven. Consistent with D-64. | ✓ |
| Any kind | Including `show`/`edit`; each needs a target-resolution rule. | |
| submit only | Simplest routing; drops D-64's view/query intents. | |

**User's choice:** submit + list only.

---

## Data model, migration & builder UX

**Q9 — What is the app's stored form shape?**

| Option | Description | Selected |
|--------|-------------|----------|
| forms[] replaces form_schema + triggers | `forms: [{form_id, kind, schema, form_version, triggers|null, config}]` replaces the single `form_schema` and the app-level `triggers`. One source of truth. | ✓ |
| Keep form_schema + add forms[] | Keep `form_schema` for submit, add `forms` for the rest. Two representations. | |
| forms[] + denormalised trigger summary | Keep an app-level trigger summary for fast routing reads; a second copy to keep consistent. | |

**User's choice:** forms[] replaces form_schema + triggers.

**Q10 — How should per-form `form_version` be derived?**

| Option | Description | Selected |
|--------|-------------|----------|
| app counter, per-form derived version | One app publish counter; each form's `form_version` = the app version at which that form last changed. One history; per-form staleness preserved. | ✓ |
| Independent per-form counters | Each form owns its own counter and history. Most granular; more machinery. | |
| form_version ≡ app version | Always equal to the app version; no per-form change-tracking. | |

**User's choice:** app counter, per-form derived version.

**Q11 — How should existing apps and seed templates migrate?**

| Option | Description | Selected |
|--------|-------------|----------|
| One-shot migration script | Rewrite every app doc and update the ~10 template seeds. No dual-shape code. | ✓ |
| Lazy on-read/on-write | Read path tolerates both shapes; upgrade on next write. | |
| Migration + read shim | One-shot migration plus a compatibility read shim. | |

**User's choice:** One-shot migration script.

**Q12 — How should the App Builder surface change?**

| Option | Description | Selected |
|--------|-------------|----------|
| Forms manager; triggers in-form | `Forms` tab becomes a manager (list/add/remove by kind, per-form designer); triggers edited inside the form. `Triggers` tab retired (12→11 sections; BLD-03 matrix rows change). | ✓ |
| Keep Triggers tab + form selector | Keep the app-level Triggers tab; each row selects the form it activates. No section-vocabulary change. | |
| Per-kind sub-tabs | `Forms` tab plus Submit/List/Show/Edit sub-tabs. Explicit; larger tab strip. | |

**User's choice:** Forms manager; triggers in-form.

---

## the agent's Discretion

- Exact `forms[]` element field names and the per-kind `config` payload (field surfacing for `show`, column config for `list`).
- Domain kind names vs wire action names (D-01 makes the bijection fixed; the canonical side in code is a choice).
- Whether `form_id` is stored or derived from `kind`.
- How the builder presents a form's trigger panel (inline vs drawer), subject to `prototypes/mockup.html`.

## Deferred Ideas

- Per-form RBAC / per-form visibility (user chose shared roles).
- Independent per-form versioning with per-form rollback.
- Triggers on `show`/`edit` (needs a target-resolution rule).
- App-authored vs per-user saved-query ownership for `list` forms — raised, left for the planner to confirm against Phase-4's model.
