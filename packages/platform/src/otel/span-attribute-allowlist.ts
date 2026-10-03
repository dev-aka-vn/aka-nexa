import type { Attributes } from '@opentelemetry/api';

/**
 * `SPAN_ATTRIBUTE_ALLOWLIST` — the closed attribute surface of every exported
 * span (FND-07, D-18). This file is the *only* definition; the wrapping
 * `AllowlistSpanExporter` derives its gate from it, so widening the trace
 * attribute surface is a one-line change review can see.
 *
 * ## Why this list exists at all
 *
 * The trace backend is the one store in this architecture with **no per-app RBAC
 * and no erasure path**. Everything written there is retained, which means a
 * span attribute is not a debugging convenience — it is a permanent write, and
 * under GDPR an identifier written there cannot be recalled. That is why this
 * is an allowlist and not a denylist: a denylist has to enumerate every way
 * `submission_id` can be named, and a computed key (`span.setAttribute(name, v)`)
 * defeats it by construction.
 *
 * ## D-18: `submission_id` is never a span attribute and never seeds a trace
 *
 * PROJECT and D-18 settled this by *rejecting* the obvious convenience. Making
 * `trace_id` a deterministic function of `submission_id` (raw or hashed) would
 * make every trace queryable by submission — and the trace backend is precisely
 * the store that must not accumulate a correlatable activity map. A hash is not
 * an escape: a hash of `submission_id` is still correlatable by anyone holding
 * the input space, and the input space here is UUID-shaped, not large.
 *
 * The asymmetry D-19 rules for is deliberate and is the erasure property:
 *
 * - **logs** carry `trace_id` and may carry `submission_id` — bounded retention
 *   (30 d hot / 1 y cold, OBS-07);
 * - **audit** may carry `submission_id` with a tombstoneable `actor_ref` — 3 y,
 *   per AUD-04;
 * - **traces** carry neither — no purge window exists.
 *
 * So an operator can go trace → logs. The reverse is not derivable. That is the
 * only direction that keeps a GDPR erasure request satisfiable.
 *
 * ## Changing this list
 *
 * D-18 is one of the four irreversible Phase 1 contracts and it is enforced at
 * the **export** boundary, so adding a name here immediately changes what leaves
 * the process. As with D-16's log allowlist, the friction is the control: an
 * addition must be argued in review, not slipped in by a call site.
 *
 * @see ./allowlist-span-exporter.ts for why the gate lives in an exporter
 * @see ../logging/log-allowlist.ts for the sibling log-field contract
 */
export const SPAN_ATTRIBUTE_ALLOWLIST = Object.freeze([
  // ── service and resource identity ──────────────────────────────────────
  // Emitted by the SDK from the boot config, never by a call site. Present
  // here so that a trace read against `service.name` is a supported query
  // rather than an accident.
  'service.name',
  'service.version',
  'deployment.environment',
  // ── HTTP and Nest semantics ────────────────────────────────────────────
  // Both the legacy and the stable (semconv 1.27+) spellings are listed.
  // Verified against the installed `@opentelemetry/auto-instrumentations-node@0.80.0`:
  // `@opentelemetry/instrumentation-http` emits `http.request.method` and
  // `http.response.status_code`, and `@opentelemetry/instrumentation-express`
  // emits `http.route`. Carrying the legacy pair as well costs nothing — an
  // unused allowlist entry is inert — whereas omitting the stable pair would
  // strip the method and status from every HTTP span.
  //
  // Deliberately NOT permitted, though the same instrumentations emit them:
  // `url.full`, `url.path`, `url.query`, `http.target`, `http.url`, `http.host`,
  // `http.client_ip`, `http.user_agent`, `user_agent.original`,
  // `client.address`, `server.address`, `server.port`, `network.*`. A URL path
  // in this product carries the submission identifier, so admitting any of them
  // would undo D-18 through the HTTP instrumentation rather than through a call
  // site.
  'http.method',
  'http.request.method',
  'http.route',
  'http.status_code',
  'http.response.status_code',
  // Nest's own span durations, in the same unit as the log field allowlist.
  'duration_ms',
  // ── queue semantics ────────────────────────────────────────────────────
  'messaging.system',
  'messaging.destination.name',
  'messaging.operation',
  'attempt',
  // ── safe domain identifiers: opaque ids and closed enums only ───────────
  'app_id',
  'form_id',
  'action', // D-22's closed enum — "draft" is reserved and never exported
  'jti', // the read-link token id (PRD AD-11)
  'trace_id', // the SDK-generated W3C trace id, for cross-referencing logs
] as const);

/** The union of attribute names an exported span may carry. */
export type AllowlistedSpanAttribute = (typeof SPAN_ATTRIBUTE_ALLOWLIST)[number];

/**
 * Names that must never be exported, whatever the allowlist says.
 *
 * This list is *not* a second source of truth — it is a tripwire. Its purpose is
 * to make the intent explicit at the point where a reviewer looks, and to give
 * the allowlist spec something to assert against that is not the allowlist
 * itself. A future addition that reintroduces `submission_id` as a span
 * attribute fails the spec even if someone also added it to the allowlist.
 */
export const FORBIDDEN_SPAN_ATTRIBUTES = Object.freeze([
  'submission_id',
  'submissionId',
  'submission.id',
  'app.submission_id',
  'actor_ref',
  'user_email',
  'email',
] as const);

/**
 * O(1) membership test used by the export filter.
 *
 * Built once at module load from the frozen list, so the gate and the exported
 * list cannot drift apart — the same construction as `LOG_FIELD_ALLOWLIST_SET`.
 * `ReadonlySet` because the set is internal but its type should stop a later
 * refactor from deleting from it mid-export.
 */
export const SPAN_ATTRIBUTE_ALLOWLIST_SET: ReadonlySet<string> = new Set<string>(
  SPAN_ATTRIBUTE_ALLOWLIST,
);

/**
 * Reduce a span's attributes to the allowlisted subset.
 *
 * Values are copied by reference rather than rebuilt, so a number stays a number
 * and an array stays an array: the OTLP serialiser branches on the value type,
 * and a filter that normalised values would corrupt `duration_ms`.
 */
export function filterSpanAttributes(attributes: Attributes): Attributes {
  const filtered: Attributes = {};
  for (const key of Object.keys(attributes)) {
    if (SPAN_ATTRIBUTE_ALLOWLIST_SET.has(key)) {
      filtered[key] = attributes[key];
    }
  }
  return filtered;
}