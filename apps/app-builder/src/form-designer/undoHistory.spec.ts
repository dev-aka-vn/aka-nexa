/**
 * SchemaHistory unit specs (BLD-04, RESEARCH Pattern 2) plus the
 * Pitfall 1 negative control.
 *
 * Why these tests exist:
 *
 *  - BLD-04 needs a 50-action undo/redo. `@formio/js` 5.6.1 exposes
 *    **no** builder undo/redo API (the only `undo` symbol in the
 *    package is `Select.undoValueTyping`, an internal select-input
 *    method), so the history is app-built: debounced `builder.schema`
 *    snapshots restored with `builder.setForm()`. These specs pin the
 *    four mechanics the plan's Test 3 names — burst coalescing, the
 *    50-entry ring bound, redo clearing on new capture, and null at
 *    either end.
 *  - Test 4 is the negative control for Pattern 1: `@formio/js`
 *    touches `document` at module evaluation time, so a *static*
 *    import in any Node-executed file throws `ReferenceError:
 *    document is not defined` and takes the whole file with it. A
 *    static import here would break this spec file itself, so the
 *    control reproduces the same module-evaluation failure through a
 *    dynamic import at test time — proving the guard is mandatory,
 *    not decorative. If `@formio/js` ever becomes Node-safe, this
 *    spec fails loudly and the guarded-import pattern must be
 *    re-evaluated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_HISTORY, SchemaHistory } from './undoHistory';

describe('SchemaHistory (BLD-04 — Pattern 2 schema-snapshot undo/redo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a 300 ms burst of 5 changes into ONE snapshot', () => {
    const history = new SchemaHistory<{ components: string[] }>();
    const initial = { components: [] };
    history.seed(initial);

    // A burst of five changes inside the debounce window.
    for (let i = 1; i <= 5; i += 1) {
      history.capture({ components: [`field-${i}`] });
    }
    // Not flushed yet — the debounce is still running.
    expect(history.canUndo()).toBe(false);

    vi.advanceTimersByTime(300);

    // One snapshot for the whole burst: a single undo step reverses
    // all five changes back to the seeded initial schema.
    expect(history.canUndo()).toBe(true);
    expect(history.undo({ components: ['field-5'] })).toEqual(initial);
  });

  it('holds at most 50 entries — the 51st capture evicts the oldest', () => {
    const history = new SchemaHistory<{ v: number }>();

    for (let i = 1; i <= 51; i += 1) {
      history.capture({ v: i });
      vi.advanceTimersByTime(300);
    }

    // Walk the history backwards from the current schema. At most 50
    // entries exist, so the oldest capture (v:1) must have been
    // evicted by the 51st, and v:2 is the new floor.
    const reachable: number[] = [];
    let current = { v: 51 };
    let undone: { v: number } | null;
    while ((undone = history.undo(current)) !== null) {
      reachable.push(undone.v);
      current = undone;
    }

    expect(reachable.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(reachable).not.toContain(1);
    expect(reachable).toContain(2);
  });

  it('clears the redo stack when a new capture lands', () => {
    const history = new SchemaHistory<{ v: number }>();
    history.seed({ v: 0 });
    history.capture({ v: 1 });
    vi.advanceTimersByTime(300);

    expect(history.undo({ v: 1 })).toEqual({ v: 0 });
    expect(history.canRedo()).toBe(true);

    // A new capture invalidates the redo branch.
    history.capture({ v: 2 });
    vi.advanceTimersByTime(300);
    expect(history.canRedo()).toBe(false);
  });

  it('returns null at either end of the history', () => {
    const history = new SchemaHistory<{ v: number }>();

    // Nothing captured at all.
    expect(history.undo({ v: 0 })).toBeNull();
    expect(history.redo({ v: 0 })).toBeNull();

    history.seed({ v: 0 });
    history.capture({ v: 1 });
    vi.advanceTimersByTime(300);

    // At the beginning: one undo, then null.
    expect(history.undo({ v: 1 })).toEqual({ v: 0 });
    expect(history.undo({ v: 0 })).toBeNull();

    // At the end: one redo, then null.
    expect(history.redo({ v: 0 })).toEqual({ v: 1 });
    expect(history.redo({ v: 1 })).toBeNull();
  });

  it('exposes the most recent captured snapshot for round-trip verification', () => {
    const history = new SchemaHistory<{ v: number }>();
    expect(history.latest()).toBeNull();

    history.seed({ v: 0 });
    history.capture({ v: 1 });
    vi.advanceTimersByTime(300);

    // The captured snapshot is the schema the change event carried.
    expect(history.latest()).toEqual({ v: 1 });
  });
});

describe('Pitfall 1 negative control — @formio/js must never be imported in Node', () => {
  it('a static import of @formio/js fails with ReferenceError: document is not defined', async () => {
    // A *static* `import { Formio } from '@formio/js'` would fail at
    // module-load time and take this whole spec file with it — which is
    // precisely the failure mode the guarded dynamic import (Pattern 1)
    // exists to prevent. The dynamic import below reproduces the same
    // module-evaluation failure at test time.
    await expect(import('@formio/js')).rejects.toThrow(/document is not defined/);
  });
});
