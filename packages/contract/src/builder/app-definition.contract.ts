import { z } from 'zod';

/**
 * Builder-facing app-definition contracts (BLD-02, APP-03, APP-05).
 *
 * These sit **beside** the frozen contracts in this package — the
 * read-link claim set (D-21) and the saved-query record shape
 * (D-73) are consumed, never reshaped. The builder's own payloads
 * are ordinary versioned contracts: `.strict()` so an unlisted
 * field is rejected inline with the offending field named
 * (BLD-07's never-generic discipline).
 *
 * ## The `app_id` rule
 *
 * The create wizard's step 1 states it on the mockup: "Lowercase,
 * hyphenated. Immutable after first publish." The regex is the
 * rule — lowercase letters, digits, and single hyphens, never
 * leading/trailing. A non-conforming id fails the regex with the
 * rule in the message, which is what surfaces inline.
 */

/**
 * Lowercase-hyphenated app identity (BLD-02).
 *
 * Immutable after first publish: the contract cannot express
 * immutability (that is the lifecycle machine's job —
 * `app-lifecycle.ts` refuses every transition out of
 * `archived`, and `app_id` is never a patchable field), so
 * the rule enforced here is the shape alone.
 */
export const AppIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'app_id must be lowercase-hyphenated: lowercase letters, digits and single hyphens (e.g. leave-request)',
  );

/** The wizard's step-1 payload: name, app_id, description. */
export const CreateAppDraftSchema = z
  .object({
    name: z.string().min(1).max(200),
    app_id: AppIdSchema,
    description: z.string().min(1).max(2000),
  })
  .strict();

export type CreateAppDraftInput = z.infer<typeof CreateAppDraftSchema>;

/**
 * The BLD-02 tabbed editor's twelve sections.
 *
 * Every one is an editable tab, and every edit is an audited,
 * version-bumped transition (D-86, APP-03). The `lifecycle`
 * section carries the app's lifecycle *preferences* — the state
 * itself moves only through the dedicated
 * `commitPublish`/`deprecate`/`archive` transitions, never
 * through a section patch.
 */
export const SectionNameSchema = z.enum([
  'general',
  'metadata',
  'jev-behavior',
  'role-assignments',
  'roles-permissions',
  'forms',
  'versioning',
  'data-routing',
  'field-mapping',
  'lifecycle',
  'retention',
  'deprecation-notice',
]);

export type SectionName = z.infer<typeof SectionNameSchema>;

/**
 * A tab edit: one section, one patch.
 *
 * The patch is a non-empty record; per-section payload shapes
 * are validated where the section is applied (the service
 * validates the sections that carry a frozen vocabulary —
 * tags against the curated platform set, D-107).
 */
export const UpdateSectionSchema = z
  .object({
    section: SectionNameSchema,
    patch: z.record(z.string(), z.unknown()).refine(
      (patch) => Object.keys(patch).length > 0,
      'patch must carry at least one field',
    ),
  })
  .strict();

export type UpdateSectionInput = z.infer<typeof UpdateSectionSchema>;

/** The deprecation payload: the owner-supplied notice (APP-05). */
export const DeprecateAppSchema = z
  .object({
    notice: z.string().min(1).max(2000),
  })
  .strict();

export type DeprecateAppInput = z.infer<typeof DeprecateAppSchema>;

/** The fork payload: an optional user-chosen app identity. */
export const ForkTemplateSchema = z
  .object({
    app_id: AppIdSchema.optional(),
  })
  .strict();

export type ForkTemplateInput = z.infer<typeof ForkTemplateSchema>;
