# Phase 10 — Deferred Items

Items discovered while executing a plan that are **outside that plan's scope**
(scope-boundary rule: log, do not fix).

## 10-04 — outbound delivery seam

### D-10-04-1 — Pre-existing orphan: `apps/api/src/forms/form-load.metrics.ts`

`tooling/entrypoint-drift.spec.ts` fails its api orphan walk with exactly one
file:

```
api has source files its main.ts never loads:
  apps/api/src/forms/form-load.metrics.ts
```

Classified **pre-existing**, not introduced by 10-04:

- the file is unmodified in the working tree (`git status` clean for that path);
- its last touch is `625460f5 feat(09-03): declare and wire OBS-03 instruments`;
- nothing in `apps/` or `packages/` imports it — the only reference anywhere is
  the metric-registry `emitSite` string at
  `packages/platform/src/metrics/metric-registry.ts:147`.

Before this plan the same spec also flagged the two new
`packages/domain/src/adapters/*/outbound/*.port.ts` files, because the ports had
briefly been re-exported from the domain root barrel (which sits in the api's
import closure). That part **was** in scope and is fixed: the ports are now
reachable only through explicit `@akane/domain/adapters/<p>/outbound/<port>.js`
subpaths, and the R1 closure assertion passes again.

Owning fix (not this plan): wire `form-load.metrics.ts` into the api module (or
delete it and let the registry emit site point at the surviving file). Needs a
composition-root owner, same class as the Phase 08 `deferred-items` note.

### D-10-04-2 — Slack outbound implementation deferred

`apps/worker/src/adapters/slack/outbound/slack-delivery.adapter.ts` is listed in
the plan's `files_modified` but deliberately **not created**. There is no Slack
bot-token configuration, no Slack Web API client in the dependency graph, and no
writer of a Slack conversation reference yet (10-05 only lands the inbound
verifier + receiver). An implementation with no addressing data would be a stub,
and adding it to `WORKER_CONSUMERS`/providers before it can work would either
fail boot or sit dead in the composition root.

The port (`SlackOutboundPort`) **is** in place, so the OUT-12 seam exists. The
implementation should land with, or after, the Slack receiver's
conversation-reference write — the same prerequisite the CONTEXT note attaches to
Zalo/Telegram delivery in Phases 12-13.
