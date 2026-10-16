/**
 * Form designer mount (RESEARCH Patterns 1 + 4).
 *
 * Pattern 1 — browser-guarded `@formio/js` integration:
 * `@formio/js` evaluates `document` at module scope, so a
 * static import in any Node-executed file throws
 * `ReferenceError: document is not defined` (Pitfall 1,
 * asserted as the negative control in undoHistory.spec.ts).
 * The engine is therefore imported dynamically, inside a
 * DOM check, never at module scope — this file stays
 * importable from Node.
 *
 * Pattern 4 — container-as-leaf mounting: FormIO owns the
 * container's DOM. The container is a leaf React never
 * renders children into; letting React reconcile inside a
 * FormIO-controlled subtree destroys builder state
 * silently (Pitfall 4).
 *
 * BLD-04 — the `change` event is wired to a SchemaHistory
 * (Pattern 2): debounced `builder.schema` snapshots,
 * restored with `builder.setForm()`. Never monkey-patch
 * `builder.instance` (Pitfall 3 — FormIO 5.6.1 exposes no
 * builder undo/redo API).
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import type { Ref } from 'react';
import {
  registerPortedBootstrap5Templates,
} from './bootstrap5Templates';
// The scoped Bootstrap 5 sheet (G-06-6): the FormIO template set emits
// Bootstrap class names but ships no Bootstrap stylesheet, so the canvas
// renders unstyled HTML without this. Scoped to `formio-scope` — it reaches
// the FormIO-owned subtree only, never the app chrome. Static, at module
// scope: unlike the engine module itself this is plain CSS, so the
// Pattern-1 browser guard does not apply to it. Distinct from the guarded
// dynamic import of the engine's own stylesheet further below — that one
// stays exactly as it is.
import './formio-scope.css';
// The chrome-leak guards (see the file header): the app chrome's global
// `.btn` — in particular `min-height: 40px` — stretches FormIO's 18px
// component hover toolbar into 40px-tall slabs. This import must stay
// after `formio-scope.css` so the guards win the cascade inside the
// scope root.
import './formio-overrides.css';
import { SchemaHistory } from './undoHistory';

/** The builder surface the designer consumes (documented public API). */
export interface FormioBuilderInstance {
  /** Always the current form definition. */
  readonly schema: Record<string, unknown>;
  /** Fires with the current schema on every change. */
  on(event: 'change', callback: (form: Record<string, unknown>) => void): void;
  /** Restores a form definition (the undo/redo restore path). */
  setForm(form: Record<string, unknown>): Promise<void>;
}

