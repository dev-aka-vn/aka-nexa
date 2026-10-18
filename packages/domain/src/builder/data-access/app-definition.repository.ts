import { MongoService } from '@akane/platform';
import { type OptionalId } from 'mongodb';

import {
  BuilderError,
  type AppLifecycleState,
} from '../app-lifecycle.js';
import type { SectionName } from '@akane/contract';

/**
 * The app-definition store (BLD-02, APP-03, D-86).
 *
 * ## The D-86 reconciliation model
 *
 * Builder writes **extend the `apps` collection** with the
 * definition fields on user-authored apps — name, description,
 * data_mode, lifecycle, version, tags, form schema, triggers,
 * roles, routing config, field mapping, retention policy,
 * deprecation notice, createdBy, timestamps — while
 * seed-loaded platform apps keep the registry's minimal
 * `AppDocument` shape (`app_id`, `connector_ref`). The
 * collection therefore holds a union of shapes, which is what
 * makes the reconciliation work: a platform app the builder
 * never touched stays exactly what Phase 5 wrote, and a
 * user-authored app carries its full definition.
 *
 * The registry's `AppDocument` contract is **not** reshaped —
 * `AppRepository` keeps its own minimal interface for its
 * Phase-5 consumers, and this repository works against the
 * extended `AppDefinitionDocument` superset.
 *
 * ## The duplicate-create guard
 *
 * `app_id` carries a **unique index** (created idempotently
 * on first use, the `SubmissionRevisionsRepository` pattern).
 * A duplicate insert fails at the database with `11000` —
 * not at a prior read — so two concurrent creates cannot both
 * win, and the repository maps the driver error to the named
 * inline `app ID already in use` refusal.
 *
 * ## Version-guarded writes
 *
 * Every version-bumping write (`updateSection`,
 * `setLifecycle`) filters on the version the patch was
 * computed against, so a concurrent edit cannot make two
 * mutations claim the same next version: the loser matches
 * nothing and the caller retries. The version counter stays
 * monotonic and one-to-one with the content it belongs to
 * (APP-03).
 */

/** How an app integrates: internal-only, external through a connector, or hybrid. */
export type AppDataMode = 'internal' | 'external' | 'hybrid';

/**
 * One user-authored app definition — the extended document
 * the builder writes. Every field the BLD-02 editor's tabs
 * edit lives here; the `lifecycle` field is the state the
 * `AppLifecycle` machine guards.
 */
export interface AppDefinitionDocument {
  readonly _id?: string;
  readonly app_id: string;
  readonly name: string;
  readonly description: string;
  readonly data_mode: AppDataMode;
  readonly lifecycle: AppLifecycleState;
  /** Monotonic integer version — every audited mutation bumps it (APP-03). */
  readonly version: number;
  readonly tags: readonly string[];
  readonly forms: readonly import('@akane/contract').AppFormElement[];
  readonly roles: Record<string, unknown>;
  readonly routing_config: Record<string, unknown> | null;
  readonly field_mapping: Record<string, unknown> | null;
  readonly retention_policy: Record<string, unknown> | null;
  /** The owner-supplied deprecation notice (APP-05), served to users. */
  readonly deprecation_notice: string | null;
  /** Editor display preferences for the lifecycle tab — the *state* itself moves only through the transition endpoints. */
  readonly lifecycle_prefs: Record<string, unknown> | null;
  readonly jev_behavior: Record<string, unknown> | null;
  readonly role_assignments: Record<string, unknown> | null;
  readonly roles_permissions: Record<string, unknown> | null;
  readonly versioning_policy: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt?: Date;
}

/**
 * The BLD-02 tab → document-field mapping. Each of the
 * twelve sections owns exactly the fields its tab edits;
 * `general` is the one section that owns two top-level
 * fields (name and description are the wizard's step-1
 * basics).
 */
export const SECTION_FIELDS: Readonly<
  Record<SectionName, readonly string[]>
> = Object.freeze({
  general: ['name', 'description'],
  metadata: ['tags', 'data_mode'],
  'jev-behavior': ['jev_behavior'],
  'role-assignments': ['role_assignments'],
  'roles-permissions': ['roles_permissions'],
  forms: ['forms'],
  versioning: ['versioning_policy'],
  'data-routing': ['routing_config'],
  'field-mapping': ['field_mapping'],
  lifecycle: ['lifecycle_prefs'],
  retention: ['retention_policy'],
  'deprecation-notice': ['deprecation_notice'],
});

/**
 * Apply a section patch to a definition: one section's
 * fields are replaced wholesale, the version bumps, and the
 * update timestamp advances. A pure function over the
 * document — the repository owns the atomic write around it.
 */
