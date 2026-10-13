/**
 * BLD-06 — the publish keyboard shortcut.
 *
 * The save the Ctrl/Cmd+S shortcut triggers
 * is the same `POST /apps/:id/publish` the
 * publish surface triggers (06-05's
 * contract): no separate save endpoint
 * exists, so the shortcut and the button
 * cannot diverge. Ctrl and Cmd cover the
 * two modifier conventions; the key matches
 * case-insensitively, so a Shift-held `S`
 * is the same chord.
 */
export function isPublishShortcut(event: {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly key: string;
}): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 's'
  );
}
