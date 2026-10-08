import type { ReadDenyReason } from '@akane/contract';
import type { LoggerPort } from '@akane/platform';

/**
 * The two actions the read path branches on (D-40). A denial is always
 * attributable to one of them; for `invalid_action` — the claim's `action`
 * was neither — the caller reports the action the *route* attempted, because
 * that is the only action context the controller actually has.
 */
export type ReadDenyAction = 'view' | 'query';

/**
 * The seam the domain uses to count a denial.
 *
 * The OTel counter itself lives in `apps/api/src/common/metrics/
 * read-deny.metrics.ts`: instruments belong to the process that owns the
 * exporter wiring, and a domain module creating one would put a second
 * registration site outside the single-metric-path rule (D-71, STACK §6). The
 * domain owns the *decision* to count and the label values; the app owns the
 * instrument.
 */
export interface ReadDenyRecorder {
  recordDenial(reason: ReadDenyReason, action: ReadDenyAction): void;
}

/** Everything the structured deny log entry is allowed to carry (LNK-09). */
export interface ReadDenyContext {
  readonly action: ReadDenyAction;
  /** The token id from the route/claim — opaque, never the token itself. */
  readonly jti?: string;
  /** Opaque app scope; never the app's name (PRD AD-11: IDs only). */
  readonly app_id?: string;
}

/**
 * Read-link denial recording (LNK-08, D-71, LNK-09).
 *
 * ## What one call guarantees
 *
 * 1. **One counter increment** labelled with the specific `reason` and the
 *    `action` — LNK-08 requires the seven revocation reasons to be counted
 *    *distinctly*, not as one aggregate. Internal reasons (`not_found`,
 *    `not_owned`, `denied`, `invalid_action`) are counted too: they share the
 *    counter and add four label values to the enum's eleven, all fixed
 *    cardinality.
 * 2. **Exactly one structured log entry** whose field *names* are drawn from
 *    the D-43 allowlist. The type system enforces this — `LoggerPort.warn`
 *    only accepts `LogFields` — and the runtime rebuild hook in
 *    `log-allowlist.formatter.ts` enforces it again for anyone who bypasses
 *    the port.
 *
 * ## Why the logger is optional
 *
 * The counter is the requirement; the log line is the diagnostic companion.
 * A caller without a logger (a script, a test, a future batch path) must not
 * lose the count because it has nowhere to write prose. `undefined` logger
 * means "count only".
 *
 * ## `consumed` is reserved
 *
 * `TOKEN_CLASSES.view` and `TOKEN_CLASSES.query` both set `consume: false`
 * (D-42), so no code path in the read verifier ever produces
 * `ReadDenyReason.consumed`. The enum member exists because LNK-08's seven
 * reasons share this surface with the write path; if a stale issuer ever
 * produces one it is counted like any other reason and the renderer shows the
 * generic copy. Nothing here is allowed to *invent* consumption semantics for
 * read links.
 */
export class ReadDenyService {
  constructor(
    private readonly recorder: ReadDenyRecorder,
    private readonly logger?: LoggerPort,
  ) {}

  /**
   * Record one denial: increment the counter, then emit the allowlisted log
   * entry. Never throws — a metrics or logging failure must not turn a denial
   * into a 500 that leaks a different error surface.
   */
  record(reason: ReadDenyReason, ctx: ReadDenyContext): void {
    this.recorder.recordDenial(reason, ctx.action);

    this.logger?.warn('read link denied', {
      reason,
      action: ctx.action,
      status: 'denied',
      ...(ctx.jti === undefined ? {} : { jti: ctx.jti }),
      ...(ctx.app_id === undefined ? {} : { app_id: ctx.app_id }),
    });
  }
}
