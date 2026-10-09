# Deferred Items — Phase 04 (out of scope during execution)

| Discovered in | Item | Why deferred |
|---|---|---|
| 04-02 | `packages/domain/src/decision/decision.conformance.spec.ts` — 11 `tsc -b` errors (fixture json not in tsconfig file list, implicit `any` params, readonly assignments) | Pre-existing from Phase 3 commit `32acdbdd`; unrelated to 04-02's files. Zero dsl/contract errors. |
| 04-02 | `apps/worker/src/processors/inbound-event.processor.ts` — `readonly string[]` not assignable to `string[]` (line 274) | Pre-existing from Phase 3 commit `32acdbdd`; out of scope boundary rule. |

Note: these do not block targeted vitest runs or `eslint` on 04-02's files, but they make a full `npm run build` (`lint && tsc -b`) fail regardless of Phase 4 work.
