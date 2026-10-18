/**
 * APP-03 — version retention and rollback.
 *
 * The invariants this spec locks:
 *
 * 1. **Retention is a window, not a ledger.** Twenty-one
 *    consecutive section updates produce twenty-one new
 *    versions, but the history retains **exactly the last
 *    20** — the oldest snapshot is evicted by each
 *    mutation that pushes the window, and the version
 *    counter stays monotonic (never reused, never
 *    skipped).
 * 2. **Rollback is a transition, not time travel.**
 *    Rolling back to a retained version re-writes that
 *    snapshot as the current definition at a **new**
 *    version number, with an audited `app.rollback`
 *    entry naming the source version. The history is
 *    append-only: the rolled-back-to version stays in
 *    the window, and the eviction that follows the
 *    rollback's own snapshot keeps the window at 20.
 * 3. **A version outside the window is not rollbackable.**
 *    `VERSION_NOT_RETAINED` names the version and the
 *    app — an inline, specific refusal (BLD-07).
 *
 * The repository is an in-memory double that models the
 * same snapshot/evict semantics the Mongo repository
 * owns (`snapshotVersion` → compound-unique insert,
 * `evictOldestVersion` → single `findOneAndDelete` of the
 * minimum version at or below the cutoff); the
 * Mongo-backed behavior — the unique index, the atomic
 * eviction — is proven by the integration spec over
 * testcontainers.
 */

import { describe, expect, it } from 'vitest';

import { AuditRepository, type AuditEntry } from '../audit/audit.repository.js';
import {
  AppDefinitionRepository,
  AppNotFoundError,
  applySectionPatch,
  type AppDefinitionDocument,
  type VersionSnapshotDocument,
} from './data-access/app-definition.repository.js';
import { AppDefinitionService } from './app-definition.service.js';
import type { SectionName } from '@akane/contract';

const OWNER = 'user-0001';
const ACTOR = 'user-0001';

const VALID_INPUT = {
  name: 'Leave Request',
  app_id: 'leave-request',
  description: 'Request time off',
} as const;

/**
 * In-memory double modeling the version-history
 * semantics: snapshots append, eviction removes the
 * single oldest version at or below the cutoff.
 */
class FakeRepository {
  readonly docs = new Map<string, AppDefinitionDocument>();
  readonly snapshots = new Map<string, VersionSnapshotDocument[]>();

