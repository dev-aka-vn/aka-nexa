import {
  CreateAppDraftSchema,
  DeprecateAppSchema,
  UpdateSectionSchema,
  type CreateAppDraftInput,
  type SectionName,
} from '@akane/contract';
import { z } from 'zod';

import {
  AppLifecycle,
  BuilderError,
  type AppLifecycleState,
} from './app-lifecycle.js';
import { assertCuratedTags } from './template/tag-set.js';
import {
  AppDefinitionRepository,
  AppIdInUseError,
  AppNotFoundError,
  VersionConflictError,
  type AppDefinitionDocument,
  type VersionSnapshotDocument,
} from './data-access/app-definition.repository.js';
import { AuditRepository, type AuditEntry } from '../audit/audit.repository.js';

/**
 * The app-definition service (BLD-02, APP-03, APP-05,
 * APP-06, D-86) — every method an **audited transition**.
 *
 * ## The audited-transition invariant (D-86)
 *
 * No method writes a definition or moves a lifecycle
 * state without appending the matching AUD-01 entry via
 * `AuditRepository.append` — `{actor, action, target:
 * app_id, previous_state, new_state}`. A repository
 * method that sets lifecycle fields without an
 * accompanying append is a defect; the repository owns
 * writes, this service owns the audit trail, and every
 * mutation does exactly one of each.
 *
 * ## The commitPublish seam (APP-02, plan 05)
 *
 * `commitPublish` is the transition the plan-05 publish
 * gate calls **after** its dry-run passes. The gate owns
 * the gate (routing dry-run, description collision,
 * change summary); this service owns the transition it
 * commits. Nothing here decides *whether* to publish —
 * only the state change and its audit row.
 *
 * ## Versioning (APP-03)
 *
 * Every mutation — section edit, publish, deprecate,
 * archive, rollback — bumps the integer version and
 * writes a full definition snapshot into the retained
 * history (the last 20 versions; the 21st evicts the
 * oldest). Rollback is itself a transition: it
 * re-writes a retained snapshot as the current
 * definition at a **new** version number, never a
 * time-travel delete.
 */

/** How many versions of an app definition are retained (APP-03). */
export const RETAINED_VERSIONS = 20;

/** Bounded optimistic-concurrency retries for check-then-write transitions. */
const MAX_TRANSITION_ATTEMPTS = 5;

/** A Zod validation failure, carried inline with the offending fields (BLD-07). */
export class AppDefinitionValidationError extends BuilderError {
  constructor(
    public readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(
      'APP_DEFINITION_VALIDATION',
      issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    );
  }
}

export class AppDefinitionService {
  constructor(
    private readonly repository: AppDefinitionRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The wizard's step 1: create the draft. The `app_id`
   * is validated inline against the lowercase-hyphenated
   * rule (the error names the rule, BLD-07), and the
   * repository's unique index makes a duplicate a named
   * `app ID already in use` refusal.
   */
  async createDraft(
    input: CreateAppDraftInput,
    ownerUserId: string,
  ): Promise<AppDefinitionDocument> {
    const parsed = CreateAppDraftSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppDefinitionValidationError(parsed.error.issues);
    }

    const draft = await this.repository.createDraft({
      ...parsed.data,
      createdBy: ownerUserId,
    });

    await this.audit.append({
      timestamp: new Date(),
      actor: ownerUserId,
      action: 'app.definition_created',
      target: draft.app_id,
      new_state: draft.lifecycle,
    });

    return draft;
  }