export function applySectionPatch(
  doc: AppDefinitionDocument,
  section: SectionName,
  patch: Record<string, unknown>,
  nextVersion: number,
): AppDefinitionDocument {
  const updated: Record<string, unknown> = { ...doc };
  for (const field of SECTION_FIELDS[section] ?? []) {
    if (field in patch) {
      updated[field] = patch[field];
    }
  }
  updated['version'] = nextVersion;
  updated['updatedAt'] = new Date();
  return updated as unknown as AppDefinitionDocument;
}

/** The unique `app_id` is already taken (the duplicate-create guard). */
export class AppIdInUseError extends BuilderError {
  constructor(appId: string) {
    super('APP_ID_IN_USE', `app ID already in use: ${appId}`);
  }
}

/** No definition carries that `app_id`. */
export class AppNotFoundError extends BuilderError {
  constructor(appId: string) {
    super('APP_NOT_FOUND', `app not found: ${appId}`);
  }
}

/** A version-guarded write lost the race; the caller retries. */
export class VersionConflictError extends BuilderError {
  constructor(appId: string) {
    super('VERSION_CONFLICT', `concurrent edit conflict on app: ${appId}`);
  }
}

/** Bounded optimistic-concurrency retries for version-guarded writes. */
const MAX_WRITE_ATTEMPTS = 5;

export class AppDefinitionRepository {
  constructor(private readonly mongo: MongoService) {}

  private get collection() {
    return this.mongo.db().collection<AppDefinitionDocument>('apps');
  }

  private get versions() {
    return this.mongo
      .db()
      .collection<VersionSnapshotDocument>('app_definition_versions');
  }

  private ensureIndexPromise: Promise<void> | null = null;

  /**
   * The unique `app_id` index — the duplicate-create guard.
   * Idempotent and memoised: a second call reuses the first
   * promise, so a boot storm cannot race index creation.
   */
  private ensureIndex(): Promise<void> {
    if (this.ensureIndexPromise === null) {
      this.ensureIndexPromise = this.collection
        .createIndex({ app_id: 1 }, { unique: true, background: true })
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.ensureIndexPromise;
  }

  /**
   * Create the first draft of a user-authored app (the
   * wizard's step 1). Version 1, lifecycle `draft`, and the
   * unique index is what makes a duplicate `app_id`
   * impossible — the insert fails at the database, and the
   * driver's `11000` is mapped to the named inline error.
   */
  async createDraft(input: {
    app_id: string;
    name: string;
    description: string;
    createdBy: string;
    data_mode?: AppDataMode;
    tags?: readonly string[];
    forms?: readonly import('@akane/contract').AppFormElement[];
    roles?: Record<string, unknown>;
  }): Promise<AppDefinitionDocument> {
    await this.ensureIndex();
    const doc: AppDefinitionDocument = {
      app_id: input.app_id,
      name: input.name,
      description: input.description,
      data_mode: input.data_mode ?? 'internal',
      lifecycle: 'draft',
      version: 1,
      tags: input.tags ?? [],
      forms: input.forms ?? [
        {
          form_id: 'submit',
          kind: 'submit',
          schema: {},
          form_version: 1,
          triggers: null,
          config: {},
        },
      ],
      roles: input.roles ?? {},
      routing_config: null,
      field_mapping: null,
      retention_policy: null,
      deprecation_notice: null,
      lifecycle_prefs: null,
      jev_behavior: null,
      role_assignments: null,
      roles_permissions: null,
      versioning_policy: null,
      metadata: null,
      createdBy: input.createdBy,
      createdAt: new Date(),
    };
    try {
      await this.collection.insertOne(doc as OptionalId<AppDefinitionDocument>);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AppIdInUseError(input.app_id);
      }
      throw error;
    }
    return doc;
  }

  async findByAppId(appId: string): Promise<AppDefinitionDocument | null> {
    return this.collection.findOne({ app_id: appId });
  }

