/**
 * The template gallery's tag filter
 * (D-105, D-107).
 *
 * The curated tag vocabulary is
 * **frozen server-side**
 * (`packages/domain` `tag-set.ts`,
 * D-107) — the filter renders exactly
 * the enumerated set, no free-text
 * entry, so the filter can never offer a
 * tag the platform does not serve. The
 * SPA carries the vocabulary
 * structurally (`api/templates.ts`);
 * it never imports `@akane/domain`
 * (the browser bundle must not carry
 * the Mongo driver).
 */

import type { ReactElement } from 'react';

import {
  PLATFORM_TAGS,
  type PlatformTag,
} from '../api/templates.js';

export interface TagFilterProps {
  /** The active tag; `null` is "all". */
  readonly active: PlatformTag | null;
  /** Fired when the active tag changes. */
  readonly onSelect: (
    tag: PlatformTag | null,
  ) => void;
}

/**
 * The tag chips: "All" plus the frozen
 * vocabulary. The active chip is
 * primary, the rest ghost — the
 * mockup's filter vocabulary.
 */
export function TagFilter({
  active,
  onSelect,
}: TagFilterProps): ReactElement {
  return (
    <div
      className="od-cluster"
      data-testid="tag-filter"
      style={{ '--od-gap': '8px' } as never}
      role="group"
      aria-label="Filter templates by tag"
    >
      <button
        type="button"
        className={`btn btn-sm ${
          active === null ? 'btn-primary' : 'btn-ghost'
        }`}
        data-testid="tag-all"
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {PLATFORM_TAGS.map((tag) => (
        <button
          key={tag}
          type="button"
          className={`btn btn-sm ${
            active === tag ? 'btn-primary' : 'btn-ghost'
          }`}
          data-testid={`tag-${tag}`}
          onClick={() => onSelect(tag)}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