/** The `@formio/js` namespace surface this component uses. */
interface FormioNamespace {
  builder: (
    element: HTMLElement,
    form: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<FormioBuilderInstance>;
  Templates: {
    extendTemplate: (name: string, template: Record<string, unknown>) => void;
  };
}

/** The imperative surface the shell (and the spike) drive. */
export interface FormioBuilderHandle {
  /** The mounted FormIO builder instance, once mounted. */
  readonly builder: FormioBuilderInstance | null;
  /** The snapshot history the change event feeds. */
  readonly history: SchemaHistory<Record<string, unknown>>;
  /** Undo the last captured change; restores via `builder.setForm`. */
  undo(): Promise<boolean>;
  /** Redo the last undone change; restores via `builder.setForm`. */
  redo(): Promise<boolean>;
}

export interface FormioBuilderFieldProps {
  /** The form definition to mount the builder with. */
  schema: Record<string, unknown>;
  /** Called with the current schema on every builder change. */
  onChange?: (schema: Record<string, unknown>) => void;
  /**
   * Called whenever the undo/redo availability
   * changes: after a captured change (always
   * undoable — `undo()` flushes the pending
   * snapshot — and redo-invalidated), and after
   * every undo/redo. The shell's toolbar renders
   * these as the buttons' disabled states.
   */
  onHistoryChange?: (state: {
    canUndo: boolean;
    canRedo: boolean;
  }) => void;
  /** React 19: `ref` is a regular prop on function components. */
  ref?: Ref<FormioBuilderHandle>;
}

export function FormioBuilderField({
  schema,
  onChange,
  onHistoryChange,
  ref,
}: FormioBuilderFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const builderRef = useRef<FormioBuilderInstance | null>(null);

  /**
   * One history for the mount's lifetime. Seeded with the
   * initial schema when the builder mounts, so the first
   * captured change is undoable.
   */
  const history = useMemo(
    () => new SchemaHistory<Record<string, unknown>>(),
    [],
  );

  /**
   * While a `setForm()` restore is in flight, the builder
   * fires its own `change` event — re-capturing the
   * restored snapshot would corrupt the history. The lock
   * suppresses capture (and the onChange callback, which
   * the restore path invokes itself) for the restore.
   */
  const restoreLock = useRef(false);

  /** Latest-callback ref so the mount-once effect always calls the current handler. */
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /** Latest-callback ref for the history-availability handler. */
  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;

  /**
   * Restores `snapshot` through the documented
   * `builder.setForm()` API and reports it to `onChange`.
   */
  const restore = useCallback(
    async (snapshot: Record<string, unknown>): Promise<boolean> => {
      const builder = builderRef.current;
      if (!builder) {
        return false;
      }
      restoreLock.current = true;
      try {
        await builder.setForm(snapshot);
        // Let the change event `setForm()` emits settle inside
        // the lock before re-arming capture.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        onChangeRef.current?.(snapshot);
      } finally {
        restoreLock.current = false;
      }
      return true;
    },
    [],
  );

  const undo = useCallback(async (): Promise<boolean> => {
    const builder = builderRef.current;
    if (!builder) {
      return false;
    }
    const snapshot = history.undo(builder.schema);
    if (snapshot === null) {
      return false;
    }
    onHistoryChangeRef.current?.({
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    });
    return restore(snapshot);
  }, [history, restore]);

  const redo = useCallback(async (): Promise<boolean> => {
    const builder = builderRef.current;
    if (!builder) {
      return false;
    }
    const snapshot = history.redo(builder.schema);
    if (snapshot === null) {
      return false;
    }
    onHistoryChangeRef.current?.({
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
    });
    return restore(snapshot);
  }, [history, restore]);

  useImperativeHandle(
    ref,
    () => ({
      get builder() {
        return builderRef.current;
      },
      get history() {
        return history;
      },
      undo,
      redo,
    }),
    [history, undo, redo],
  );

  useEffect(() => {
    let cancelled = false;

    // G-06-6's scope boundary vs FormIO's dialog: the builder's
    // component-settings dialog mounts at document.body — outside
    // the `.formio-scope` mount container — so the scoped Bootstrap
    // sheet never reached it and the dialog's form controls rendered
    // with browser-default geometry ("broken style": 2px-inset
    // borders, Arial, no grid). This observer tags each dialog with
    // the scope class as it appears, putting the dialog's subtree
    // under the same scoped sheet as the canvas. The class carries
    // no behaviour of its own beyond the sheet's selectors, and the
    // scoped sheet's `.formio-scope .btn` (0,2,0) outranks the app
    // chrome's global `.btn` (0,1,0), so the dialog styles as
    // Bootstrap inside exactly where the canvas does.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) {
            continue;
          }
          const dialogs = node.matches('.formio-dialog')
            ? [node, ...node.querySelectorAll('.formio-dialog')]
            : [...node.querySelectorAll('.formio-dialog')];
          for (const dialog of dialogs) {
            dialog.classList.add('formio-scope');
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    (async () => {
      // Pattern 1's guard: never touch the FormIO module
      // outside a DOM check. A Node import of this module
      // must remain a no-op (the negative control proves the
      // alternative fails).
      if (typeof document === 'undefined') {
        return;
      }
      const { Formio } = (await import('@formio/js')) as {
        Formio: FormioNamespace;
      };
      // The engine's stylesheet, same guarded dynamic
      // import as the renderer precedent (edit.ts:312).
      await import('@formio/js/dist/formio.full.min.css');

      // The S1 template port: register the ported
      // Bootstrap-4-era label template against the active
      // (bootstrap5) template set before anything renders.
      registerPortedBootstrap5Templates(Formio);

      if (cancelled || !containerRef.current) {
        return;
      }
      const builder = await Formio.builder(
        containerRef.current,
        (schema ?? {}) as Record<string, unknown>,
        {},
      );
      if (cancelled) {
        return;
      }
      builderRef.current = builder;
      history.seed((schema ?? {}) as Record<string, unknown>);
      builder.on('change', () => {
        if (restoreLock.current) {
          return;
        }
        const current = builder.schema as Record<string, unknown>;
        history.capture(current);
        // A captured change is always undoable (undo
        // flushes the pending snapshot) and always
        // invalidates the redo branch.
        onHistoryChangeRef.current?.({
          canUndo: true,
          canRedo: false,
        });
        onChangeRef.current?.(current);
      });
    })();

    return () => {
      cancelled = true;
      observer.disconnect();
      builderRef.current = null;
      // FormIO owns this DOM (Pitfall 4) — clear it on
      // unmount so a remount starts from an empty leaf.
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
    // The designer mounts once and owns the schema for the
    // mount's lifetime (the shell passes a constant
    // representative schema); the history and restore path
    // are stable references.
  }, [history]);

  // Container-as-leaf (Pitfall 4): no children — React never
  // reconciles inside the FormIO-controlled subtree.
  // The `formio-scope` class is the G-06-6 scope root: the scoped
  // Bootstrap sheet's rules are reachable only beneath it, so it sits
  // on this FormIO mount container — never on the page shell, the tabs,
  // or the toolbar.
  return (
    <div
      ref={containerRef}
      className="formio-builder-host formio-scope"
      data-testid="formio-builder-host"
    />
  );
}