  /**
   * Edit one BLD-02 tab section. The update bumps the
   * version and appends the audited transition — the
   * mutation and its audit row are the method's two
   * halves (D-86).
   */
  async updateSection(
    appId: string,
    actor: string,
    section: SectionName,
    patch: Record<string, unknown>,
  ): Promise<AppDefinitionDocument> {
    const parsed = UpdateSectionSchema.safeParse({ section, patch });
    if (!parsed.success) {
      throw new AppDefinitionValidationError(parsed.error.issues);
    }
    await this.assertExists(appId);
    // D-107 (T-06-16): the metadata tab carries the app's
    // tags, and tags are the curated platform vocabulary —
    // an out-of-vocabulary tag is refused inline, naming
    // the allowed set, before anything is written.
    if (
      parsed.data.section === 'metadata' &&
      'tags' in parsed.data.patch
    ) {
      assertCuratedTags(parsed.data.patch['tags']);
    }

    const updated = await this.repository.updateSection(
      appId,
      parsed.data.section,
      parsed.data.patch,
    );    if (updated === null) {
      throw new AppNotFoundError(appId);
    }

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'app.definition_updated',
      target: appId,
      previous_state: updated.lifecycle,
      new_state: updated.lifecycle,
      section: parsed.data.section,
    });

    await this.snapshot(appId, updated, actor);

    return updated;
  }

  /**
   * The plan-05 gate's seam: commit the publish
   * transition after the gate's dry-run passes. Only
   * `draft → published` is legal; anything else is
   * refused with the named illegal-transition error.
   */
  async commitPublish(appId: string, actor: string): Promise<AppDefinitionDocument> {
    return this.transition(appId, actor, 'published', 'app.published', {});
  }

  /**
   * Deprecate (APP-05): the app stays functional —
   * existing links, triggers, and submissions keep
   * working — but carries the owner-supplied notice on
   * every surface that renders the app, and the
   * trigger-registration path refuses it.
   */
  async deprecate(
    appId: string,
    actor: string,
    notice: string,
  ): Promise<AppDefinitionDocument> {
    const parsed = DeprecateAppSchema.safeParse({ notice });
    if (!parsed.success) {
      throw new AppDefinitionValidationError(parsed.error.issues);
    }

    return this.transition(
      appId,
      actor,
      'deprecated',
      'app.deprecated',
      { deprecation_notice: parsed.data.notice },
    );
  }

  /**
   * Archive (APP-06): the terminal state. New
   * submissions are refused (`SUBMISSION_REFUSED_ARCHIVED`
   * through the seam the submission-creation path calls);
   * already-issued view links keep resolving because the
   * read verifier is deliberately unchanged.
   */
  async archive(appId: string, actor: string): Promise<AppDefinitionDocument> {
    return this.transition(appId, actor, 'archived', 'app.archived', {});
  }

  /**
   * Rollback (APP-03): re-write a retained snapshot as
   * the current definition at a **new** version number,
   * with an audited `app.rollback` transition naming the
   * source version. Rollback is itself a transition, not
   * a time-travel delete — the version history keeps
   * every version it retained.
   */
  async rollback(
    appId: string,
    actor: string,
    version: number,
  ): Promise<AppDefinitionDocument> {
    const current = await this.repository.findByAppId(appId);
    if (current === null) {
      throw new AppNotFoundError(appId);
    }

    const retained = await this.repository.findVersion(appId, version);
    if (retained === null) {
      throw new BuilderError(
        'VERSION_NOT_RETAINED',
        `version ${version} of app ${appId} is not retained`,
      );
    }

    const restored: AppDefinitionDocument = {
      ...retained.snapshot,
      app_id: appId,
      version: current.version + 1,
      updatedAt: new Date(),
    };

    const { _id, ...definition } = restored;
    const written = await this.repository.setLifecycle(
      appId,
      restored.lifecycle,
      { ...definition },
      current.version,
    );
    if (written === null) {
      throw new VersionConflictError(appId);
    }

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'app.rollback',
      target: appId,
      previous_state: current.lifecycle,
      new_state: written.lifecycle,
      source_version: version,
    });

    await this.snapshot(appId, written, actor);

    return written;
  }

  /**
   * The submission-creation seam's guard (APP-06): the
   * repository that writes submission records calls this
   * before every insert, so an archived app accepts no
   * new submissions while its existing view links keep
   * resolving through the unchanged read verifier.
   */
  async assertAcceptsSubmissions(appId: string): Promise<void> {
    const definition = await this.repository.findByAppId(appId);
    if (definition === null) {
      throw new AppNotFoundError(appId);
    }
    AppLifecycle.assertAcceptsSubmissions(appId, definition.lifecycle);
  }

  /**
   * The trigger-registration seam's guard (APP-05): the
   * path that activates an app's declared
   * triggers/slash commands calls this before
   * registering, so a deprecated app registers no new
   * triggers.
   */
  async assertRegistersTriggers(appId: string): Promise<void> {
    const definition = await this.repository.findByAppId(appId);
    if (definition === null) {
      throw new AppNotFoundError(appId);
    }
    AppLifecycle.assertRegistersTriggers(appId, definition.lifecycle);
  }

  async listByOwner(ownerUserId: string): Promise<AppDefinitionDocument[]> {
    return this.repository.listByOwner(ownerUserId);
  }

  async findByAppId(appId: string): Promise<AppDefinitionDocument | null> {
    return this.repository.findByAppId(appId);
  }

  async listVersions(appId: string): Promise<VersionSnapshotDocument[]> {
    return this.repository.listVersions(appId);
  }

  /** Refuse a mutation on an `app_id` no definition carries. */
  private async assertExists(appId: string): Promise<void> {
    const definition = await this.repository.findByAppId(appId);
    if (definition === null) {
      throw new AppNotFoundError(appId);
    }
  }

  /**
   * The shared check-then-write body for every
   * lifecycle transition: re-read, re-check the
   * transition table against the *current* state, then
   * write guarded on the version that was checked — so
   * a concurrent transition cannot interleave between
   * the check and the write. The audit row is appended
   * only for the transition that actually landed.
   */
  private async transition(
    appId: string,
    actor: string,
    to: AppLifecycleState,
    action: string,
    extra: Record<string, unknown>,
  ): Promise<AppDefinitionDocument> {
    for (let attempt = 0; attempt < MAX_TRANSITION_ATTEMPTS; attempt++) {
      const current = await this.repository.findByAppId(appId);
      if (current === null) {
        throw new AppNotFoundError(appId);
      }

      AppLifecycle.assertTransition(current.lifecycle, to);

      const written = await this.repository.setLifecycle(
        appId,
        to,
        extra,
        current.version,
      );
      if (written !== null) {
        await this.audit.append({
          timestamp: new Date(),
          actor,
          action,
          target: appId,
          previous_state: current.lifecycle,
          new_state: written.lifecycle,
        });

        await this.snapshot(appId, written, actor);

        return written;
      }
      // Lost the version race — re-check against the fresh state.
    }
    throw new VersionConflictError(appId);
  }

  /**
   * Retain the definition at its new version (APP-03):
   * snapshot it, then evict the oldest version beyond
   * the retained window — one atomic
   * `findOneAndDelete` of the minimum version at or
   * below the cutoff, never a bulk delete.
   */
  private async snapshot(
    appId: string,
    definition: AppDefinitionDocument,
    savedBy: string,
  ): Promise<void> {
    await this.repository.snapshotVersion(
      appId,
      definition.version,
      definition,
      savedBy,
    );
    await this.repository.evictOldestVersion(
      appId,
      definition.version - RETAINED_VERSIONS,
    );
  }
}

/** Re-exported for callers that branch on the named refusal. */
export { AppIdInUseError, AppNotFoundError, VersionConflictError };
export type { AuditEntry };
