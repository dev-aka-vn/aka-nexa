/**
 * The served app-definition projection (BLD-02).
 *
 * The plan-04 controller serves the definition
 * document minus Mongo's `_id` as a plain
 * record; the contract deliberately ships no
 * response schema for it (the served shape is
 * the document's own). The SPA validates it at
 * the boundary with a structural schema — the
 * fields every surface renders, each accepted
 * in its wire form — so a malformed payload
 * never reaches a component (BLD-07).
 *
 * The lifecycle states are the lifecycle
 * machine's vocabulary (plan 04's
 * `app-lifecycle.ts`): `draft → published →
 * deprecated → archived`.
 */

/** The lifecycle states an app definition moves through. */
export const APP_LIFECYCLE_STATES = [
  'draft',
  'published',
  'deprecated',
  'archived',
] as const;

export type AppLifecycleState = (typeof APP_LIFECYCLE_STATES)[number];

/** How an app integrates: internal-only, external, or hybrid. */
export type AppDataMode = 'internal' | 'external' | 'hybrid';

/**
 * The form kinds (D-01/D-02) — the reserved four,
 * one form per kind per app. Mirrors the contract's
 * `AppFormKindSchema.options`.
 */
export const APP_FORM_KINDS = [
  'submit',
  'list',
  'show',
  'edit',
] as const;

export type AppFormKind = (typeof APP_FORM_KINDS)[number];

/** One form's trigger (D-06): intents, slash aliases, confidence threshold. */
export interface FormTrigger {
  readonly intents: readonly string[];
  readonly aliases: readonly string[];
  readonly threshold: number;
}

/**
 * One element of the app's form set (D-09) — the structural
 * mirror of the contract's `AppFormElementSchema`. The SPA
 * copies the shape rather than importing the contract's
 * runtime schema; the boundary parse below is its own.
 */
export interface AppForm {
  readonly form_id: string;
  readonly kind: AppFormKind;
  readonly schema: Record<string, unknown> | null;
  readonly form_version: number;
  readonly triggers: FormTrigger | null;
  readonly config: Record<string, unknown>;
}

/**
 * The served definition — the fields the
 * builder's surfaces render. Optional fields
 * the API may serve as null are typed
 * nullable, never absent.
 */
export interface AppDefinition {
  readonly app_id: string;
  readonly name: string;
  readonly description: string;
  readonly data_mode: AppDataMode;
  readonly lifecycle: AppLifecycleState;
  /** Monotonic integer version — every audited mutation bumps it (APP-03). */
  readonly version: number;
  readonly tags: readonly string[];
  /** The app's whole form set (D-09) — one source of truth. */
  readonly forms: readonly AppForm[];
  readonly roles: Record<string, unknown>;
  readonly routing_config: Record<string, unknown> | null;
  readonly field_mapping: Record<string, unknown> | null;
  readonly retention_policy: Record<string, unknown> | null;
  readonly deprecation_notice: string | null;
  readonly lifecycle_prefs: Record<string, unknown> | null;
  readonly jev_behavior: Record<string, unknown> | null;
  readonly role_assignments: Record<string, unknown> | null;
  readonly roles_permissions: Record<string, unknown> | null;
  readonly versioning_policy: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/**
 * The minimal valid form element a malformed element
 * normalizes to — a `submit` form with no schema and no
 * trigger. The boundary never throws on a malformed element
 * (house style: validate-at-boundary, default-don't-throw).
 */
function emptySubmitForm(): AppForm {
  return {
    form_id: 'submit',
    kind: 'submit',
    schema: null,
    form_version: 1,
    triggers: null,
    config: {},
  };
}

/** Normalize one served trigger: drop non-string labels, default the threshold. */
function normalizeTrigger(raw: unknown): FormTrigger | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const trigger = raw as Partial<FormTrigger>;
  return {
    intents: Array.isArray(trigger.intents)
      ? trigger.intents.filter(
          (label): label is string => typeof label === 'string',
        )
      : [],
    aliases: Array.isArray(trigger.aliases)
      ? trigger.aliases.filter(
          (label): label is string => typeof label === 'string',
        )
      : [],
    threshold:
      typeof trigger.threshold === 'number' ? trigger.threshold : 0,
  };
}

/** Normalize one served form element, or the empty submit form when malformed. */
function normalizeForm(raw: unknown): AppForm {
  if (typeof raw !== 'object' || raw === null) {
    return emptySubmitForm();
  }
  const element = raw as Partial<AppForm>;
  if (
    typeof element.form_id !== 'string' ||
    typeof element.kind !== 'string' ||
    !(APP_FORM_KINDS as readonly string[]).includes(element.kind)
  ) {
    return emptySubmitForm();
  }
  return {
    form_id: element.form_id,
    kind: element.kind as AppFormKind,
    schema:
      typeof element.schema === 'object' && element.schema !== null
        ? element.schema
        : null,
    form_version:
      typeof element.form_version === 'number'
        ? element.form_version
        : 1,
    triggers: normalizeTrigger(element.triggers),
    config:
      typeof element.config === 'object' && element.config !== null
        ? (element.config as Record<string, unknown>)
        : {},
  };
}

/** Normalize the served form set element-wise, dropping a non-array. */
export function normalizeForms(raw: unknown): AppForm[] {
  return Array.isArray(raw) ? raw.map(normalizeForm) : [];
}

/**
 * The app's `submit` form (D-05) — the one form that
 * always exists, and the element the single-form surfaces
 * (the designer, the wizard's trigger step) read and write.
 * Falls back to a fresh empty submit form when the served
 * set carries none.
 */
export function submitFormOf(definition: AppDefinition): AppForm {
  return (
    definition.forms.find((form) => form.kind === 'submit') ??
    emptySubmitForm()
  );
}

