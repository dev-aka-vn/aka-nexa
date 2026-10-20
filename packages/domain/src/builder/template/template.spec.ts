/**
 * D-105..D-108 — the template gallery: the curated
 * platform template collection, the idempotent D-31
 * loader, and the snapshot fork.
 *
 * ## The invariants
 *
 * 1. **The gallery is platform-owned and frozen at
 *    boot.** Ten seed files, one per D-106 domain,
 *    loaded by a content-hash guard: a second load is
 *    a no-op — the same `template_id` + the same
 *    content hash leaves the stored record untouched
 *    (T-06-17). Every template carries `owner:
 *    'platform'`; builders read the gallery and fork
 *    from it, they never write to it.
 * 2. **A fork is a snapshot, not a reference (D-108).**
 *    `forkTemplate` deep-copies the template into a
 *    user-owned draft in the `apps` collection with
 *    **no origin-reference field** — no `template_id`,
 *    no provenance, no update-subscription. A later
 *    template change cannot touch an existing fork,
 *    and APP-03 versioning governs the fork from
 *    version 1 like any hand-created draft.
 * 3. **The tag vocabulary is curated (D-107, T-06-16).**
 *    User apps accept tags from the frozen platform
 *    set only; an out-of-vocabulary tag is rejected
 *    inline, naming the allowed set.
 *
 * The Mongo-backed behavior (the unique `template_id`
 * index, the atomic upsert) is proven by the
 * integration spec over testcontainers; this spec
 * exercises the loader and fork semantics over an
 * in-memory collection double.
 */

import { describe, expect, it } from 'vitest';

import {
  AppDefinitionRepository,
  AppDefinitionService,
  AuditRepository,
  type AuditEntry,
  type AppDefinitionDocument,
} from '../../index.js';
import {
  TemplateSeed,
  TEMPLATE_SEEDS,
  TemplateSeedSchema,
} from './template.seed.js';
import { PLATFORM_TAGS } from './tag-set.js';
import type { MongoService } from '@akane/platform';

const OWNER = 'user-0001';
const ACTOR = 'user-0001';

const VALID_INPUT = {
  name: 'Leave Request',
  app_id: 'leave-request',
  description: 'Request time off',
} as const;

// ─── In-memory collection double ─────────────────────────────
//
// Models exactly the operations the loader, the fork and
// the definition repository use: equality-matched
// findOne, upserting replaceOne, insertOne, createIndex
// and find. Indexes are not enforced here — the unique
// guards are the database's job, proven over
// testcontainers.

type Doc = Record<string, unknown> & { _id?: string };

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `fake-id-${idCounter}`;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = doc[key];
    // Operator subdocuments (`{ $lte: n }` — the
    // eviction cutoff) compare numerically.
    if (
      expected !== null &&
      typeof expected === 'object' &&
      !Array.isArray(expected)
    ) {
      return Object.entries(expected).every(([op, value]) => {
        switch (op) {
          case '$lte':
            return (actual as number) <= (value as number);
          case '$lt':
            return (actual as number) < (value as number);
          case '$gte':
            return (actual as number) >= (value as number);
          case '$gt':
            return (actual as number) > (value as number);
          default:
            return JSON.stringify(actual) === JSON.stringify(value);
        }
      });
    }
    if (Array.isArray(expected)) {
      return (
        Array.isArray(actual) &&
        actual.length === expected.length &&
        expected.every((value, i) =>
          JSON.stringify(value) === JSON.stringify(actual[i]),
        )
      );
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  });
}

class FakeCollection {
  private readonly docs: Doc[] = [];

  constructor(private readonly name: string) {}

  async createIndex(): Promise<string> {
    return 'fake-index';
  }

  async insertOne(doc: Doc): Promise<{ insertedId: string }> {
    // The unique indexes the database enforces — the
    // duplicate-create guard surfaces as the driver's
    // 11000, which the repository maps to the named
    // inline refusal.
    if (
      this.name === 'apps' &&
      this.docs.some((existing) => existing.app_id === doc.app_id)
    ) {
      throw { code: 11000, keyPattern: { app_id: 1 } };
    }
    const stored = { ...doc, _id: typeof doc._id === 'string' ? doc._id : nextId() };
    this.docs.push(stored);
    return { insertedId: stored._id! };
  }