  /**
   * Apply a tab edit atomically: the section's fields, the
   * next version, and the timestamp land in **one**
   * `findOneAndUpdate` guarded on the version the patch was
   * computed against — a concurrent edit that already bumped
   * the version makes this write match nothing, and the
   * loop re-reads and retries (bounded).
   */
  async updateSection(
    appId: string,
    section: SectionName,
    patch: Record<string, unknown>,
  ): Promise<AppDefinitionDocument | null> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const current = await this.collection.findOne({ app_id: appId });
      if (current === null) {
        return null;
      }
      const nextVersion = current.version + 1;
      const updated = applySectionPatch(current, section, patch, nextVersion);
      const { _id, ...withoutId } = updated;
      const result = await this.collection.findOneAndUpdate(
        { app_id: appId, version: current.version },
        { $set: { ...withoutId } },
        { returnDocument: 'after' },
      );
      if (result !== null) {
        return result;
      }
    }
    throw new VersionConflictError(appId);
  }

  /**
   * Move the lifecycle state (and any accompanying fields —
   * the deprecation notice, a restored snapshot) atomically
   * with the version bump, guarded on the version the
   * transition was computed against. The caller owns the
   * transition-table check; this is the write.
   */
  async setLifecycle(
    appId: string,
    lifecycle: AppLifecycleState,
    extra: Record<string, unknown> = {},
    expectedVersion?: number,
  ): Promise<AppDefinitionDocument | null> {
    const current = await this.collection.findOne({ app_id: appId });
    if (current === null) {
      return null;
    }
    const nextVersion = current.version + 1;
    const result = await this.collection.findOneAndUpdate(
      {
        app_id: appId,
        version: expectedVersion ?? current.version,
      },
      {
        $set: {
          ...extra,
          lifecycle,
          version: nextVersion,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    return result ?? null;
  }

  /** Every definition currently in the `published` lifecycle — the routing distribution's membership. */
  async listPublished(): Promise<AppDefinitionDocument[]> {
    return this.collection.find({ lifecycle: 'published' }).toArray();
  }

  async listByOwner(ownerUserId: string): Promise<AppDefinitionDocument[]> {
    return this.collection.find({ createdBy: ownerUserId }).toArray();
  }

  /**
   * Move the app's ownership (ACL-05) —
   * the approved transfer's write: the
   * definition's `createdBy` becomes the
   * target user, and the update timestamp
   * advances. The approval transition and
   * this write are one service method, so
   * the record and the owner never disagree.
   * Returns the updated definition, or
   * `null` when no definition carries the
   * `app_id`.
   */
  async transferOwnership(
    appId: string,
    newOwnerUserId: string,
  ): Promise<AppDefinitionDocument | null> {
    const current = await this.collection.findOne({ app_id: appId });
    if (current === null) {
      return null;
    }
    return this.collection.findOneAndUpdate(
      { app_id: appId },
      {
        $set: {
          createdBy: newOwnerUserId,
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
  }

  /**
   * Write a full definition snapshot into the version history
   * (APP-03). The compound unique index on `(app_id, version)`
   * makes a concurrent double-write of the same version
   * impossible.
   */
  async snapshotVersion(
    appId: string,
    version: number,
    snapshot: AppDefinitionDocument,
    savedBy: string,
  ): Promise<void> {
    await this.ensureVersionsIndex();
    const { _id, ...definition } = snapshot;
    await this.versions.insertOne({
      app_id: appId,
      version,
      snapshot: definition,
      savedBy,
      savedAt: new Date(),
    } as OptionalId<VersionSnapshotDocument>);
  }

  async listVersions(appId: string): Promise<VersionSnapshotDocument[]> {
    return this.versions
      .find({ app_id: appId })
      .sort({ version: 1 })
      .toArray();
  }

  /**
   * Evict the oldest retained version — a **single atomic
   * `findOneAndDelete` of the minimum version at or below the
   * retention cutoff, never a bulk delete that could race a
   * concurrent snapshot (APP-03). Versions are monotonic and
   * each mutation adds exactly one, so at most one version
   * falls out of the window per mutation.
   */
  async evictOldestVersion(
    appId: string,
    cutoffVersion: number,
  ): Promise<VersionSnapshotDocument | null> {
    return this.versions.findOneAndDelete(
      { app_id: appId, version: { $lte: cutoffVersion } },
      { sort: { version: 1 } },
    );
  }

  async findVersion(
    appId: string,
    version: number,
  ): Promise<VersionSnapshotDocument | null> {
    return this.versions.findOne({ app_id: appId, version });
  }

  private versionsIndexPromise: Promise<void> | null = null;

  private ensureVersionsIndex(): Promise<void> {
    if (this.versionsIndexPromise === null) {
      this.versionsIndexPromise = this.versions
        .createIndex(
          { app_id: 1, version: 1 },
          { unique: true, background: true },
        )
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.versionsIndexPromise;
  }
}

/**
 * One retained version of an app definition (APP-03): the
 * full definition as it stood at `version`, who saved it,
 * and when. Rollback re-writes a retained snapshot as the
 * current definition at a **new** version number — history
 * is append-only, never rewritten.
 */
export interface VersionSnapshotDocument {
  readonly _id?: string;
  readonly app_id: string;
  readonly version: number;
  readonly snapshot: AppDefinitionDocument;
  readonly savedBy: string;
  readonly savedAt: Date;
}

/** The driver's duplicate-key failure — the unique-index guard firing. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
