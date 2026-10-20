import { z } from 'zod';

import { ReadLinkActionSchema } from '../links/read-link-claims.js';

/**
 * The form-set contract (D-01/D-02/D-06/D-07/D-09).
 *
 * An app is a **container of forms**: it stores
 * `forms: [{ form_id, kind, schema, form_version, triggers | null, config }]`
 * and nothing else for its form set — there is no
 * app-level `form_schema` and no app-level `triggers`
 * (D-09; the plural replaces the singular).
 *
 * `form_id` derivation rule: since D-02 admits **at
 * most one form per kind per app**, `form_id` is the
 * kind string. The app_id is the outer key, so
 * `'submit'`/`'list'`/`'show'`/`'edit'` cannot collide
 * within an app.
 */

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
 * submit -> create, list -> query, show -> view, edit -> edit.
 *
 * The frozen `ReadLinkActionSchema` is imported and never
 * redefined; `notification` and `draft` are not kinds.
 */
export const FORM_KIND_TO_ACTION = Object.freeze({
  submit: 'create',
  list: 'query',
  show: 'view',
  edit: 'edit',
} as const satisfies Record<AppFormKind, z.infer<typeof ReadLinkActionSchema>>);

/** The frozen action vocabulary, derived from the bijection (D-01). */
export type ReadLinkAction = z.infer<typeof ReadLinkActionSchema>;

/**
 * Derive the form kind for a frozen read-link action (D-01).
 * Throws for the two actions that are not form kinds.
 */
export function formKindForAction(action: ReadLinkAction): AppFormKind {
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
      throw new Error('draft is not a form kind (D-01)');
    case 'notification':
      throw new Error('notification is not a form kind (D-01)');
    default: {
      const exhaustive: never = action;
      throw new Error(`unmapped action: ${String(exhaustive)}`);
    }
  }
}

/**
 * Per-form trigger configuration (D-06). At most one per
 * form (D-07); a form that carries none stores `null`.
 * The persisted trigger carries no example phrases — the
 * examples input stays wizard-local working state.
 */
export const FormTriggerSchema = z
  .object({
    /** Intents that activate this form in chat. */
    intents: z.array(z.string().min(1)).max(20),
    /** Slash-command aliases that activate this form in chat. */
    aliases: z.array(z.string().min(1)).max(20),
    /** Confidence threshold for this form's trigger (0..1). */
    threshold: z.number().min(0).max(1),
  })
  .strict();

export type FormTrigger = z.infer<typeof FormTriggerSchema>;

/** `submit` config: strict empty object — the form carries its own schema. */
export const SubmitFormConfigSchema = z.object({}).strict();

/**
 * `show` (view) config (D-03): the submit-schema fields to
 * surface, in order.
 */
export const ShowFormConfigSchema = z
  .object({
    fields: z.array(z.string().min(1)).min(1),
  })
  .strict();

/** `list` (query) config (D-04): saved-query reference + column config. */
export const ListFormConfigSchema = z
  .object({
    query_id: z.string().min(1),
    columns: z.array(z.string().min(1)).min(1),
  })
  .strict();

/** `edit` config: strict empty object — renders the submission's pinned schema. */
export const EditFormConfigSchema = z.object({}).strict();

/**
 * The per-kind config payloads (D-03/D-04). The element
 * schema below binds each `kind` to its own config shape,
 * so a `list` form cannot be stored without its
 * saved-query reference and a `submit` form cannot carry
 * a stray key.
 */
export const AppFormConfigSchema = z.union([
  SubmitFormConfigSchema,
  ShowFormConfigSchema,
  ListFormConfigSchema,
  EditFormConfigSchema,
]);

export type AppFormConfig = z.infer<typeof AppFormConfigSchema>;

/** Fields shared by every form kind. */
const formElementFields = {
  /** Derived from `kind` (D-02: one form per kind per app). */
  form_id: z.string().min(1),
  /** FormIO schema for this form; `null` until a schema is designed. */
  schema: z.record(z.string(), z.unknown()).nullable(),
  /** Per-form version; advances only when this form's schema/config changes (D-10). */
  form_version: z.number().int().nonnegative(),
  /** This form's trigger, or `null` when it has none (D-07). */
  triggers: FormTriggerSchema.nullable(),
};

/**
 * A single form element, discriminated on `kind` so each
 * kind carries exactly its own config shape (D-03/D-04).
 * `.strict()` on every variant: an unknown key is rejected
 * with the key named (T-07-01).
 */
export const AppFormElementSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...formElementFields,
      kind: z.literal('submit'),
      config: SubmitFormConfigSchema,
    })
    .strict(),
  z
    .object({
      ...formElementFields,
      kind: z.literal('list'),
      config: ListFormConfigSchema,
    })
    .strict(),
  z
    .object({
      ...formElementFields,
      kind: z.literal('show'),
      config: ShowFormConfigSchema,
    })
    .strict(),
  z
    .object({
      ...formElementFields,
      kind: z.literal('edit'),
      config: EditFormConfigSchema,
    })
    .strict(),
]);

export type AppFormElement = z.infer<typeof AppFormElementSchema>;
export type AppFormElementInput = z.input<typeof AppFormElementSchema>;
