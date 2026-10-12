/**
 * Schema-snapshot undo/redo (BLD-04, RESEARCH Pattern 2).
 *
 * `@formio/js` 5.6.1 exposes no builder undo/redo API — the only
 * `undo` symbol in the package is `Select.undoValueTyping`, an
 * internal select-input method (verified by grep of the installed
 * tarball). The 50-action history is therefore app-built, on the
 * documented public surface only:
 *
 *   capture — `builder.on('change')` fires with the current
 *             schema; the snapshot is debounced so a burst of
 *             change events (one user action can emit several)
 *             coalesces into ONE history entry.
 *   restore — `builder.setForm(snapshot)` puts a snapshot back.
 *
 * Never monkey-patch `builder.instance` or per-component hooks
 * (Pitfall 3): those are undocumented internal surfaces that break
 * on patch bumps.
 *
 * Stack model: the undo stack holds the seeded initial schema plus
 * every captured (post-change) schema, in order — its top is
 * always the schema the builder's change event last produced.
 * `undo()` therefore pops the current snapshot onto the redo stack
 * and returns the one beneath it (the state to restore); `redo()`
 * is the mirror image. A new capture truncates the redo branch.
 */

/** The documented BLD-04 bound: the last 50 actions. */
export const MAX_HISTORY = 50;

/**
 * The debounce window. One user action (a drag-drop, a keystroke
 * burst) can emit several `change` events; 300 ms of quiet
 * coalesces them into a single snapshot.
 */
export const DEFAULT_DEBOUNCE_MS = 300;

/** Structured-clone a snapshot so history can never alias live state. */
function clone<T>(schema: T): T {
  return structuredClone(schema);
}

/** Structural equality over JSON-shaped data (schemas are JSON). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every(
    (key) =>
      key in b &&
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
  );
}

/**
 * Debounced schema-snapshot history with a bounded undo/redo
 * ring buffer.
 */
export class SchemaHistory<T = Record<string, unknown>> {
  /** Captured states in order; the top is the most recent snapshot. */
  private readonly undoStack: T[] = [];

  /** States undone from; the top is the nearest redo target. */
  private readonly redoStack: T[] = [];

  /** The schema awaiting the debounce window, if a burst is open. */
  private pending: T | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  /**
   * Queue a snapshot of `schema` (the schema the change event
   * carried). Repeated captures inside the debounce window
   * overwrite the pending snapshot — a burst is one entry.
   */
  capture(schema: T): void {
    this.pending = clone(schema);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }
  }

  /**
   * Push the initial schema immediately (no debounce). Seeding is
   * what makes the first captured change undoable: the history
   * then holds [initial, firstChange], so undo can return to the
   * initial schema.
   */
  seed(schema: T): void {
    this.undoStack.push(clone(schema));
    this.trim();
    this.redoStack.length = 0;
  }

  /**
   * Undo the last captured change. Returns the snapshot to
   * restore (`builder.setForm(snapshot)`), or `null` at the
   * beginning of the history.
   *
   * `current` is the caller's live schema: when it has diverged
   * from the last captured snapshot (a change that bypassed
   * capture, e.g. a template load), it is adopted as a new
   * snapshot first so undo still reverses the caller's actual
   * state.
   */
  undo(current: T): T | null {
    this.flushPending();
    this.adoptCurrent(current);
    if (this.undoStack.length < 2) {
      return null;
    }
    const currentSnapshot = this.undoStack.pop() as T;
    this.redoStack.push(currentSnapshot);
    return this.undoStack[this.undoStack.length - 1];
  }

  /**
   * Redo a previously undone change. Returns the snapshot to
   * restore, or `null` at the end of the history.
   */
  redo(current: T): T | null {
    this.flushPending();
    this.adoptCurrent(current);
    if (this.redoStack.length === 0) {
      return null;
    }
    const next = this.redoStack.pop() as T;
    this.undoStack.push(next);
    return next;
  }

  /** An undo target exists (a captured change is reversible). */
  canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  /** A redo target exists (an undo is reversible). */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * The most recent captured snapshot — the schema the change
   * event last produced. Read-only observability hook (the spike's
   * deep-equality assertion reads this to compare against
   * `builder.schema`).
   */
  latest(): T | null {
    if (this.undoStack.length === 0) {
      return null;
    }
    return clone(this.undoStack[this.undoStack.length - 1]);
  }

  /** Flush a pending burst immediately (used by undo/redo so a
   *  just-made change is not lost from history). */
  private flushPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.flush();
    }
  }

  private flush(): void {
    this.timer = null;
    if (this.pending === null) {
      return;
    }
    const snapshot = this.pending;
    this.pending = null;
    this.undoStack.push(snapshot);
    this.trim();
    // A new capture invalidates the redo branch: redo only makes
    // sense along the path that was undone.
    this.redoStack.length = 0;
  }

  /**
   * Adopt the caller's live schema when it diverges from the last
   * captured snapshot, so undo/redo reverse the caller's actual
   * state rather than a stale one. No-op on an empty history.
   */
  private adoptCurrent(current: T): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top === undefined || deepEqual(top, current)) {
      return;
    }
    this.undoStack.push(clone(current));
  }

  /** The ring buffer bound: evict the oldest entry beyond 50. */
  private trim(): void {
    while (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
  }
}
