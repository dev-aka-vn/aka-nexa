/**
 * The curated platform tag vocabulary (D-107, T-06-16).
 *
 * Tags are **not** free-form. Every tag a template
 * carries and every tag a builder puts on an app
 * comes from this frozen set — two axes:
 *
 * - **use-case** — what the request is *for*
 *   (`time-off`, `travel`, …, `external` for the
 *   connector-facing examples);
 * - **department** — who it is *for*
 *   (`engineering`, `operations`, …, `all-staff`).
 *
 * The two axes share one enumerated set: a tag is a
 * tag, whichever axis contributed it, and the
 * Zod enum below is the single source of truth both
 * the template seeds and the user-app metadata
 * section validate against. An out-of-vocabulary
 * tag is rejected inline, naming the allowed set —
 * never a generic validation failure (BLD-07).
 */

import { z } from 'zod';

import { BuilderError } from '../app-lifecycle.js';

/** The use-case axis (D-107). */
export const PLATFORM_USE_CASE_TAGS = [
  'time-off',
  'travel',
  'procurement',
  'assets',
  'hr',
  'it',
  'facilities',
  'expenses',
  'onboarding',
  'external',
] as const;

/** The department axis (D-107). */
export const PLATFORM_DEPARTMENT_TAGS = [
  'engineering',
  'operations',
  'finance',
  'hr',
  'sales',
  'all-staff',
] as const;

/**
 * The one enumerated set — the union of both axes.
 * `hr` belongs to both axes; the set carries it once.
 */
export const PLATFORM_TAGS = [
  ...PLATFORM_USE_CASE_TAGS,
  ...PLATFORM_DEPARTMENT_TAGS.filter(
    (tag) => !PLATFORM_USE_CASE_TAGS.includes(tag as never),
  ),
] as const;

/** A single curated tag. */
export type PlatformTag = (typeof PLATFORM_TAGS)[number];

/** The Zod enum both templates and user apps validate against. */
export const PlatformTagSchema = z.enum(PLATFORM_TAGS);

/** A curated tag list — one or more, every entry enumerated. */
export const PlatformTagsSchema = z.array(PlatformTagSchema);

/** Is this value one of the curated tags? */
export function isPlatformTag(value: unknown): value is PlatformTag {
  return (
    typeof value === 'string' &&
    (PLATFORM_TAGS as readonly string[]).includes(value)
  );
}

/**
 * Refuse an out-of-vocabulary tag inline, naming the
 * allowed set (D-107, T-06-16). Accepts the raw
 * patch value: a non-array, or an array carrying a
 * non-string or unknown entry, is refused with the
 * same named error — the shape of the refusal is
 * the message, not a generic validation failure.
 */
export function assertCuratedTags(tags: unknown): void {
  const list = Array.isArray(tags) ? tags : [tags];
  const rejected = list.filter((tag) => !isPlatformTag(tag));
  if (rejected.length === 0) {
    return;
  }
  throw new BuilderError(
    'TAG_NOT_IN_VOCABULARY',
    `tags must come from the curated platform set: ${PLATFORM_TAGS.join(', ')} — rejected: ${rejected.join(', ')}`,
  );
}
