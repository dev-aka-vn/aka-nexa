/**
 * BLD-06 — the publish guard predicates (G-06-4).
 *
 * The Ctrl/Cmd+S chord must not publish while
 * the active section's JSON editor holds an
 * unsaved edit: a valid-yet-incomplete draft
 * would otherwise publish the section's
 * *persisted* state from under the admin's
 * typing. These predicates are deliberately
 * pure — no React, no DOM — so the unit spec
 * and the e2e assert the same rule rather
 * than two copies of it. They sit beside
 * `publishShortcut.ts`: the editor's pure
 * guards live together.
 */

/**
 * Whether the JSON editor's draft differs
 * from the section's persisted value. Both
 * sides are compared after trimming trailing
 * whitespace, so a whitespace-only
 * difference is not an edit and any
 * substantive change — a character added,
 * removed, or changed — is.
 */
export function jsonDraftIsDirty(
  draft: string,
  persisted: string,
): boolean {
  return draft.trimEnd() !== persisted.trimEnd();
}

/** The chord's publish state: the dirty flag and the in-flight flag. */
export interface ShortcutPublishState {
  readonly dirty: boolean;
  readonly saving: boolean;
}

/**
 * Whether the publish chord may proceed. True
 * only when the state is neither dirty nor
 * saving: a mid-edit section blocks the chord
 * inline, and an in-flight save or publish
 * blocks a held repeat from queueing a
 * second request.
 */
export function shortcutMayPublish(
  state: ShortcutPublishState,
): boolean {
  return !state.dirty && !state.saving;
}