  async createDraft(input: {
    app_id: string;
    name: string;
    description: string;
    createdBy: string;
  }): Promise<AppDefinitionDocument> {
    const doc: AppDefinitionDocument = {
      app_id: input.app_id,
      name: input.name,
      description: input.description,
      data_mode: 'internal',
      lifecycle: 'draft',
      version: 1,
      tags: [],
      forms: [
        {
          form_id: 'submit',
          kind: 'submit',
          schema: {},
          form_version: 1,
          triggers: null,
          config: {},
        },
      ],
      roles: {},
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
    this.docs.set(input.app_id, doc);
    return doc;
  }

  async findByAppId(appId: string): Promise<AppDefinitionDocument | null> {
    return this.docs.get(appId) ?? null;
  }

  async updateSection(
    appId: string,
    section: SectionName,
    patch: Record<string, unknown>,
  ): Promise<AppDefinitionDocument | null> {
    const doc = this.docs.get(appId);
    if (doc === undefined) {
      return null;
    }
    const updated = applySectionPatch(doc, section, patch, doc.version + 1);
    this.docs.set(appId, updated);
    return updated;
  }

  async setLifecycle(
    appId: string,
    lifecycle: AppDefinitionDocument['lifecycle'],
    extra: Record<string, unknown> = {},
    expectedVersion?: number,
  ): Promise<AppDefinitionDocument | null> {
    const doc = this.docs.get(appId);
    if (doc === undefined) {
      return null;
    }
    if (expectedVersion !== undefined && doc.version !== expectedVersion) {
      return null;
    }
    const updated: AppDefinitionDocument = {
      ...doc,
      ...extra,
      lifecycle,
      version: doc.version + 1,
      updatedAt: new Date(),
    } as AppDefinitionDocument;
    this.docs.set(appId, updated);
    return updated;
  }

  async snapshotVersion(
    appId: string,
    version: number,
    snapshot: AppDefinitionDocument,
    savedBy: string,
  ): Promise<void> {
    const rows = this.snapshots.get(appId) ?? [];
    rows.push({ app_id: appId, version, snapshot, savedBy, savedAt: new Date() });
    this.snapshots.set(appId, rows);
  }

  async listVersions(appId: string): Promise<VersionSnapshotDocument[]> {
    return [...(this.snapshots.get(appId) ?? [])].sort(
      (a, b) => a.version - b.version,
    );
  }

  async evictOldestVersion(
    appId: string,
    cutoffVersion: number,
  ): Promise<VersionSnapshotDocument | null> {
    const rows = this.snapshots.get(appId) ?? [];
    const oldest = rows.find((row) => row.version <= cutoffVersion);
    if (oldest === undefined) {
      return null;
    }
    this.snapshots.set(appId, rows.filter((row) => row !== oldest));
    return oldest;
  }

  async findVersion(
    appId: string,
    version: number,
  ): Promise<VersionSnapshotDocument | null> {
    return (
      (this.snapshots.get(appId) ?? []).find(
        (row) => row.version === version,
      ) ?? null
    );
  }
}

describe('version retention and rollback (APP-03)', () => {
  function setup(): {
    service: AppDefinitionService;
    audit: AuditRepository;
    repository: FakeRepository;
  } {
    const audit = new AuditRepository();
    const repository = new FakeRepository();
    const service = new AppDefinitionService(
      repository as unknown as AppDefinitionRepository,
      audit,
    );
    return { service, audit, repository };
  }

  it('21 consecutive section updates retain exactly the last 20 versions — the oldest is evicted, the counter is monotonic', async () => {
    const { service, repository } = setup();

    await service.createDraft(VALID_INPUT, OWNER);

    // 21 consecutive updates, each editing the general tab.
    for (let i = 2; i <= 22; i++) {
      const updated = await service.updateSection(
        'leave-request',
        ACTOR,
        'general',
        { name: `Leave Request v${i}` },
      );
      // The version counter is monotonic: each update is
      // exactly one more than the last.
      expect(updated.version).toBe(i);
    }

    // Exactly 20 versions retained — the 21st update's
    // snapshot evicted the oldest (version 2).
    const retained = await repository.listVersions('leave-request');
    expect(retained).toHaveLength(20);

    // The retained window is the LAST 20 versions: 3..22.
    expect(retained.map((row) => row.version)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 3),
    );

    // The oldest snapshot is gone; the newest is present.
    expect(await repository.findVersion('leave-request', 2)).toBeNull();
    expect(await repository.findVersion('leave-request', 22)).not.toBeNull();

    // The current definition carries the newest version.
    const current = await repository.findByAppId('leave-request');
    expect(current?.version).toBe(22);
    expect(current?.name).toBe('Leave Request v22');
  });

  it('rollback re-writes a retained snapshot as the current definition at a NEW version, with an audited app.rollback entry naming the source version', async () => {
    const { service, audit, repository } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    // Twelve updates → versions 2..13, all retained.
    for (let i = 2; i <= 13; i++) {
      await service.updateSection(
        'leave-request',
        ACTOR,
        'general',
        { name: `Leave Request v${i}` },
      );
    }

    // Roll back to version 5.
    const rolledBack = await service.rollback(
      'leave-request',
      ACTOR,
      5,
    );

    // A NEW version number — one more than the current 13.
    expect(rolledBack.version).toBe(14);
    // The rolled-back-to content is now current...
    expect(rolledBack.name).toBe('Leave Request v5');
    expect((await repository.findByAppId('leave-request'))?.name).toBe(
      'Leave Request v5',
    );

    // ...and the history keeps the source version (append-only,
    // never rewritten) plus the rollback's own snapshot.
    expect(
      await repository.findVersion('leave-request', 5),
    ).not.toBeNull();
    expect(
      await repository.findVersion('leave-request', 14),
    ).not.toBeNull();

    // The audited transition: action app.rollback, naming the
    // source version in the entry.
    const entries = await audit.findAll();
    const entry: AuditEntry | undefined = entries.find(
      (e) => e.action === 'app.rollback',
    );
    expect(entry).toMatchObject({
      actor: ACTOR,
      target: 'leave-request',
      previous_state: 'draft',
      new_state: 'draft',
      source_version: 5,
    });
  });

  it('rollback evicts the oldest beyond the window, keeping retention at 20', async () => {
    const { service, repository } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    // 21 updates → window holds versions 3..22.
    for (let i = 2; i <= 22; i++) {
      await service.updateSection(
        'leave-request',
        ACTOR,
        'general',
        { name: `Leave Request v${i}` },
      );
    }

    // Roll back to version 10 → new version 23, whose
    // snapshot evicts version 3 (cutoff 23 - 20).
    await service.rollback('leave-request', ACTOR, 10);

    const retained = await repository.listVersions('leave-request');
    expect(retained).toHaveLength(20);
    expect(retained.map((row) => row.version)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 4),
    );
  });

  it('rollback to a version outside the retained window is refused with the named VERSION_NOT_RETAINED error', async () => {
    const { service } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    for (let i = 2; i <= 22; i++) {
      await service.updateSection(
        'leave-request',
        ACTOR,
        'general',
        { name: `Leave Request v${i}` },
      );
    }

    // Version 2 was evicted — it is not retained.
    await expect(service.rollback('leave-request', ACTOR, 2)).rejects.toThrow(
      /VERSION_NOT_RETAINED/,
    );
    // Neither is a version that never existed.
    await expect(
      service.rollback('leave-request', ACTOR, 99),
    ).rejects.toThrow(/VERSION_NOT_RETAINED/);
  });

  it('rollback on an unknown app is refused with the named not-found error', async () => {
    const { service } = setup();

    await expect(service.rollback('nope', ACTOR, 1)).rejects.toThrow(
      AppNotFoundError,
    );
  });
});