/**
 * The confidence gate a trigger gets when the app configures
 * none — the platform default the routing machinery falls back
 * to (D-53).
 */
export const DEFAULT_TRIGGER_THRESHOLD = 0.5;

/**
 * The app's JEV-behavior confidence threshold, or the platform
 * default. The wizard's trigger step defaults a new trigger's
 * `threshold` from this value (D-06).
 */
export function triggerThresholdFor(definition: AppDefinition): number {
  const configured = definition.jev_behavior?.['threshold'];
  return typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured >= 0 &&
    configured <= 1
    ? configured
    : DEFAULT_TRIGGER_THRESHOLD;
}

/**
 * The structural response schema for the
 * served definition. Validates the fields the
 * SPA renders; an unexpected field is simply
 * not read (the projection is the document's
 * own, and the document may grow).
 */
export const AppDefinitionSchema = {
  parse: (data: unknown): AppDefinition => {
    const doc = data as Partial<AppDefinition> | null;
    if (
      typeof doc !== 'object' ||
      doc === null ||
      typeof doc.app_id !== 'string' ||
      typeof doc.name !== 'string' ||
      typeof doc.description !== 'string' ||
      typeof doc.lifecycle !== 'string' ||
      typeof doc.version !== 'number'
    ) {
      throw new Error('malformed app definition');
    }
    return {
      app_id: doc.app_id,
      name: doc.name,
      description: doc.description,
      data_mode:
        doc.data_mode === 'external' || doc.data_mode === 'hybrid'
          ? doc.data_mode
          : 'internal',
      lifecycle: (APP_LIFECYCLE_STATES as readonly string[]).includes(
        doc.lifecycle,
      )
        ? (doc.lifecycle as AppLifecycleState)
        : 'draft',
      version: doc.version,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      forms: normalizeForms(doc.forms),
      roles:
        typeof doc.roles === 'object' && doc.roles !== null
          ? doc.roles
          : {},
      routing_config:
        typeof doc.routing_config === 'object' &&
        doc.routing_config !== null
          ? doc.routing_config
          : null,
      field_mapping:
        typeof doc.field_mapping === 'object' &&
        doc.field_mapping !== null
          ? doc.field_mapping
          : null,
      retention_policy:
        typeof doc.retention_policy === 'object' &&
        doc.retention_policy !== null
          ? doc.retention_policy
          : null,
      deprecation_notice:
        typeof doc.deprecation_notice === 'string'
          ? doc.deprecation_notice
          : null,
      lifecycle_prefs:
        typeof doc.lifecycle_prefs === 'object' &&
        doc.lifecycle_prefs !== null
          ? doc.lifecycle_prefs
          : null,
      jev_behavior:
        typeof doc.jev_behavior === 'object' &&
        doc.jev_behavior !== null
          ? doc.jev_behavior
          : null,
      role_assignments:
        typeof doc.role_assignments === 'object' &&
        doc.role_assignments !== null
          ? doc.role_assignments
          : null,
      roles_permissions:
        typeof doc.roles_permissions === 'object' &&
        doc.roles_permissions !== null
          ? doc.roles_permissions
          : null,
      versioning_policy:
        typeof doc.versioning_policy === 'object' &&
        doc.versioning_policy !== null
          ? doc.versioning_policy
          : null,
      metadata:
        typeof doc.metadata === 'object' && doc.metadata !== null
          ? doc.metadata
          : null,
      createdBy: typeof doc.createdBy === 'string' ? doc.createdBy : '',
      createdAt: typeof doc.createdAt === 'string' ? doc.createdAt : '',
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : undefined,
    };
  },
};

/** One BLD-06 change-summary row: what changed, from what, to what. */
export interface PublishChangeRow {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The publish response — the definition
 * projection plus the change summary the
 * publish gate computed and the AUD-01
 * entry retains. A field that did not
 * change is absent from the summary
 * (06-05's contract).
 */
export interface PublishResult extends AppDefinition {
  readonly changeSummary: PublishChangeRow[];
  readonly zero_change: boolean;
}

/**
 * The publish response's structural
 * schema: the definition validates as
 * a served definition, and the change
 * summary is the row set the admin
 * confirms — the same rows the audit
 * trail retains (BLD-06 auditability).
 */
export const PublishResultSchema = {
  parse: (data: unknown): PublishResult => {
    const definition = AppDefinitionSchema.parse(data);
    const doc = data as {
      changeSummary?: unknown;
      zero_change?: unknown;
    } | null;
    if (
      !Array.isArray(doc?.changeSummary) ||
      typeof doc?.zero_change !== 'boolean'
    ) {
      throw new Error('malformed publish result');
    }
    const changeSummary = doc.changeSummary.map(
      (row): PublishChangeRow => {
        const candidate = row as Partial<PublishChangeRow> | null;
        if (
          typeof candidate !== 'object' ||
          candidate === null ||
          typeof candidate.field !== 'string' ||
          typeof candidate.from !== 'string' ||
          typeof candidate.to !== 'string'
        ) {
          throw new Error('malformed change row');
        }
        return {
          field: candidate.field,
          from: candidate.from,
          to: candidate.to,
        };
      },
    );
    return { ...definition, changeSummary, zero_change: doc.zero_change };
  },
};

/** The apps-list response (`GET /apps`). */
export interface AppsListResponse {
  apps: AppDefinition[];
}

/** The list's structural schema. */
export const AppsListSchema = {
  parse: (data: unknown): AppsListResponse => {
    const payload = data as { apps?: unknown };
    if (!Array.isArray(payload.apps)) {
      throw new Error('malformed app list');
    }
    return {
      apps: payload.apps.map((app) => AppDefinitionSchema.parse(app)),
    };
  },
};
