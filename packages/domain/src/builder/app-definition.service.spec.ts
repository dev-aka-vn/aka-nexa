/**
 * BLD-02 / APP-03 / D-86 — the app-definition service, the audited
 * transition model every builder edit runs through.
 *
 * Every behavior here is an invariant the plan freezes:
 *
 * 1. **A draft is a draft.** `createDraft` produces a definition whose
 *    lifecycle is `draft` and whose `app_id` is lowercase-hyphenated —
 *    a non-conforming id is rejected inline, naming the rule rather
 *    than a generic validation failure (BLD-07).
 * 2. **Every tab edit is an audited transition (D-86).** A section
 *    update bumps the integer version and appends exactly one AUD-01
 *    entry carrying `{actor, action: 'app.definition_updated', target:
 *    app_id, previous_state, new_state}`. A mutation without an
 *    append is a defect, so the spec counts audit rows, not just
 *    outcomes.
 * 3. **Deprecation is a transition, not a field write.** Deprecating
 *    sets lifecycle `deprecated` with the owner-supplied notice,
 *    appends the transition, and the trigger-registration path
 *    refuses the app (APP-05's first half — proven here at the guard
 *    the path calls).
 * 4. **`app_id` is the unique identity.** A duplicate create is
 *    rejected with the specific inline `app ID already in use` error —
 *    the repository's unique index is the guard, and the service must
 *    surface it by name.
 *
 * The repository is an in-memory double (the tracer pattern — the
 * Mongo-backed behavior is proven by the integration spec over
 * testcontainers); the `AuditRepository` is the real one, because the
 * audit row *is* the assertion.
 */

import { describe, expect, it } from 'vitest';

import type { SectionName } from '@akane/contract';

import { AuditRepository, type AuditEntry } from '../audit/audit.repository.js';
import {
  AppDefinitionRepository,
  AppIdInUseError,
  applySectionPatch,
  type AppDefinitionDocument,
  type VersionSnapshotDocument,
} from './data-access/app-definition.repository.js';
import { AppDefinitionService } from './app-definition.service.js';
import { AppLifecycle } from './app-lifecycle.js';

const OWNER = 'user-0001';
const ACTOR = 'user-0001';

/** The create input the mockup's wizard step 1 produces. */
const VALID_INPUT = {
  name: 'Leave Request',
  app_id: 'leave-request',
  description: 'Request time off',
} as const;

/**
 * In-memory double for the Mongo-backed repository. It applies the
 * same section-patch mapping the real repository owns
 * (`applySectionPatch`), so the service spec exercises the real
 * document-shape semantics without a Mongo round-trip.
 */
class FakeRepository {
  readonly docs = new Map<string, AppDefinitionDocument>();

  async createDraft(input: {
    app_id: string;
    name: string;
    description: string;
    createdBy: string;
  }): Promise<AppDefinitionDocument> {
    if (this.docs.has(input.app_id)) {
      throw new AppIdInUseError(input.app_id);
    }
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
    section: string,
    patch: Record<string, unknown>,
  ): Promise<AppDefinitionDocument | null> {
    const doc = this.docs.get(appId);
    if (doc === undefined) {
      return null;
    }
    const updated = applySectionPatch(
      doc,
      section as SectionName,
      patch,
      doc.version + 1,
    );
    this.docs.set(appId, updated);
    return updated;
  }

  async setLifecycle(
    appId: string,
    lifecycle: string,
    extra: Record<string, unknown> = {},
  ): Promise<AppDefinitionDocument | null> {
    const doc = this.docs.get(appId);
    if (doc === undefined) {
      return null;
    }
    const updated: AppDefinitionDocument = {
      ...doc,
      ...extra,
      lifecycle: lifecycle as AppDefinitionDocument['lifecycle'],
      version: doc.version + 1,
    };
    this.docs.set(appId, updated);
    return updated;
  }

  async listByOwner(owner: string): Promise<AppDefinitionDocument[]> {
    return [...this.docs.values()].filter((doc) => doc.createdBy === owner);
  }

