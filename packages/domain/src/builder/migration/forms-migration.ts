/**
 * D-11 — the one-shot, two-collection, idempotent migration
 * that rewrites the retired `form_schema` + app-level
 * `triggers` shape into the `forms[]` shape 07-01 landed.
 *
 * Runs as a best-effort boot step in BOTH processes that
 * read app definitions (`api` and `worker`); the migration
 * is idempotent so running in both is safe, and a second run
 * migrates zero documents (the returned count is the proof).
 *
 * Two collections, one run:
 *   1. `apps` — every document carrying `form_schema`.
 *   2. `app_definition_versions` — every retained snapshot
 *      whose embedded snapshot carries `form_schema`.
 *
 * Without the snapshot half, `AppDefinitionService.rollback()`
 * would spread a pre-migration snapshot back into a live doc
 * and silently resurrect `form_schema` + app-level `triggers`
 * while dropping `forms[]` — a data-corruption path, not a
 * cosmetic one (research §snapshot-hazard).
 *
 * Stored custom-role grants naming the retired `'triggers'`
 * section are dropped from `role_assignments[].permissions`
 * and `roles_permissions` in the same pass (Pitfall 5).
 */

import type { MongoService } from '@akane/platform';
import type { AppFormElement } from '@akane/contract';

/** A loose legacy trigger row as written by pre-Phase-7 code. */
type LegacyTriggerRow = Record<string, unknown>;

/** A loose legacy app document (pre-Phase-7 shape). */
type LegacyAppDoc = Record<string, unknown> & {
  _id?: unknown;
  app_id?: string;
  version?: number;
  form_schema?: Record<string, unknown> | null;
  triggers?: readonly LegacyTriggerRow[] | null;
  jev_behavior?: Record<string, unknown> | null;
  role_assignments?: unknown;
  roles_permissions?: unknown;
};

/** The D-53 gate bounds: a finite number in [0, 1]. */
function isThreshold(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/**
 * Fold an old app-level `triggers` array into the per-form
 * `FormTrigger` shape (`{ intents, aliases, threshold }`).
 *
 * Returns `null` when the old array is empty (the form
 * carries no trigger), matching the D-07 "a form that
 * carries none stores `null`" rule.
 *
 * Per-row extraction (mirrors `declaredLabels`):
 *   - `intent` / `intents` values → `intents`
 *   - slash `command` and `aliases` values → `aliases`
 *   - when a row declares neither, the `id` / `command`
 *     fallback is retained (seed-forked rows)
 */
export function foldLegacyTriggers(
  rows: unknown,
  jevBehavior: unknown,
): { intents: string[]; aliases: string[]; threshold: number } | null {
  const arr: readonly LegacyTriggerRow[] = Array.isArray(rows)
    ? (rows as readonly LegacyTriggerRow[])
    : [];
  if (arr.length === 0) {
    return null;
  }

  const intents = new Set<string>();
  const aliases = new Set<string>();

  for (const row of arr) {
    if (row === null || typeof row !== 'object') {
      continue;
    }
    const r = row as LegacyTriggerRow;

    const declaredIntents: string[] = [];
    if (Array.isArray(r['intents'])) {
      for (const v of r['intents'] as unknown[]) {
        if (typeof v === 'string' && v.length > 0) {
          declaredIntents.push(v);
        }
      }
    }
    if (typeof r['intent'] === 'string' && (r['intent'] as string).length > 0) {
      declaredIntents.push(r['intent'] as string);
    }

    const declaredAliases: string[] = [];
    if (Array.isArray(r['aliases'])) {
      for (const v of r['aliases'] as unknown[]) {
        if (typeof v === 'string' && v.length > 0) {
          declaredAliases.push(v);
        }
      }
    }
    if (typeof r['command'] === 'string' && (r['command'] as string).length > 0) {
      declaredAliases.push(r['command'] as string);
    }

    if (declaredIntents.length > 0 || declaredAliases.length > 0) {
      for (const v of declaredIntents) intents.add(v);
      for (const v of declaredAliases) aliases.add(v);
    } else {
      // Fallback for seed-forked rows that declare no labels:
      // keep the row's own identity so it stays routable.
      if (typeof r['id'] === 'string' && (r['id'] as string).length > 0) {
        intents.add(r['id'] as string);
      }
      if (typeof r['command'] === 'string' && (r['command'] as string).length > 0) {
        aliases.add(r['command'] as string);
      }
    }
  }

  const threshold =
    isThreshold((jevBehavior as Record<string, unknown> | null)?.['threshold'])
      ? ((jevBehavior as Record<string, unknown>)['threshold'] as number)
      : 0.8;

  return {
    intents: [...intents],
    aliases: [...aliases],
    threshold,
  };
}

/**
 * Pure transform: rewrite one legacy app document into the
 * `forms[]` shape. Returns the new `forms` array (a single
 * `kind:'submit'` form carrying the old `form_schema` and the
 * folded trigger).
 */
export function transformLegacyApp(
  legacy: LegacyAppDoc,
): { forms: AppFormElement[] } {
  const schema =
    legacy.form_schema !== null &&
    typeof legacy.form_schema === 'object' &&
    legacy.form_schema !== undefined
      ? (legacy.form_schema as Record<string, unknown>)
      : {};

  const formVersion =
    typeof legacy.version === 'number' && Number.isFinite(legacy.version)
      ? legacy.version
      : 0;

  const triggers = foldLegacyTriggers(legacy.triggers, legacy.jev_behavior);

  const form: AppFormElement = {
    form_id: 'submit',
    kind: 'submit',
    schema,
    form_version: formVersion,
    triggers,
    config: {},
  } as unknown as AppFormElement;

  return { forms: [form] };
}

/** Drop the retired `'triggers'` section from a permissions-like value. */
function dropTriggersFromPermissions(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const copy: Record<string, unknown> = { ...(item as Record<string, unknown>) };
        if (Array.isArray(copy['permissions'])) {
          copy['permissions'] = (copy['permissions'] as unknown[]).filter(
            (p) => p !== 'triggers',
          );
        }
        out.push(copy);
      } else if (item === 'triggers') {
        // drop a bare 'triggers' string from a string-array grant
        continue;
      } else {
        out.push(item);
      }
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[key] = v.filter((p) => p !== 'triggers');
      } else if (v && typeof v === 'object') {
        const copy: Record<string, unknown> = { ...(v as Record<string, unknown>) };
        if (Array.isArray(copy['permissions'])) {
          copy['permissions'] = (copy['permissions'] as unknown[]).filter(
            (p) => p !== 'triggers',
          );
        }
        out[key] = copy;
      } else {
        out[key] = v;
      }
    }
    return out;
  }
  return value;
}

