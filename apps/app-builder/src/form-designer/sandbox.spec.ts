/**
 * The FRM-09 sandbox unit spec.
 *
 * The preview's submission store is an in-memory
 * buffer keyed to the preview session. The store
 * has no HTTP surface at all — no client, no
 * fetch, no URL — so a preview submission
 * structurally cannot reach the real submissions
 * collection. These specs pin that isolation:
 *
 *  1. A recorded submission lands in the buffer,
 *     newest last, with the capture time.
 *  2. Recording never touches `fetch` — the store
 *     performs no network I/O of any kind.
 *  3. `submissions` is a copy (the caller cannot
 *     mutate the buffer through it) and `clear()`
 *     empties it.
 *
 * Node-safe by construction: `sandbox.ts` imports
 * nothing (Pattern 1 keeps every `@formio/js`
 * touch out of Node-executed files).
 */

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  SubmissionSandbox,
  type SandboxedSubmission,
} from './sandbox';

describe('SubmissionSandbox (FRM-09)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records submissions in the buffer, newest last, with a capture time', () => {
    const sandbox = new SubmissionSandbox();
    expect(sandbox.count).toBe(0);
    expect(sandbox.submissions).toHaveLength(0);

    const first = { data: { fullName: 'Jane Doe' } };
    const second = { data: { fullName: 'John Doe' } };
    sandbox.record(first.data);
    sandbox.record(second.data);

    expect(sandbox.count).toBe(2);
    const submissions = sandbox.submissions;
    expect(submissions).toHaveLength(2);
    expect(submissions[0].data).toEqual(first.data);
    expect(submissions[1].data).toEqual(second.data);
    // Newest last, and every entry carries its capture time.
    expect(submissions[0].at).toBeDefined();
    expect(() => new Date(submissions[0].at).toISOString()).not.toThrow();
  });

  it('never touches the network — recording performs no fetch', () => {
    const sandbox = new SubmissionSandbox();
    // Node 24 ships a global fetch; the sandbox must
    // never call it (the submissions API is only
    // reachable through the API client, which the
    // store does not hold).
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    sandbox.record({ fullName: 'Jane Doe' });
    sandbox.record({ quantity: 5 });
    expect(sandbox.count).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('exposes submissions as a copy and clear() empties the buffer', () => {
    const sandbox = new SubmissionSandbox();
    sandbox.record({ fullName: 'Jane Doe' });

    const view = sandbox.submissions as SandboxedSubmission[];
    // Mutating the returned view cannot reach the
    // buffer (the store hands out a copy).
    view.pop();
    expect(sandbox.count).toBe(1);

    sandbox.clear();
    expect(sandbox.count).toBe(0);
    expect(sandbox.submissions).toHaveLength(0);
  });
});
