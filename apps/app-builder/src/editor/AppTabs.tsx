/**
 * The section tab bar (BLD-02).
 *
 * The twelve contract sections (SectionNameSchema) as
 * the editor's tabs, in contract order. The tab bar is
 * presentational: the active tab and the selection
 * change belong to the editor page.
 */

import type { ReactElement } from 'react';

import { APP_SECTIONS, sectionLabel } from '../sections.js';

export interface AppTabsProps {
  /** The active section. */
  active: string;
  /** The selection change handler. */
  onSelect: (section: string) => void;
}

/**
 * The tab list — one tab per contract section, in
 * contract order.
 */
export function AppTabs({
  active,
  onSelect,
}: AppTabsProps): ReactElement {
  return (
    <div className="tabs" role="tablist" data-testid="editor-tabs">
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
  );
}