/** Rewrite role grants naming the retired `'triggers'` section. */
function rewriteRoleGrants(doc: LegacyAppDoc): {
  role_assignments?: unknown;
  roles_permissions?: unknown;
} {
  const out: { role_assignments?: unknown; roles_permissions?: unknown } = {};
  if (doc.role_assignments !== undefined && doc.role_assignments !== null) {
    out.role_assignments = dropTriggersFromPermissions(doc.role_assignments);
  }
  if (doc.roles_permissions !== undefined && doc.roles_permissions !== null) {
    out.roles_permissions = dropTriggersFromPermissions(doc.roles_permissions);
  }
  return out;
}

/**
 * The migration entry point — clone of the backfill
 * contract shape: a free function over `MongoService`
 * returning the number of transformed documents.
 */
export async function migrateAppForms(mongo: MongoService): Promise<number> {
  let migrated = 0;

  // ── Collection 1: apps ──────────────────────────────────
  const apps = mongo.db().collection<Record<string, unknown>>('apps');
  const appDocs = await apps
    .find({ form_schema: { $exists: true } })
    .toArray();

  for (const doc of appDocs) {
    const legacy = doc as LegacyAppDoc;
    const { forms } = transformLegacyApp(legacy);

    const $set: Record<string, unknown> = { forms };
    const grants = rewriteRoleGrants(legacy);
    if (grants.role_assignments !== undefined) {
      $set['role_assignments'] = grants.role_assignments;
    }
    if (grants.roles_permissions !== undefined) {
      $set['roles_permissions'] = grants.roles_permissions;
    }

    const result = await apps.updateOne(
      { _id: doc['_id'], form_schema: { $exists: true } },
      { $set, $unset: { form_schema: '', triggers: '' } },
    );
    if (result.matchedCount > 0) {
      migrated += 1;
    }
  }

  // ── Collection 2: app_definition_versions ───────────────
  const versions = mongo
    .db()
    .collection<Record<string, unknown>>('app_definition_versions');
  const snapDocs = await versions
    .find({ 'snapshot.form_schema': { $exists: true } })
    .toArray();

  for (const doc of snapDocs) {
    const snapshot = doc['snapshot'] as LegacyAppDoc | undefined;
    if (!snapshot || typeof snapshot !== 'object') {
      continue;
    }
    const { forms } = transformLegacyApp(snapshot);
    const grants = rewriteRoleGrants(snapshot);

    const newSnapshot: Record<string, unknown> = { ...snapshot, forms };
    // Drop retired keys from the embedded snapshot.
    delete newSnapshot['form_schema'];
    delete newSnapshot['triggers'];
    if (grants.role_assignments !== undefined) {
      newSnapshot['role_assignments'] = grants.role_assignments;
    }
    if (grants.roles_permissions !== undefined) {
      newSnapshot['roles_permissions'] = grants.roles_permissions;
    }

    const result = await versions.updateOne(
      { _id: doc['_id'] },
      { $set: { snapshot: newSnapshot } },
    );
    if (result.matchedCount > 0) {
      migrated += 1;
    }
  }

  return migrated;
}