  async findOne(filter: Doc): Promise<Doc | null> {
    return this.docs.find((doc) => matches(doc, filter)) ?? null;
  }

  async findOneAndUpdate(
    filter: Doc,
    update: { $set?: Doc },
  ): Promise<Doc | null> {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index < 0) {
      return null;
    }
    const merged = { ...this.docs[index], ...(update.$set ?? {}) };
    this.docs[index] = merged;
    return merged;
  }

  async findOneAndDelete(
    filter: Doc,
    options?: { sort?: Record<string, number> },
  ): Promise<Doc | null> {
    const matching = this.docs.filter((doc) => matches(doc, filter));
    if (matching.length === 0) {
      return null;
    }
    const sorted = [...matching].sort((a, b) => {
      if (options?.sort === undefined) {
        return 0;
      }
      for (const [key, dir] of Object.entries(options.sort)) {
        const left = a[key] as number;
        const right = b[key] as number;
        const cmp = left < right ? -1 : left > right ? 1 : 0;
        if (cmp !== 0) {
          return dir === 1 ? cmp : -cmp;
        }
      }
      return 0;
    });
    const victim = sorted[0]!;
    this.docs.splice(this.docs.indexOf(victim), 1);
    return victim;
  }

  async replaceOne(
    filter: Doc,
    replacement: Doc,
    options?: { upsert?: boolean },
  ): Promise<{ modifiedCount: number; upsertedId?: string }> {
    const index = this.docs.findIndex((doc) => matches(doc, filter));
    if (index >= 0) {
      this.docs[index] = { ...replacement, _id: this.docs[index]._id };
      return { modifiedCount: 1 };
    }
    if (options?.upsert === true) {
      const id = nextId();
      this.docs.push({ ...replacement, _id: id });
      return { modifiedCount: 0, upsertedId: id };
    }
    return { modifiedCount: 0 };
  }

  find(filter: Doc): {
    sort: () => { toArray: () => Promise<Doc[]> };
  } {
    const matched = this.docs.filter((doc) => matches(doc, filter));
    return { sort: () => ({ toArray: async () => [...matched] }) };
  }
}

class FakeMongoService {
  private readonly collections = new Map<string, FakeCollection>();

  db(): { collection: (name: string) => FakeCollection } {
    return {
      collection: (name: string) => {
        let collection = this.collections.get(name);
        if (collection === undefined) {
          collection = new FakeCollection(name);
          this.collections.set(name, collection);
        }
        return collection;
      },
    };
  }
}

/** The loader + fork subject, wired over the fake like the module wires it. */
function setup(): {
  mongo: FakeMongoService;
  audit: AuditRepository;
  definitions: AppDefinitionRepository;
  templates: TemplateSeed;
  service: AppDefinitionService;
} {
  const mongo = new FakeMongoService();
  const audit = new AuditRepository();
  const definitions = new AppDefinitionRepository(
    mongo as unknown as MongoService,
  );
  const templates = new TemplateSeed(
    mongo as unknown as MongoService,
    definitions,
    audit,
  );
  const service = new AppDefinitionService(definitions, audit);
  return { mongo, audit, definitions, templates, service };
}