  readonly snapshots = new Map<string, VersionSnapshotDocument[]>();

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
    return [...(this.snapshots.get(appId) ?? [])].sort((a, b) => a.version - b.version);
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
    this.snapshots.set(
      appId,
      rows.filter((row) => row !== oldest),
    );
    return oldest;
  }

  async findVersion(
    appId: string,
    version: number,
  ): Promise<VersionSnapshotDocument | null> {
    return (
      (this.snapshots.get(appId) ?? []).find((row) => row.version === version) ??
      null
    );
  }
}

describe('AppDefinitionService (BLD-02, APP-03, D-86)', () => {
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

  it('creates a draft with a lowercase-hyphenated app_id, lifecycle draft, version 1', async () => {
    const { service, repository } = setup();

    const draft = await service.createDraft(VALID_INPUT, OWNER);

    expect(draft.lifecycle).toBe('draft');
    expect(draft.version).toBe(1);
    expect(draft.app_id).toBe('leave-request');
    expect(draft.createdBy).toBe(OWNER);
    expect(repository.docs.get('leave-request')).toBeDefined();
  });

  it('rejects a non-conforming app_id inline, naming the rule', async () => {
    const { service } = setup();

    for (const bad of ['Leave_Request', 'UPPERCASE', 'has space', '-leading', 'trailing-', '']) {
      await expect(
        service.createDraft({ ...VALID_INPUT, app_id: bad }, OWNER),
      ).rejects.toThrow(/lowercase-hyphenated/);
    }
  });

  it('rejects a non-conforming name or description inline', async () => {
    const { service } = setup();

    await expect(
      service.createDraft({ ...VALID_INPUT, name: '' }, OWNER),
    ).rejects.toThrow(/name/);
    await expect(
      service.createDraft({ ...VALID_INPUT, description: '' }, OWNER),
    ).rejects.toThrow(/description/);
  });

  it('rejects a duplicate app_id with the specific inline error', async () => {
    const { service } = setup();

    await service.createDraft(VALID_INPUT, OWNER);

    await expect(service.createDraft(VALID_INPUT, OWNER)).rejects.toThrow(
      /app ID already in use/,
    );
  });

  it('a section update bumps the version and appends exactly one audited transition (D-86)', async () => {
    const { service, audit } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    const before = await audit.findAll();

    const updated = await service.updateSection(
      'leave-request',
      ACTOR,
      'general',
      { name: 'Leave Request v2' },
    );

    // Version 1 → 2, and the returned definition carries the edit.
    expect(updated.version).toBe(2);
    expect(updated.name).toBe('Leave Request v2');

    // Exactly one new AUD-01 entry, with the frozen transition shape.
    const after = await audit.findAll();
    expect(after.length).toBe(before.length + 1);
    const entry: AuditEntry = after[after.length - 1]!;
    expect(entry.actor).toBe(ACTOR);
    expect(entry.action).toBe('app.definition_updated');
    expect(entry.target).toBe('leave-request');
    expect(entry.previous_state).toBe('draft');
    expect(entry.new_state).toBe('draft');
    expect((entry as any).section).toBe('general');
  });

  it('refuses a section update on an unknown app', async () => {
    const { service } = setup();

    await expect(
      service.updateSection('nope', ACTOR, 'general', { name: 'x' }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses a section update from a non-owner — the actor is the authorization, not just the audit (CR-01, T-06-27)', async () => {
    const { service, audit, repository } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    const before = await audit.findAll();

    // A non-owner and a missing app are the same refusal:
    // 404, never a 403 that would leak the app's existence.
    await expect(
      service.updateSection(
        'leave-request',
        'user-0002',
        'general',
        { name: 'Attacker rewrite' },
      ),
    ).rejects.toThrow(/not found/i);

    // The refusal wrote nothing — no version bump, no
    // audit row, no rewritten definition.
    expect((await audit.findAll()).length).toBe(before.length);
    const stored = repository.docs.get('leave-request');
    expect(stored?.version).toBe(1);
    expect(stored?.name).toBe(VALID_INPUT.name);
  });

  it('refuses a lifecycle transition from a non-owner — publish, deprecate, and archive are owner-only (CR-01)', async () => {
    const { service, repository } = setup();

    await service.createDraft(VALID_INPUT, OWNER);

    await expect(
      service.commitPublish('leave-request', 'user-0002'),
    ).rejects.toThrow(/not found/i);
    await expect(
      service.deprecate('leave-request', 'user-0002', 'Maintenance window'),
    ).rejects.toThrow(/not found/i);
    await expect(
      service.archive('leave-request', 'user-0002'),
    ).rejects.toThrow(/not found/i);

    // Nothing moved: the definition is still the owner's draft.
    const stored = repository.docs.get('leave-request');
    expect(stored?.lifecycle).toBe('draft');
    expect(stored?.version).toBe(1);
  });

  it('commitPublish moves draft → published through the transition table', async () => {
    const { service, audit } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    const published = await service.commitPublish('leave-request', ACTOR);

    expect(published.lifecycle).toBe('published');
    expect(published.version).toBe(2);

    const entries = await audit.findAll();
    const publishEntry = entries.find((e) => e.action === 'app.published');
    expect(publishEntry).toMatchObject({
      target: 'leave-request',
      previous_state: 'draft',
      new_state: 'published',
    });
  });

  it('refuses commitPublish from a state that cannot publish', async () => {
    const { service } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    await service.commitPublish('leave-request', ACTOR);

    await expect(
      service.commitPublish('leave-request', ACTOR),
    ).rejects.toThrow(/LIFECYCLE_ILLEGAL_TRANSITION/);
  });

  it('deprecate sets the owner-supplied notice and the trigger-registration path refuses the app (APP-05)', async () => {
    const { service, audit } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    await service.commitPublish('leave-request', ACTOR);

    const deprecated = await service.deprecate(
      'leave-request',
      ACTOR,
      'Being replaced by the new HR portal',
    );

    expect(deprecated.lifecycle).toBe('deprecated');
    expect(deprecated.deprecation_notice).toBe('Being replaced by the new HR portal');

    const entries = await audit.findAll();
    const entry = entries.find((e) => e.action === 'app.deprecated');
    expect(entry).toMatchObject({
      actor: ACTOR,
      target: 'leave-request',
      previous_state: 'published',
      new_state: 'deprecated',
    });

    // The trigger-registration path calls this guard — a deprecated app
    // registers no new triggers.
    expect(() =>
      AppLifecycle.assertRegistersTriggers('leave-request', 'deprecated'),
    ).toThrow(/TRIGGER_REGISTER_REFUSED_DEPRECATED/);
  });

  it('archive moves any state to the terminal archived state', async () => {
    const { service, audit } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    await service.commitPublish('leave-request', ACTOR);

    const archived = await service.archive('leave-request', ACTOR);

    expect(archived.lifecycle).toBe('archived');
    const entries = await audit.findAll();
    expect(
      entries.find((e) => e.action === 'app.archived'),
    ).toMatchObject({
      target: 'leave-request',
      previous_state: 'published',
      new_state: 'archived',
    });

    // Terminal: no further transition is legal, and submissions are refused.
    expect(() => AppLifecycle.assertTransition('archived', 'draft')).toThrow(
      /LIFECYCLE_ILLEGAL_TRANSITION/,
    );
    expect(() =>
      AppLifecycle.assertAcceptsSubmissions('leave-request', 'archived'),
    ).toThrow(/SUBMISSION_REFUSED_ARCHIVED/);
  });

  it('lists only the owner definitions', async () => {
    const { service } = setup();

    await service.createDraft(VALID_INPUT, OWNER);
    await service.createDraft(
      { name: 'Travel', app_id: 'travel-request', description: 'Book travel' },
      'user-0002',
    );

    const mine = await service.listByOwner(OWNER);
    expect(mine.map((doc) => doc.app_id)).toEqual(['leave-request']);
  });
});
