/**
 * The FRM-09 sandbox — the preview's submission
 * store.
 *
 * An in-memory submission buffer keyed to the
 * preview session. The store deliberately has
 * **no HTTP surface at all**: no API client, no
 * fetch, no URL. A preview submission therefore
 * cannot reach the real submissions collection —
 * the isolation is structural, not a runtime
 * check that could fail.
 *
 * The preview pane enforces the other half of
 * the guarantee: the preview form mounts with
 * FormIO's `nosubmit` flag, so the engine's own
 * submission path (the HTTP POST a real form
 * would make) is never entered (Webform.js: the
 * `nosubmit` branch resolves without a request).
 */

/** One sandboxed preview submission. */
export interface SandboxedSubmission {
  /** The submission data the preview form carried. */
  readonly data: unknown;
  /** ISO capture time. */
  readonly at: string;
}

export class SubmissionSandbox {
  private readonly buffer: SandboxedSubmission[] = [];

  /** Buffer a preview submission (newest last). */
  record(data: unknown): void {
    this.buffer.push({ data, at: new Date().toISOString() });
  }

  /** The buffered submissions, newest last (a copy). */
  get submissions(): readonly SandboxedSubmission[] {
    return [...this.buffer];
  }

  /** How many preview submissions are buffered. */
  get count(): number {
    return this.buffer.length;
  }

  /** Empty the buffer (the next preview session starts clean). */
  clear(): void {
    this.buffer.length = 0;
  }
}