describe('template gallery (D-105..D-108)', () => {
  describe('the curated tag vocabulary (D-107)', () => {
    it('freezes the use-case and department axes as one enumerated set', () => {
      // The use-case axis.
      for (const tag of [
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
      ]) {
        expect(PLATFORM_TAGS).toContain(tag);
      }
      // The department axis.
      for (const tag of [
        'engineering',
        'operations',
        'finance',
        'sales',
        'all-staff',
      ]) {
        expect(PLATFORM_TAGS).toContain(tag);
      }
      // One enumerated set — every entry is one of the axes.
      expect(PLATFORM_TAGS.length).toBe(new Set(PLATFORM_TAGS).size);
    });
  });

  describe('the D-31 loader (T-06-17)', () => {
    it('loads all ten seed files, every one platform-owned', async () => {
      const { templates } = setup();

      await templates.load();

      const loaded = await templates.listTemplates();
      expect(loaded).toHaveLength(10);
      expect(TEMPLATE_SEEDS).toHaveLength(10);
      for (const record of loaded) {
        expect(record.owner).toBe('platform');
      }
      // One template per D-106 domain — the gallery covers the
      // internal request domains plus the external/hybrid examples.
      expect(loaded.map((r) => r.template_id).sort()).toEqual(
        [
          'asset-request',
          'crm-contact',
          'expense-report',
          'facilities-request',
          'hr-request',
          'it-helpdesk-ticket',
          'leave-request',
          'procurement-request',
          'redmine-issue',
          'travel-request',
        ].sort(),
      );
    });

    it('is idempotent — a second load is a no-op (same template_id + content hash)', async () => {
      const { templates } = setup();

      await templates.load();
      const first = await templates.listTemplates();
      const firstLoadedAt = first.map((record) => record.loadedAt);
      const firstHashes = first.map((record) => record.content_hash);

      // The second load touches nothing: the content-hash guard
      // recognizes every stored record and skips it.
      await templates.load();

      const second = await templates.listTemplates();
      expect(second).toHaveLength(10);
      expect(second.map((record) => record.loadedAt)).toEqual(
        firstLoadedAt,
      );
      expect(second.map((record) => record.content_hash)).toEqual(
        firstHashes,
      );
    });

    it('every seed carries only curated tags and a valid data mode', async () => {
      const { templates } = setup();
      await templates.load();

      const loaded = await templates.listTemplates();
      for (const record of loaded) {
        for (const tag of record.tags) {
          expect(PLATFORM_TAGS).toContain(tag);
        }
        expect(['internal', 'external', 'hybrid']).toContain(
          record.data_mode,
        );
        // The external/hybrid examples carry a connector_ref
        // expectation — and nothing else: no credentials, ever
        // (T-06-18).
        if (record.data_mode === 'internal') {
          expect(record.connector_ref).toBeNull();
        } else {
          expect(typeof record.connector_ref).toBe('string');
        }
        expect(JSON.stringify(record)).not.toMatch(/credential|secret/i);
      }
    });

    it('all ten seeds parse the strict seed contract carrying forms[] (D-09)', () => {
      expect(TEMPLATE_SEEDS).toHaveLength(10);
      for (const seed of TEMPLATE_SEEDS) {
        const parsed = TemplateSeedSchema.safeParse(seed);
        expect(parsed.success).toBe(true);
      }
    });

    it('every seed carries a submit form with its folded trigger (D-06, D-11)', async () => {
      const { templates } = setup();
      await templates.load();

      const loaded = await templates.listTemplates();
      for (const record of loaded) {
        const submit = record.forms.find((form) => form.kind === 'submit')!;
        expect(submit).toBeDefined();
        expect(submit.kind).toBe('submit');
        expect(submit.form_id).toBe('submit');
        expect(submit.form_version).toBe(1);
        expect(submit.config).toEqual({});
        // The retired slash row folded into the form's trigger:
        // its `command` became an alias (D-06/D-11).
        expect(submit.triggers?.threshold).toBe(0.8);
        expect(submit.triggers?.aliases.length).toBeGreaterThan(0);
      }
    });

    it('rejects a seed still carrying the retired form_schema + triggers shape (Pitfall 6, T-07-02)', () => {
      const legacySeed: Record<string, unknown> = {
        template_id: 'legacy-seed',
        name: 'Legacy Seed',
        description: 'A pre-D-09 seed shape',
        domain: 'legacy',
        tags: ['time-off'],
        data_mode: 'internal',
        connector_ref: null,
        form_schema: { components: [] },
        triggers: [],
        roles: {},
      };

      // `.strict()`: the stale key is an unrecognized key, so
      // the seed is refused at load rather than silently loaded.
      expect(TemplateSeedSchema.safeParse(legacySeed).success).toBe(false);

      const migrated = { ...legacySeed };
      delete migrated['form_schema'];
      delete migrated['triggers'];
      migrated['forms'] = [];
      expect(TemplateSeedSchema.safeParse(migrated).success).toBe(true);
    });
  });

  describe('the D-108 fork', () => {
    it('deep-copies a template into a user-owned draft with no origin reference', async () => {
      const { templates, audit, definitions, service } = setup();
      await templates.load();
      const template = (await templates.listTemplates()).find(
        (record) => record.template_id === 'leave-request',
      )!;

      const forked = await templates.forkTemplate(
        'leave-request',
        OWNER,
      );

      // A user-owned draft, governed by BLD-02/APP-03 from
      // version 1 — exactly like a hand-created draft.
      expect(forked.app_id).toBe('leave-request');
      expect(forked.name).toBe(template.name);
      expect(forked.description).toBe(template.description);
      expect(forked.lifecycle).toBe('draft');
      expect(forked.version).toBe(1);
      expect(forked.createdBy).toBe(OWNER);
      expect(forked.data_mode).toBe('internal');
      // The template's content traveled with the fork...
      expect(forked.forms).toEqual(template.forms);
      expect(forked.roles).toEqual(template.roles);
      expect(forked.tags).toEqual(template.tags);

      // ...as a deep copy, not a reference — mutating the
      // fork's form set cannot reach the platform template.
      expect(forked.forms).not.toBe(template.forms);

      // D-108: no origin-reference field, no provenance, no
      // update-subscription.
      for (const field of [
        'template_id',
        'origin',
        'provenance',
        'template',
        'forked_from',
      ]) {
        expect(field in forked).toBe(false);
      }

      // The creation is audited like any other (D-86).
      const entries: AuditEntry[] = await audit.findAll();
      expect(
        entries.some(
          (entry) =>
            entry.action === 'app.definition_created' &&
            entry.target === 'leave-request',
        ),
      ).toBe(true);

      // The fork is editable under BLD-02/APP-03 rules: a
      // section update bumps the version and appends the
      // audited transition.
      const edited = await service.updateSection(
        'leave-request',
        ACTOR,
        'general',
        { name: 'My Leave Request' },
      );
      expect(edited.version).toBe(2);
      expect(edited.name).toBe('My Leave Request');

      // ...and the stored draft is the fork, not the template:
      // the apps collection holds the user-owned document.
      const stored = await definitions.findByAppId('leave-request');
      expect((stored as AppDefinitionDocument).createdBy).toBe(OWNER);
    });

    it('lets the forker choose the draft app_id', async () => {
      const { templates, service } = setup();
      await templates.load();

      const forked = await templates.forkTemplate(
        'travel-request',
        OWNER,
        'team-travel',
      );

      expect(forked.app_id).toBe('team-travel');
      expect(forked.name).toBe('Travel Request');
      // The chosen id is editable like any draft.
      const edited = await service.updateSection(
        'team-travel',
        ACTOR,
        'general',
        { name: 'Team Travel' },
      );
      expect(edited.version).toBe(2);
    });

    it('refuses an unknown template with a named inline error', async () => {
      const { templates } = setup();
      await templates.load();

      await expect(
        templates.forkTemplate('no-such-template', OWNER),
      ).rejects.toThrow(/TEMPLATE_NOT_FOUND/);
    });

    it('refuses a fork onto an app_id already in use', async () => {
      const { templates, service } = setup();
      await templates.load();
      await service.createDraft(VALID_INPUT, OWNER);

      // leave-request exists — the unique app_id index is the
      // guard, surfaced as the named inline refusal.
      await expect(
        templates.forkTemplate('leave-request', OWNER),
      ).rejects.toThrow(/app ID already in use/);
    });
  });

  describe('the curated-tag gate on user apps (D-107)', () => {
    it('accepts curated tags on the metadata section', async () => {
      const { service } = setup();
      await service.createDraft(VALID_INPUT, OWNER);

      const updated = await service.updateSection(
        'leave-request',
        ACTOR,
        'metadata',
        { tags: ['time-off', 'hr', 'all-staff'] },
      );

      expect(updated.tags).toEqual(['time-off', 'hr', 'all-staff']);
    });

    it('rejects an out-of-vocabulary tag inline, naming the allowed set', async () => {
      const { service } = setup();
      await service.createDraft(VALID_INPUT, OWNER);

      let refusal: unknown;
      try {
        await service.updateSection('leave-request', ACTOR, 'metadata', {
          tags: ['not-a-real-tag'],
        });
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(Error);
      expect((refusal as Error).message).toMatch(/curated platform set/);
      // The allowed vocabulary is named in the refusal.
      for (const tag of ['time-off', 'all-staff', 'engineering']) {
        expect((refusal as Error).message).toContain(tag);
      }
      expect((refusal as Error).message).toContain('not-a-real-tag');
    });
  });
});
