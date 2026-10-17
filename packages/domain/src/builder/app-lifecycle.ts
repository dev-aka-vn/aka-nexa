/**
 * The app-definition lifecycle state machine (APP-02, APP-03,
 * APP-05, APP-06).
 *
 * ## The legal-transition table
 *
 * ```
 * draft ──commitPublish──▶ published ──deprecate──▶ deprecated
 *   │                        │                       │
 *   └────────archive─────────┴────────archive────────┘
 *                              ▼
 *                          archived (terminal)
 * ```
 *
 * Plus re-activation: `deprecated → published`. `archived` is
 * terminal — no transition out of it is legal, which is what
 * makes "an archived app accepts no new submissions but its
 * existing view links still resolve" (APP-06) safe: the state
 * can never come back.
 *
 * ## The gating guards
 *
 * - `assertAcceptsSubmissions` — the submission-creation seam
 *   calls this before writing a submission record; an archived
 *   app refuses with `SUBMISSION_REFUSED_ARCHIVED` (APP-06).
 *   Deprecated apps keep accepting submissions — a deprecated
 *   app "stays functional" (APP-05).
 * - `assertRegistersTriggers` — the trigger-registration path
 *   (the app's declared triggers/slash commands that activate
 *   it) calls this before registering; deprecated and archived
 *   apps refuse with `TRIGGER_REGISTER_REFUSED_DEPRECATED`
 *   (APP-05: a deprecated app "registers no new triggers" —
 *   and an archived app, being beyond deprecation, registers
 *   nothing either).
 *
 * ## Why the errors carry a `code`
 *
 * Every refusal is a named, inline error (BLD-07): the API
 * controller maps `code` to a status and renders the message,
 * so a caller can branch on the reason without parsing prose.
 */

/** The four lifecycle states (APP-02's reachability ladder). */
export type AppLifecycleState = 'draft' | 'published' | 'deprecated' | 'archived';

export const APP_LIFECYCLE_STATES: readonly AppLifecycleState[] = [
  'draft',
  'published',
  'deprecated',
  'archived',
] as const;

/**
 * The base for every builder-domain refusal. A `code` a
 * controller can branch on, plus a message that names the
 * rule (BLD-07: inline, specific, actionable — never a
 * generic "something went wrong").
 */
export class BuilderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = this.constructor.name;
  }
}

/** `draft → published` via the plan-05 gate's commitPublish seam, `published → deprecated`, `deprecated → published` re-activation, any → archived, archived terminal. */
const LEGAL_TRANSITIONS: ReadonlyMap<
  AppLifecycleState,
  ReadonlySet<AppLifecycleState>
> = new Map([
  ['draft', new Set(['published', 'archived'])],
  ['published', new Set(['deprecated', 'archived'])],
  ['deprecated', new Set(['published', 'archived'])],
  ['archived', new Set()],
]);

/** An illegal lifecycle transition (APP-02's ladder, enforced). */
export class LifecycleTransitionError extends BuilderError {
  constructor(
    public readonly from: AppLifecycleState,
    public readonly to: AppLifecycleState,
  ) {
    super(
      'LIFECYCLE_ILLEGAL_TRANSITION',
      `${from} → ${to} is not a legal lifecycle transition`,
    );
  }
}

/** An archived app accepts no new submissions (APP-06). */
export class SubmissionRefusedError extends BuilderError {
  constructor(appId: string) {
    super(
      'SUBMISSION_REFUSED_ARCHIVED',
      `app ${appId} is archived and accepts no new submissions`,
    );
  }
}

/** A deprecated (or archived) app registers no new triggers (APP-05). */
export class TriggerRegisterRefusedError extends BuilderError {
  constructor(
    appId: string,
    public readonly lifecycle: AppLifecycleState,
  ) {
    super(
      'TRIGGER_REGISTER_REFUSED_DEPRECATED',
      `app ${appId} is ${lifecycle} and registers no new triggers`,
    );
  }
}

/**
 * The state machine. Static — the transition table is a property
 * of the domain, not of an instance.
 */
export class AppLifecycle {
  /**
   * Refuse every transition the table does not list.
   *
   * `commitPublish` calls this before publishing, `deprecate`
   * and `archive` before their transitions, and the re-activation
   * path before re-publishing a deprecated app.
   */
  static assertTransition(
    from: AppLifecycleState,
    to: AppLifecycleState,
  ): void {
    if (!LEGAL_TRANSITIONS.get(from)?.has(to)) {
      throw new LifecycleTransitionError(from, to);
    }
  }

  /**
   * The submission-creation seam's guard (APP-06).
   *
   * Only `archived` refuses: a deprecated app "stays
   * functional" (APP-05) — existing flows keep working,
   * including submissions.
   */
  static acceptsSubmissions(lifecycle: AppLifecycleState): boolean {
    return lifecycle !== 'archived';
  }

  static assertAcceptsSubmissions(
    appId: string,
    lifecycle: AppLifecycleState,
  ): void {
    if (!this.acceptsSubmissions(lifecycle)) {
      throw new SubmissionRefusedError(appId);
    }
  }

  /**
   * The trigger-registration path's guard (APP-05).
   *
   * Deprecated apps register no new triggers; archived apps
   * are terminal and register nothing. Draft and published
   * apps register normally.
   */
  static registersTriggers(lifecycle: AppLifecycleState): boolean {
    return lifecycle === 'draft' || lifecycle === 'published';
  }

  static assertRegistersTriggers(
    appId: string,
    lifecycle: AppLifecycleState,
  ): void {
    if (!this.registersTriggers(lifecycle)) {
      throw new TriggerRegisterRefusedError(appId, lifecycle);
    }
  }
}
