/**
 * The sandbox preview pane (FRM-09).
 *
 * Renders the draft form exactly as a signer
 * would see it — `Formio.createForm` over
 * the current builder schema — into a sandbox:
 *
 *  1. The form mounts with FormIO's
 *     `nosubmit` flag, so the engine's own
 *     submission path (the HTTP POST a live
 *     form makes) is never entered
 *     (Webform.js: the `nosubmit` branch
 *     resolves `{saved: false}` without a
 *     request).
 *  2. The form's `submit` event is wired to
 *     the in-memory `SubmissionSandbox` —
 *     the submission data lands in the
 *     buffer, rendered in place below the
 *     form, and structurally cannot reach
 *     the submissions API (the sandbox holds
 *     no HTTP surface at all).
 *
 * The engine is imported behind the same
 * browser guard as the builder (Pattern 1):
 * `@formio/js` evaluates `document` at
 * module scope, so the import is dynamic and
 * DOM-checked, never static.
 */

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { Ref } from 'react';

import {
  registerPortedBootstrap5Templates,
} from './bootstrap5Templates';
// The scoped Bootstrap 5 sheet (G-06-6): the same consumption shape as
// FormioBuilderField — a static module-scope import plus the `formio-scope`
// class on the FormIO mount container below, so the signer-view preview
// renders identically to the builder canvas. The class goes on the mount
// container only — not on the surrounding card, the preview section, or
// the sandbox buffer. The engine's dynamic stylesheet import and the
// ported-template registration stay exactly as they are.
import './formio-scope.css';
import type { SubmissionSandbox } from './sandbox';

/**
 * The subset of the FormIO form instance
 * (the `Formio.createForm` result) the
 * preview consumes.
 */
export interface PreviewFormHandle {
  /** A component by its key/path. */
  getComponent(path: string): unknown;
  /** Set the form's submission data. */
  setSubmission(submission: unknown): Promise<unknown>;
  /** FormIO's no-HTTP-submission flag (FRM-09). */
  nosubmit: boolean;
  /** Wire a FormIO event. */
  on(event: string, callback: (...args: unknown[]) => void): void;
  /** Tear the form down (the re-render path). */
  destroy(): void;
}

/** The imperative surface the shell (and the spec) drive. */
export interface PreviewPaneHandle {
  /** The mounted preview form, once ready. */
  getForm(): PreviewFormHandle | null;
}

/** The `@formio/js` namespace surface the preview uses. */
interface FormioNamespace {
  createForm: (
    element: HTMLElement,
    form: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<PreviewFormHandle>;
  Templates: {
    extendTemplate: (name: string, template: Record<string, unknown>) => void;
  };
}

export interface PreviewPaneProps {
  /** The form definition to render (the draft's schema). */
  schema: Record<string, unknown>;
  /** The FRM-09 sandbox the preview's submissions buffer into. */
  sandbox: SubmissionSandbox;
  /** React 19: `ref` is a regular prop on function components. */
  ref?: Ref<PreviewPaneHandle>;
}

/**
 * The debounce before the preview re-renders
 * after a schema change — a burst of builder
 * changes (a drag-drop) coalesces into one
 * re-mount.
 */
const PREVIEW_DEBOUNCE_MS = 400;

export function PreviewPane({
  schema,
  sandbox,
  ref,
}: PreviewPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<PreviewFormHandle | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * The sandbox is a plain class — recording
   * doesn't re-render on its own. The tick
   * state makes every buffered submission
   * render in place.
   */
  const [bufferTick, setBufferTick] = useState(0);

  useImperativeHandle(
    ref,
    () => ({
      getForm: () => formRef.current,
    }),
    [],
  );

  /**
   * (Re)mount the preview form from `schema`.
   * The previous form is destroyed first —
   * FormIO owns the container's DOM (the
   * container-as-leaf rule, Pitfall 4).
   */
  const mount = useCallback(
    async (formSchema: Record<string, unknown>): Promise<void> => {
      if (typeof document === 'undefined') {
        return;
      }
      formRef.current?.destroy();
      formRef.current = null;
      setReady(false);

      const { Formio } = (await import('@formio/js')) as {
        Formio: FormioNamespace;
      };
      await import('@formio/js/dist/formio.full.min.css');
      registerPortedBootstrap5Templates(Formio);

      const container = containerRef.current;
      if (!container) {
        return;
      }
      // FormIO owns this DOM — clear it so the
      // re-mount starts from an empty leaf.
      container.innerHTML = '';
      const form = await Formio.createForm(
        container,
        formSchema,
        {},
      );

      // FRM-09, half one: the engine's own
      // submission path is disabled — the
      // preview form cannot POST anywhere.
      form.nosubmit = true;
      // FRM-09, half two: submissions are
      // diverted to the in-memory sandbox.
      form.on('submit', (submission: unknown) => {
        sandbox.record(submission);
        setBufferTick((tick) => tick + 1);
      });

      formRef.current = form;
      setReady(true);
    },
    [sandbox],
  );

  // Re-render the preview when the schema
  // changes (debounced — a builder burst is
  // one re-mount).
  const schemaKey = JSON.stringify(schema);
  useEffect(() => {
    const timer = setTimeout(() => {
      void mount(schema);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [schemaKey]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      formRef.current?.destroy();
      formRef.current = null;
    };
  }, []);

  const submissions = sandbox.submissions;
  void bufferTick;

  return (
    <section
      className="card"
      data-testid="designer-preview"
      data-ready={ready ? 'true' : 'false'}
    >
      <div className="card-head">
        <h2>Preview</h2>
        <span className="pill-mono">sandboxed</span>
      </div>
      <div className="card-body">
        <p className="helper">
          The draft form as a signer sees it. Submissions
          land in the sandbox below — never in the real
          submissions collection.
        </p>
        <div
          ref={containerRef}
          className="formio-scope"
          data-testid="designer-preview-form"
        />
        <div
          className="divider"
          hidden={submissions.length === 0}
        />
        <div
          data-testid="sandbox-buffer"
          data-count={String(sandbox.count)}
        >
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>
            Sandbox buffer
          </h3>
          {submissions.length === 0 ? (
            <span className="helper">
              No sandboxed submissions yet.
            </span>
          ) : (
            <div className="stack-list">
              {submissions.map((submission, index) => (
                <div
                  className="list-row"
                  key={`${submission.at}-${index}`}
                  data-testid={`sandbox-submission-${index}`}
                >
                  <span className="icon-tile it-teal">#</span>
                  <div className="lr-main">
                    <div className="lr-t">
                      Submission #{index + 1}
                    </div>
                    <div
                      className="lr-s"
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 12,
                        wordBreak: 'break-all',
                      }}
                    >
                      {JSON.stringify(submission.data)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
