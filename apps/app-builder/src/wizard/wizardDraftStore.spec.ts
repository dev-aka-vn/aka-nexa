/**
 * The wizard snapshot store's unit spec
 * (G-06-7's designer-return-path closure).
 *
 * The store is the session memory the
 * designer detour resumes from: the wizard
 * writes its position and in-progress inputs
 * on every change, the remount hydrates
 * from it, and finishing clears it. These
 * specs pin the guard behaviours the resume
 * depends on — a corrupt entry must read as
 * absent, never as a broken wizard:
 *
 *  1. Reads are keyed by app id.
 *  2. Malformed payloads read as absent.
 *  3. Out-of-range steps read as absent.
 *  4. Clearing is per-app and complete.
 *  5. Values round-trip by content.
 *  6. Every function is a no-op without storage.
 *
 * Node-environment by construction: every
 * call takes an in-memory double through the
 * injectable storage parameter, so the spec
 * never touches the DOM.
 */

import { describe, expect, it } from 'vitest';

import {
  clearWizardSnapshot,
  readWizardSnapshot,
  writeWizardSnapshot,
  type SnapshotStorage,
  type WizardSnapshot,
} from './wizardDraftStore';

/** An in-memory storage double — no DOM. */
interface InspectableStorage extends SnapshotStorage {
  keys(): string[];
}

function fakeStorage(
  initial: Record<string, string> = {},
): InspectableStorage {
  const data = new Map<string, string>(
    Object.entries(initial),
  );
  return {
    getItem: (key: string): string | null =>
      data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      data.set(key, value);
    },
    removeItem: (key: string): void => {
      data.delete(key);
    },
    keys: (): string[] => [...data.keys()],
  };
}

/** A representative in-progress snapshot. */
function snapshot(
  appId = 'hr-leave-request',
  step = 3,
): WizardSnapshot {
  return {
    appId,
    step,
    basics: {
      name: 'Leave Request',
      appId,
      description: 'Request and approve leave',
    },
    triggers: {
      triggers: [
        {
          kind: 'intent',
          intent: 'request_leave',
          example: 'I want to take leave',
          command: '',
        },
      ],
    },
    rbac: {
      assignments: [{ user: 'manager@example.com', role: 'manager' }],
    },
    routing: { mode: 'internal', connectorId: '' },
  };
}

describe('wizardDraftStore', () => {
  it('returns the written snapshot for the same app id, and null for a different app id', () => {
    const storage = fakeStorage();
    writeWizardSnapshot(snapshot('hr-leave-request'), storage);

    const resumed = readWizardSnapshot('hr-leave-request', storage);
    expect(resumed).not.toBeNull();
    expect(resumed?.appId).toBe('hr-leave-request');
    expect(resumed?.step).toBe(3);

    expect(
      readWizardSnapshot('hr-expense-claim', storage),
    ).toBeNull();
  });

  it('returns null rather than throwing when the stored payload is not the expected shape', () => {
    // Each malformed payload reads as absent — a
    // bare string, an array, or an object
    // missing the step or one of the four
    // value objects.
    const malformed: unknown[] = [
      'not-json{{{',
      JSON.stringify('just a string'),
      JSON.stringify([1, 2, 3]),
      JSON.stringify(null),
      JSON.stringify({
        version: 1,
        appId: 'hr-leave-request',
        basics: {},
        triggers: {},
        rbac: {},
        routing: {},
      }),
      JSON.stringify({
        version: 1,
        appId: 'hr-leave-request',
        step: 2,
        basics: {},
        triggers: {},
        rbac: {},
      }),
      JSON.stringify({
        version: 1,
        appId: 'hr-leave-request',
        step: 'form',
        basics: {},
        triggers: {},
        rbac: {},
        routing: {},
      }),
    ];
    for (const payload of malformed) {
      // Corrupt the entry behind the store's
      // back: write a valid snapshot, then
      // overwrite its raw payload.
      const storage = fakeStorage();
      writeWizardSnapshot(snapshot('hr-leave-request'), storage);
      storage.setItem(storage.keys()[0] as string, payload as string);
      expect(
        readWizardSnapshot('hr-leave-request', storage),
      ).toBeNull();
    }
  });

  it('returns null when the step is not a finite integer inside the five wizard steps', () => {
    const steps: unknown[] = [-1, 5, 99, 1.5, NaN, Infinity, '3', null];
    for (const step of steps) {
      const storage = fakeStorage();
      writeWizardSnapshot(snapshot('hr-leave-request', 2), storage);
      storage.setItem(
        storage.keys()[0] as string,
        JSON.stringify({
          version: 1,
          appId: 'hr-leave-request',
          step,
          basics: {},
          triggers: {},
          rbac: {},
          routing: {},
        }),
      );
      expect(
        readWizardSnapshot('hr-leave-request', storage),
      ).toBeNull();
    }
    // Every in-range index hydrates.
    for (let step = 0; step < 5; step += 1) {
      const storage = fakeStorage();
      writeWizardSnapshot(snapshot('hr-leave-request', step), storage);
      expect(
        readWizardSnapshot('hr-leave-request', storage)?.step,
      ).toBe(step);
    }
  });

  it('write then clear reads as null, and clearing one app leaves another app intact', () => {
    const storage = fakeStorage();
    writeWizardSnapshot(snapshot('hr-leave-request'), storage);
    writeWizardSnapshot(snapshot('hr-expense-claim', 1), storage);

    clearWizardSnapshot('hr-leave-request', storage);
    expect(
      readWizardSnapshot('hr-leave-request', storage),
    ).toBeNull();
    expect(
      readWizardSnapshot('hr-expense-claim', storage)?.step,
    ).toBe(1);
  });

  it('round-trips the four value objects by content, not by identity', () => {
    const storage = fakeStorage();
    const written = snapshot('hr-leave-request');
    writeWizardSnapshot(written, storage);

    const resumed = readWizardSnapshot('hr-leave-request', storage);
    expect(resumed).not.toBeNull();
    expect(resumed?.basics).toEqual(written.basics);
    expect(resumed?.triggers).toEqual(written.triggers);
    expect(resumed?.rbac).toEqual(written.rbac);
    expect(resumed?.routing).toEqual(written.routing);
    // Content, not identity: mutating the
    // resumed copy cannot corrupt the store.
    const resumedBasics = resumed?.basics as unknown as {
      name: string;
    };
    resumedBasics.name = 'Mutated';
    expect(
      readWizardSnapshot('hr-leave-request', storage)?.basics,
    ).toEqual(written.basics);
  });

  it('is a no-op when storage is absent — the node-test and server case', () => {
    expect(readWizardSnapshot('hr-leave-request', null)).toBeNull();
    expect(() =>
      writeWizardSnapshot(snapshot('hr-leave-request'), null),
    ).not.toThrow();
    expect(() =>
      clearWizardSnapshot('hr-leave-request', null),
    ).not.toThrow();
  });
});
