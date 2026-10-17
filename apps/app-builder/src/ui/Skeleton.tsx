/**
 * The loading skeleton (BLD-09).
 *
 * Every async operation (app list, app load, form
 * schema load, template gallery, submissions list)
 * shows a loading skeleton **in the layout of the
 * content it replaces** — never a spinner-only
 * blank. The skeleton renders the content's shape
 * (title bar, text lines, card grid) so the
 * layout does not reflow when the data lands.
 *
 * The styles are self-contained (inline style
 * objects over the mockup's token custom
 * properties — `--surface-2` for the shimmering
 * block, `--line` for the track) so the component
 * introduces no second palette and no tokens.css
 * change.
 */

import type { CSSProperties, ReactElement } from 'react';

/** The content shapes a surface can skeleton. */
export type SkeletonVariant =
  | /** A heading bar + N text lines (lists, detail panes). */
  'text'
  | /** A grid of content cards (the app list, the gallery). */
  'cards'
  | /** A single tall block (the form designer canvas). */
  'block';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  /** Number of text lines (the `text` variant). */
  lines?: number;
  /** Number of cards (the `cards` variant). */
  cards?: number;
  /** An accessible label naming what is loading. */
  label?: string;
}

const shimmer: CSSProperties = {
  background: 'var(--surface-2)',
  borderRadius: 'var(--radius-xs)',
};

/** One shimmering text line. */
function SkeletonLine({
  width,
}: {
  width: string | number;
  /**
   * React's list key. Consumed by React itself —
   * never reaches the rendered output. Optional so
   * the map below can key lines positionally.
   */
  key?: number;
}): ReactElement {
  return (
    <div
      aria-hidden="true"
      style={{ ...shimmer, height: 12, width }}
    />
  );
}

/**
 * A layout-shaped placeholder for content that is
 * still loading. Rendered where the content will
 * be, so the page keeps its shape (BLD-09: never
 * a spinner-only blank).
 */
export function Skeleton({
  variant = 'text',
  lines = 3,
  cards = 3,
  label = 'Loading',
}: SkeletonProps): ReactElement {
  if (variant === 'block') {
    return (
      <div
        role="status"
        aria-label={label}
        data-testid="skeleton"
        data-variant="block"
        style={{
          ...shimmer,
          height: '100%',
          minHeight: 320,
          padding: 24,
        }}
      >
        <span className="visually-hidden">{label}…</span>
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div
        role="status"
        aria-label={label}
        data-testid="skeleton"
        data-variant="cards"
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 'var(--od-gap)',
        }}
      >
        {Array.from({ length: cards }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            style={{
              ...shimmer,
              height: 148,
              borderRadius: 'var(--radius)',
            }}
          />
        ))}
        <span className="visually-hidden">{label}…</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label={label}
      data-testid="skeleton"
      data-variant="text"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 8,
      }}
    >
      <SkeletonLine width="38%" />
      {Array.from({ length: lines }, (_, index) => (
        <SkeletonLine
          key={index}
          width={index === lines - 1 ? '62%' : '100%'}
        />
      ))}
      <span className="visually-hidden">{label}…</span>
    </div>
  );
}
