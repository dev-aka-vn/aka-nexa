/**
 * The section tab bar (BLD-02).
 *
 * The twelve contract sections (SectionNameSchema) as
 * the editor's tabs, in contract order. The tab bar is
 * presentational: the active tab and the selection
 * change belong to the editor page.
 *
 * The strip scrolls horizontally (the twelve labels do
 * not fit narrower viewports) with the scrollbar hidden,
 * which used to leave overflowing tabs reachable only by
 * trackpad gesture — invisible and undiscoverable. The
 * prev/next chevrons are the visible affordance: each
 * nudges the strip so the hidden tabs slide into view,
 * disabled at the ends, and the active tab auto-scrolls
 * into view when the selection changes from anywhere.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactElement } from 'react';


import { APP_SECTIONS, sectionLabel } from '../sections.js';

export interface AppTabsProps {
  /** The active section. */
  active: string;
  /** The selection change handler. */
  onSelect: (section: string) => void;
}

/** A chevron glyph (`.ic` inherits the button's currentColor). */
function Chevron({ direction }: { direction: 'left' | 'right' }): ReactElement {
  return (
    <svg
      className="ic"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={
        direction === 'left'
          ? undefined
          : { transform: 'scaleX(-1)' }
      }
    >
      <path
        d="M15 18l-6-6 6-6"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The tab list — one tab per contract section, in
 * contract order — between the scroll chevrons.
 */
export function AppTabs({
  active,
  onSelect,
}: AppTabsProps): ReactElement {
  const stripRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  /** Whether either end still hides tabs. */
  const measure = useCallback((): void => {
    const strip = stripRef.current;
    if (strip === null) {
      return;
    }
    setCanLeft(strip.scrollLeft > 1);
    setCanRight(
      strip.scrollLeft + strip.clientWidth <
        strip.scrollWidth - 1,
    );
  }, []);

  /**
   * Re-measure on scroll (user gesture), on resize, and
   * whenever the strip's laid-out content settles: the
   * first paint can race the webfonts (tab label widths
   * change as they load), which measured the overflow
   * boundary before it existed and left the next chevron
   * disabled while tabs were still hidden. The rAF
   * defers past the mount paint; `fonts.ready` re-measures
   * once the label metrics are final; the ResizeObserver
   * catches viewport-driven strip resizes without a
   * window listener.
   */
  useEffect(() => {
    measure();
    const strip = stripRef.current;
    if (strip === null) {
      return;
    }
    const raf = requestAnimationFrame(measure);
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) {
        measure();
      }
    });
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    const onScroll = (): void => measure();
    strip.addEventListener('scroll', onScroll, {
      passive: true,
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      strip.removeEventListener('scroll', onScroll);
    };
  }, [measure]);

  // A selection made from anywhere (keyboard, the
  // chevrons' own overflow) brings the active tab into
  // view — `nearest` never scrolls the page itself.
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLButtonElement>(
        '[aria-selected="true"]',
      )
      ?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
  }, [active]);

  /** Slide the strip one page toward `direction`. */
  const nudge = useCallback(
    (direction: 1 | -1): void => {
      const strip = stripRef.current;
      if (strip === null) {
        return;
      }
      strip.scrollBy({
        left: direction * Math.max(160, strip.clientWidth * 0.7),
        behavior: 'smooth',
      });
    },
    [],
  );

  return (
    <div className="tabs-wrap">
      <button
        type="button"
        className="tabs-nav"
        data-testid="tabs-prev"
        aria-label="Scroll to previous tabs"
        disabled={!canLeft}
        onClick={() => nudge(-1)}
      >
        <Chevron direction="left" />
      </button>
      <div
        className="tabs"
        role="tablist"
        data-testid="editor-tabs"
        ref={stripRef}
      >
        {APP_SECTIONS.map((section) => (
          <button
            type="button"
            key={section}
            role="tab"
            className="tab"
            data-testid={`editor-tab-${section}`}
            aria-selected={active === section}
            onClick={() => onSelect(section)}
          >
            {sectionLabel(section)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="tabs-nav"
        data-testid="tabs-next"
        aria-label="Scroll to next tabs"
        disabled={!canRight}
        onClick={() => nudge(1)}
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
}
