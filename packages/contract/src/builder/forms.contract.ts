import { z } from 'zod';

import { ReadLinkActionSchema } from '../links/read-link-claims.js';

/** A form's kind corresponds 1:1 to the frozen read-link action (D-01). */
export const AppFormKindSchema = z.enum([
  'submit',
  'list',
  'show',
  'edit',
]);

export type AppFormKind = z.infer<typeof AppFormKindSchema>;

/**
 * Form kinds map onto the frozen read-link actions (D-01):
 * submit -> create, list -> query, show -> view, edit -> edit
 */
export const FORM_KIND_TO_ACTION = Object.freeze({
  submit: 'create',
  list: 'query',
  show: 'view',
  edit: 'edit',
} as const satisfies Record<AppFormKind, z.infer<typeof ReadLinkActionSchema>>);

/**
 * Derive the read-link action for a given form kind (D-01). Throws if unknown.
 */
export function formKindForAction(action: z.infer<typeof ReadLinkActionSchema>): AppFormKind {
  switch (action) {
    case 'create':
      return 'submit';
    case 'query':
      return 'list';
    case 'view':
      return 'show';
    case 'edit':
      return 'edit';
    case 'draft':
      throw new Error(`draft is not a form kind (D-01)`);
    case 'notification':
      throw new Error(`notification is not a form kind (D-01)`);
    default:
      // Exhaustive check for future additions
      const _exhaustive: never = action;
      throw new Error(`unmapped action: ${_exhaustive}`);
  }
}

/** Per-form trigger configuration (D-06). At most one per form (D-07). */
export const FormTriggerSchema = z
  .object({
    /** Intents that activate this form in chat. */
    intents: z.array(z.string()),
    /** Slash-command aliases that activate this form in chat. */
    aliases: z.array(z.string()),
    /** Confidence threshold for this form's trigger (0..1). */
    threshold: z.number().min(0).max(1).optional().default(0.8),
  })
  .strict();

export type FormTrigger = z.infer<typeof FormTriggerSchema>;

/** Per-form configuration surface (form manager future-proofing). */
export const AppFormConfigSchema = z
  .object({})
  .strict();

export type AppFormConfig = z.infer<typeof AppFormConfigSchema>;

/**
 * A single form element in an app's form set (D-02, D-09).
 * `form_id` is the kind string (one form per kind per app).
 */
export const AppFormElementSchema = z
  .object({
    form_id: z.string().min(1),
    kind: AppFormKindSchema,
    /** FormIO schema for this form. */
    schema: z.record(z.string(), z.unknown()),
    /** Per-form version; derived by app version at last schema/config change (D-10). */
    form_version: z.number().int().nonnegative(),
    /** Trigger configuration, or null if this form has no trigger. */
    triggers: FormTriggerSchema.nullable(),
    /** Form configuration (reserved for future fields; empty object for now). */
    config: AppFormConfigSchema,
  })
  .strict();

export type AppFormElement = z.infer<typeof AppFormElementSchema>;
