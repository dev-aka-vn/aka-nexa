import { describe, expect, it } from 'vitest';

import {
  jsonDraftIsDirty,
  shortcutMayPublish,
} from './publishGuards.js';

describe('jsonDraftIsDirty (BLD-06)', () => {
  it('is false when the draft matches the persisted text, including trailing-whitespace differences', () => {
    expect(jsonDraftIsDirty('{"a":1}', '{"a":1}')).toBe(false);
    expect(jsonDraftIsDirty('{"a":1}  \n', '{"a":1}')).toBe(false);
    expect(jsonDraftIsDirty('{"a":1}', '{"a":1}\n\n')).toBe(false);
  });

  it('is true when a single character is added, removed, or changed', () => {
    // Added.
    expect(jsonDraftIsDirty('{"a":11}', '{"a":1}')).toBe(true);
    // Removed.
    expect(jsonDraftIsDirty('{"a":}', '{"a":1}')).toBe(true);
    // Changed.
    expect(jsonDraftIsDirty('{"a":2}', '{"a":1}')).toBe(true);
  });

  it('compares by content, not by identity', () => {
    // Two independently constructed strings
    // with identical content are not dirty —
    // the predicate never consults reference
    // identity.
    const left = ['{"a":', '1}'].join('');
    const right = '{"a":1}'.split('').join('');
    expect(jsonDraftIsDirty(left, right)).toBe(false);
  });
});

describe('shortcutMayPublish (BLD-06)', () => {
  it('is true only when the state is neither dirty nor saving', () => {
    expect(
      shortcutMayPublish({ dirty: false, saving: false }),
    ).toBe(true);
    expect(
      shortcutMayPublish({ dirty: true, saving: false }),
    ).toBe(false);
    expect(
      shortcutMayPublish({ dirty: false, saving: true }),
    ).toBe(false);
  });

  it('is false when the state is both dirty and saving', () => {
    expect(
      shortcutMayPublish({ dirty: true, saving: true }),
    ).toBe(false);
  });
});
