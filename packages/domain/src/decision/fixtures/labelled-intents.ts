/**
 * Types for the synthetic RTE-11 labelled-intent fixture set.
 *
 * The cases themselves live in `labelled-intents.json` (a checked-in, versioned
 * fixture — never raw employee conversations). This module is the typed view
 * over that JSON, so the conformance suite reads `cases` with real field types
 * rather than `any`.
 *
 * `locale` is deliberately open (`en`, `vi`, `mixed`, `fr`, `und` appear in the
 * fixture). The conformance suite stratifies `en`/`vi`/`mixed` and folds
 * everything else into an `ambiguous` stratum, so an unrecognised locale is a
 * reporting bucket, not a parse error.
 */

/** One prior conversational turn — mirrors the JEV `Turn` contract shape. */
export interface LabelledIntentTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** A candidate app the platform is allowed to render for this case. */
export interface LabelledIntentCandidate {
  readonly id: string;
  readonly description: string;
  readonly aliases: string[];
}

/** The expected routing outcome (the label). */
export interface LabelledIntentExpected {
  readonly outcome: 'link' | 'clarify';
  /** Present iff `outcome === 'link'`. */
  readonly app_id?: string;
  /** Present iff `outcome === 'clarify'`. */
  readonly displayed_ids?: string[];
}

/**
 * One labelled intent case. `permissions` is the RBAC-filtered set of tool ids
 * offered to the provider for this case.
 */
export interface LabelledIntentCase {
  readonly id: string;
  readonly question: string;
  readonly history: LabelledIntentTurn[];
  readonly candidates: LabelledIntentCandidate[];
  readonly permissions: string[];
  readonly locale: string;
  readonly expected: LabelledIntentExpected;
}
