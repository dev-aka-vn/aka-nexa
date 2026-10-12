/**
 * Browser-only entry (the `apps/renderer` edit.ts
 * pattern): this module is deliberately DOM-free at
 * import time, so importing it from Node is a no-op.
 * `@formio/js` is only ever reached through the
 * guarded dynamic imports inside `FormioBuilderField`
 * and the preview pane (Pattern 1, Pitfall 1).
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

/** Mounts the app-builder shell. No-op outside a DOM. */
export function boot(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const host = document.getElementById('app');
  if (!host) {
    return;
  }
  createRoot(host).render(createElement(App));
}

boot();
