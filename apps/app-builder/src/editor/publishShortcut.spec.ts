import { describe, expect, it } from 'vitest';

import { isPublishShortcut } from './publishShortcut.js';

describe('isPublishShortcut (BLD-06)', () => {
  it('accepts the chord under either modifier and either case', () => {
    expect(
      isPublishShortcut({ ctrlKey: true, metaKey: false, key: 's' }),
    ).toBe(true);
    expect(
      isPublishShortcut({ ctrlKey: true, metaKey: false, key: 'S' }),
    ).toBe(true);
    expect(
      isPublishShortcut({ ctrlKey: false, metaKey: true, key: 's' }),
    ).toBe(true);
    expect(
      isPublishShortcut({ ctrlKey: false, metaKey: true, key: 'S' }),
    ).toBe(true);
  });

  it('rejects everything that is not the chord — no near-miss publishes', () => {
    // A bare `s` types a letter; it must not publish.
    expect(
      isPublishShortcut({ ctrlKey: false, metaKey: false, key: 's' }),
    ).toBe(false);
    // A different chord with the modifier held.
    expect(
      isPublishShortcut({ ctrlKey: true, metaKey: false, key: 'p' }),
    ).toBe(false);
    // Both modifiers held is still the chord — and an
    // empty key (a modifier pressed alone) is not.
    expect(
      isPublishShortcut({ ctrlKey: true, metaKey: true, key: '' }),
    ).toBe(false);
  });
});
