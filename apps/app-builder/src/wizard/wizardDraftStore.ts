/**
 * The wizard's session-scoped working state
 * (G-06-7's designer-return-path closure).
 *
 * Step 4's only outbound action opens the
 * form designer, which unmounts the wizard —
 * and every wizard field lives in
 * component-local state. The server-side
 * draft survives (step 1 POSTs it, each later
 * step PATCHes its section), but the wizard's
 * *position* and any *in-progress* step input
 * would be lost without this module: it
 * snapshots both, keyed by app id, for the
 * browser session.
 *
 * The snapshot is working state, not user
 * data: sessionStorage only (cleared when the
 * wizard finishes, never written to the
 * server — no tokens, no secrets, only the
 * field values the admin is already typing).
 *
 * Reads are shape-guarded: a corrupted or
 * stale entry hydrates as absent, never as a
 * broken wizard. A version field invalidates
 * entries written by an older shape.
 */

import type { BasicsValue } from './BasicsStep.js';
import type { RbacValue } from './RbacStep.js';
import type { RoutingValue } from './RoutingStep.js';
import type { TriggersValue } from './TriggersStep.js';

/** The locked wizard order's length (Basics → Triggers → RBAC → Form → Routing). */
export const WIZARD_STEP_COUNT = 5;

/** The stored payload's shape version — a later shape change invalidates old entries. */
const SNAPSHOT_VERSION = 1;

/** The wizard's resumable position plus its in-progress inputs, for one draft. */
export interface WizardSnapshot {
  /** The draft's app id — the snapshot's key. */
  appId: string;
  /** The wizard step index the user left (0-based). */
  step: number;
  basics: BasicsValue;
  triggers: TriggersValue;
  rbac: RbacValue;
  routing: RoutingValue;
}

/**
 * The storage surface the store reads and
 * writes. sessionStorage satisfies it; specs
 * pass an in-memory double — the store never
 * touches the DOM, so it is import-safe from
 * the node vitest environment.
 */
export interface SnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The guarded browser accessor: the real
 * sessionStorage where it exists, null on a
 * server render or in a node test
 * environment — where the store is a no-op.
 */
function defaultStorage(): SnapshotStorage | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}

/** The namespaced key — one snapshot per draft app id. */
function keyFor(appId: string): string {
  return `akane.wizard-draft.v${SNAPSHOT_VERSION}.${appId}`;
}

/** A plain record (an object that is not null and not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

/**
 * Read one draft's snapshot. Returns null when
 * there is no entry, when storage is
 * unavailable, or when the stored payload is
 * not the expected shape — a bare string, an
 * array, an object missing the step or one of
 * the four value objects, or a step that is
 * not a finite integer in the wizard's range.
 * A corrupt entry is discarded (removed) so a
 * later shape cannot re-read it.
 */
export function readWizardSnapshot(
  appId: string,
  storage: SnapshotStorage | null = defaultStorage(),
): WizardSnapshot | null {
  if (storage === null) {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = storage.getItem(keyFor(appId));
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    discard(appId, storage);
    return null;
  }
  if (!isRecord(payload)) {
    discard(appId, storage);
    return null;
  }
  const { version, appId: storedAppId, step, basics, triggers, rbac, routing } =
    payload;
  if (
    version !== SNAPSHOT_VERSION ||
    storedAppId !== appId ||
    typeof step !== 'number' ||
    !Number.isInteger(step) ||
    step < 0 ||
    step >= WIZARD_STEP_COUNT ||
    !isRecord(basics) ||
    !isRecord(triggers) ||
    !isRecord(rbac) ||
    !isRecord(routing)
  ) {
    discard(appId, storage);
    return null;
  }
  return {
    appId,
    step,
    basics: basics as unknown as BasicsValue,
    triggers: triggers as unknown as TriggersValue,
    rbac: rbac as unknown as RbacValue,
    routing: routing as unknown as RoutingValue,
  };
}

/**
 * Write one draft's snapshot. A best-effort
 * session cache: a write that cannot persist
 * (quota, unavailable storage) never throws
 * into the wizard.
 */
export function writeWizardSnapshot(
  snapshot: WizardSnapshot,
  storage: SnapshotStorage | null = defaultStorage(),
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(
      keyFor(snapshot.appId),
      JSON.stringify({
        version: SNAPSHOT_VERSION,
        appId: snapshot.appId,
        step: snapshot.step,
        basics: snapshot.basics,
        triggers: snapshot.triggers,
        rbac: snapshot.rbac,
        routing: snapshot.routing,
      }),
    );
  } catch {
    // The snapshot is a cache — the draft on
    // the server is the source of truth.
  }
}

/**
 * Clear one draft's snapshot — the wizard
 * calls this where it already marks the flow
 * complete, so a finished wizard leaves no
 * state behind. Clearing one app never
 * touches another app's snapshot.
 */
export function clearWizardSnapshot(
  appId: string,
  storage: SnapshotStorage | null = defaultStorage(),
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.removeItem(keyFor(appId));
  } catch {
    // Clearing is best-effort like the write.
  }
}

/** Drop a corrupt entry so it can never hydrate a broken wizard. */
function discard(
  appId: string,
  storage: SnapshotStorage,
): void {
  try {
    storage.removeItem(keyFor(appId));
  } catch {
    // Best-effort, like every other write.
  }
}
