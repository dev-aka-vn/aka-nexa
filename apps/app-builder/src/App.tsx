/**
 * S1 spike shell — the minimal React 19 chrome the
 * spike needs and every later plan builds on:
 *
 *  - the FormIO builder mount (FormioBuilderField)
 *    with its undo/redo toolbar (BLD-04's surface),
 *  - a read-only preview pane (Formio.createForm,
 *    the FRM-09 render path) carrying the FRM-05
 *    min/max boundary pair, the EditGrid, and the
 *    hidden-label field the template-port assertion
 *    reads,
 *  - a clearly-labelled spike-only debug handle
 *    (`window.__SPIKE__`) the Playwright spec reads
 *    to assert the change-event wiring and the
 *    5.x component shapes.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { Ref } from 'react';
import { FormioBuilderField } from './form-designer/FormioBuilderField';
import type { FormioBuilderHandle } from './form-designer/FormioBuilderField';
import {
  REPRESENTATIVE_SCHEMA,
  REPRESENTATIVE_SUBMISSION,
} from './form-designer/representativeSchema';
import { registerPortedBootstrap5Templates } from './form-designer/bootstrap5Templates';

/**
 * The subset of the FormIO form instance (the
 * `Formio.createForm` result) the spike's e2e reads.
 */
export interface SpikeFormHandle {
  getComponent(path: string): unknown;
  setSubmission(submission: unknown): Promise<unknown>;
  readonly isReady: boolean;
}

/** The preview pane's imperative surface. */
interface PreviewPaneHandle {
  getForm(): SpikeFormHandle | null;
}

/**
 * The spike-only debug handle the Playwright spec
 * evaluates against. Deliberately window-global and
 * deliberately marked: it is observability for the
 * spike, not a production API, and later plans
 * replace it with real designer chrome.
 */
export interface SpikeDebugHandle {
  /** The mounted builder's current schema (`builder.schema`). */
  getSchema(): Record<string, unknown> | null;
  /** The mounted builder instance (spike-only introspection). */
  getBuilder(): FormioBuilderHandle['builder'];
  /** The builder's snapshot history. */
  getHistory(): {
    latest(): Record<string, unknown> | null;
    canUndo(): boolean;
    canRedo(): boolean;
  } | null;
  /** The preview pane's FormIO form instance, once ready. */
  getPreviewForm(): SpikeFormHandle | null;
}

declare global {
  interface Window {
    __SPIKE__?: SpikeDebugHandle;
  }
}

function installSpikeDebug(handle: SpikeDebugHandle): void {
  window.__SPIKE__ = handle;
}

/** The FormIO form namespace surface the preview pane uses. */
interface FormioNamespace {
  createForm: (
    element: HTMLElement,
    form: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<SpikeFormHandle>;
  Templates: {
    extendTemplate: (name: string, template: Record<string, unknown>) => void;
  };
}

/**
 * The preview pane (FRM-09's render path, pre-view).
 * Mounts `Formio.createForm` with the representative
 * schema and a one-row submission, behind the same
 * guarded dynamic import as the builder (Pattern 1).
 */
function PreviewPane({ ref }: { ref?: Ref<PreviewPaneHandle> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<SpikeFormHandle | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof document === 'undefined') {
        return;
      }
      const { Formio } = (await import('@formio/js')) as {
        Formio: FormioNamespace;
      };
      registerPortedBootstrap5Templates(Formio);
      if (cancelled || !containerRef.current) {
        return;
      }
      const form = await Formio.createForm(
        containerRef.current,
        REPRESENTATIVE_SCHEMA,
        {},
      );
      if (cancelled) {
        return;
      }
      // One EditGrid row, so `validateRow` has a live row.
      await form.setSubmission(REPRESENTATIVE_SUBMISSION);
      formRef.current = form;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      formRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      getForm: () => formRef.current,
    }),
    [],
  );

  return (
    <section
      className="spike-preview"
      data-testid="spike-preview"
      data-ready={ready ? 'true' : 'false'}
    >
      <h2>Preview — 5.x shape verification</h2>
      <div ref={containerRef} data-testid="spike-preview-form" />
    </section>
  );
}

/** The spike shell. */
export function App() {
  const builderFieldRef = useRef<FormioBuilderHandle>(null);
  const previewPaneRef = useRef<PreviewPaneHandle>(null);

  const handleUndo = useCallback(async () => {
    await builderFieldRef.current?.undo();
  }, []);

  const handleRedo = useCallback(async () => {
    await builderFieldRef.current?.redo();
  }, []);

  useEffect(() => {
    installSpikeDebug({
      getSchema: () => builderFieldRef.current?.builder?.schema ?? null,
      getBuilder: () => builderFieldRef.current?.builder ?? null,
      getHistory: () => builderFieldRef.current?.history ?? null,
      getPreviewForm: () => previewPaneRef.current?.getForm() ?? null,
    });
  }, []);

  return (
    <div className="spike-shell">
      <header className="spike-header">
        <h1>S1 spike — FormIO 5.6.1 builder in the React 19 shell</h1>
        <p>
          Drag-and-drop form design with 50-action snapshot undo/redo
          (BLD-04), the 5.x component shapes, and the Bootstrap-5
          template port.
        </p>
      </header>
      <div className="spike-toolbar" role="toolbar" aria-label="Form designer">
        <button
          type="button"
          data-testid="undo-button"
          onClick={() => {
            void handleUndo();
          }}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="redo-button"
          onClick={() => {
            void handleRedo();
          }}
        >
          Redo
        </button>
      </div>
      <main className="spike-main">
        <FormioBuilderField
          ref={builderFieldRef}
          schema={REPRESENTATIVE_SCHEMA}
        />
        <PreviewPane ref={previewPaneRef} />
      </main>
    </div>
  );
}
