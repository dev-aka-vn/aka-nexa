/**
 * The template gallery (D-105, D-106, D-108) — the
 * platform-owned template collection and the
 * snapshot fork.
 *
 * ## The loader (D-105, T-06-17)
 *
 * `load()` reads the ten frozen seed files into the
 * platform-owned `templates` collection under a
 * **content-hash guard**: each record carries the
 * sha256 of its seed content, so a second load is a
 * no-op (same `template_id` + same hash → skip),
 * and a changed seed (different hash) is replaced.
 * The guard is what makes the loader idempotent —
 * a reload never duplicates platform templates, and
 * a boot storm cannot race a double-insert.
 *
 * ## The fork (D-108)
 *
 * `forkTemplate` deep-copies a template into a
 * **user-owned draft** in the `apps` collection.
 * The fork carries **no origin-reference field** —
 * no `template_id`, no provenance, no
 * update-subscription: a later template change
 * never touches an existing fork, and APP-03
 * versioning governs the fork from version 1
 * exactly like a hand-created draft. The deep
 * copy is structural (`structuredClone`), so the
 * fork's form schema shares no reference with the
 * platform record.
 *
 * ## Ownership
 *
 * Templates are platform-owned and read-only to
 * builders: the gallery exposes `GET /templates`
 * and `POST /templates/:id/fork` — there is no
 * template-mutation surface anywhere.
 *
 * ## The connector expectation (D-106)
 *
 * `external` and `hybrid` templates carry a
 * `connector_ref` — the connector the routed
 * submissions flow to — and **nothing else**: no
 * credentials, no secrets (T-06-18). Credentials
 * live in the connector-credential store, never
 * in a definition.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AppDefinitionValidationError } from '../app-definition.service.js';
import type {
  AppDataMode,
  AppDefinitionDocument,
} from '../data-access/app-definition.repository.js';
import { BuilderError } from '../app-lifecycle.js';
import type { AppDefinitionRepository } from '../data-access/app-definition.repository.js';
import { AuditRepository } from '../../audit/audit.repository.js';
import { AppFormElementSchema, AppIdSchema } from '@akane/contract';
import type { AppFormElement } from '@akane/contract';
import type { MongoService } from '@akane/platform';

import { assertCuratedTags } from './tag-set.js';

import leaveRequest from './seeds/leave-request.json' with {
  type: 'json',
};
import travelRequest from './seeds/travel-request.json' with {
  type: 'json',
};
import procurementRequest from './seeds/procurement-request.json' with {
  type: 'json',
};
import assetRequest from './seeds/asset-request.json' with {
  type: 'json',
};
import hrRequest from './seeds/hr-request.json' with { type: 'json' };
import itHelpdeskTicket from './seeds/it-helpdesk-ticket.json' with {
  type: 'json',
};
import facilitiesRequest from './seeds/facilities-request.json' with {
  type: 'json',
};
import expenseReport from './seeds/expense-report.json' with {
  type: 'json',
};
import redmineIssue from './seeds/redmine-issue.json' with {
  type: 'json',
};
import crmContact from './seeds/crm-contact.json' with { type: 'json' };

/**
 * One seed file, as authored. The Zod schema below
 * is the frozen contract every seed must satisfy —
 * a seed that drifts out of shape fails the load
 * loudly rather than entering the gallery.
 */
export interface TemplateSeedInput {
  readonly template_id: string;
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly tags: readonly string[];
  readonly data_mode: AppDataMode;
  readonly connector_ref: string | null;
  /** The seed's form set (D-09) — one array is the whole form set. */
  readonly forms: readonly AppFormElement[];
  readonly roles: Record<string, unknown>;
}

/**
 * A stored template record: the seed content plus
 * the loader's own fields — the content hash that
 * guards idempotency, the platform ownership
 * marker, and the load timestamp.
 */
export interface TemplateRecord extends TemplateSeedInput {
  /** sha256 of the seed content — the idempotency guard (T-06-17). */
  readonly content_hash: string;
  /** Every template is platform-owned (D-105). */
  readonly owner: 'platform';
  readonly loadedAt: Date;
}

/**
 * The frozen seed contract. `strict()` so an
 * unlisted field — a stray `credentials` block,
 * say — is rejected at load rather than stored
 * (T-06-18).
 */
export const TemplateSeedSchema = z
  .object({
    template_id: AppIdSchema,
    name: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
    domain: z.string().min(1).max(200),
    // Only the curated vocabulary (D-107, T-06-16).
    tags: z.array(z.string()).min(1),
    data_mode: z.enum(['internal', 'external', 'hybrid']),
    connector_ref: z.string().min(1).nullable().default(null),
    // The form set (D-09/D-11): `strict()` per element so a
    // stale seed still carrying `form_schema` is rejected at
    // load rather than silently loading (T-07-02).
    forms: z.array(AppFormElementSchema),
    roles: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (seed) =>
      seed.data_mode === 'internal'
        ? seed.connector_ref === undefined ||
          seed.connector_ref === null
        : typeof seed.connector_ref === 'string' &&
          seed.connector_ref.length > 0,
    {
      message:
        'external/hybrid templates carry a connector_ref; internal templates carry none',
    },
  )
  .superRefine((seed, ctx) => {
    // D-02: at most one form per kind per app.
    const seenKinds = new Set<string>();
    seed.forms.forEach((form, index) => {
      if (seenKinds.has(form.kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate form kind: ${form.kind}`,
          path: ['forms', index, 'kind'],
        });
      }
      seenKinds.add(form.kind);
    });

    const submitIndex = seed.forms.findIndex(
      (form) => form.kind === 'submit',
    );
    const submitForm =
      submitIndex >= 0 ? seed.forms[submitIndex] : undefined;

    // A submit form without a schema is rejected.
    if (submitForm !== undefined && submitForm.schema === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'submit form requires a schema',
        path: ['forms', submitIndex, 'schema'],
      });
    }

    // Collect the submit schema's component keys (one level).
    const submitKeys = new Set<string>();
    if (
      submitForm !== undefined &&
      submitForm.schema !== null &&
      typeof submitForm.schema === 'object'
    ) {
      const components = (submitForm.schema as { components?: unknown })
        .components;
      if (Array.isArray(components)) {
        for (const component of components) {
          if (
            component !== null &&
            typeof component === 'object' &&
            typeof (component as { key?: unknown }).key === 'string'
          ) {
            submitKeys.add((component as { key: string }).key);
          }
        }
      }
    }

    // D-03: every show form's fields must be submit-schema keys.
    seed.forms.forEach((form, index) => {
      if (form.kind !== 'show') return;
      const fields = form.config?.fields ?? [];
      for (const field of fields) {
        if (!submitKeys.has(field)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `show form field not in submit schema: ${field}`,
            path: ['forms', index, 'config', 'fields'],
          });
        }
      }
      // If a show form exists but no submit schema to derive
      // keys from, the subset rule cannot be satisfied.
      if (submitForm === undefined || submitForm.schema === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'show form requires a submit form with a schema',
          path: ['forms', index, 'kind'],
        });
      }
    });

    // D-04: list forms carry non-empty query_id + columns.
    // (ListFormConfigSchema already enforces min(1); repeat here
    // so the rejection is attributed to the seed's form.)
    seed.forms.forEach((form, index) => {
      if (form.kind !== 'list') return;
      const config = form.config as { query_id?: string; columns?: string[] };
      if (typeof config.query_id !== 'string' || config.query_id.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'list form requires a non-empty query_id',
          path: ['forms', index, 'config', 'query_id'],
        });
      }
      if (!Array.isArray(config.columns) || config.columns.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'list form requires non-empty columns',
          path: ['forms', index, 'config', 'columns'],
        });
      }
    });
  });

/**
 * The ten D-106 seed files: the eight internal
 * request domains plus the external/hybrid examples
 * that make the connector-request flow
 * demonstrable.
 */
export const TEMPLATE_SEEDS: readonly TemplateSeedInput[] =
  Object.freeze([
    leaveRequest,
    travelRequest,
    procurementRequest,
    assetRequest,
    hrRequest,
    itHelpdeskTicket,
    facilitiesRequest,
    expenseReport,
    redmineIssue,
    crmContact,
  ]) as readonly TemplateSeedInput[];

/** sha256 over the seed content — the idempotency guard. */
export function templateContentHash(seed: TemplateSeedInput): string {
  return createHash('sha256')
    .update(JSON.stringify(seed))
    .digest('hex');
}

export class TemplateSeed {
  constructor(
    private readonly mongo: MongoService,
    private readonly definitions: AppDefinitionRepository,
    private readonly audit: AuditRepository,
  ) {}

  private get collection() {
    return this.mongo
      .db()
      .collection<TemplateRecord>('templates');
  }

  private indexPromise: Promise<void> | null = null;

  /**
   * The unique `template_id` index — one record per
   * template, enforced at the database.
   */
  private ensureIndex(): Promise<void> {
    if (this.indexPromise === null) {
      this.indexPromise = this.collection
        .createIndex({ template_id: 1 }, { unique: true })
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.indexPromise;
  }

  /**
   * Load the frozen seeds into the platform-owned
   * collection. Idempotent: a stored record whose
   * content hash matches its seed is skipped, so a
   * second load is a no-op and a changed seed is
   * replaced under its `template_id`.
   */
  async load(): Promise<void> {
    await this.ensureIndex();
    for (const seed of TEMPLATE_SEEDS) {
      const parsed = TemplateSeedSchema.safeParse(seed);
      if (!parsed.success) {
        // A seed that does not satisfy the frozen
        // contract is a programming error — fail the
        // load loudly rather than gallery a broken
        // template.
        throw new AppDefinitionValidationError(parsed.error.issues);
      }
      assertCuratedTags(parsed.data.tags);

      const contentHash = templateContentHash(parsed.data);
      const existing = await this.collection.findOne({
        template_id: parsed.data.template_id,
      });
      if (
        existing !== null &&
        existing.content_hash === contentHash
      ) {
        // Same template_id + same content: the
        // guard's no-op.
        continue;
      }
      await this.collection.replaceOne(
        { template_id: parsed.data.template_id },
        {
          ...parsed.data,
          content_hash: contentHash,
          owner: 'platform',
          loadedAt: new Date(),
        },
        { upsert: true },
      );
    }
  }

  /** The gallery — every platform-owned template. */
  async listTemplates(): Promise<TemplateRecord[]> {
    return this.collection
      .find({})
      .sort({ template_id: 1 })
      .toArray();
  }

  /**
   * Fork a template into a user-owned draft (D-108).
   *
   * The fork is a **snapshot**: the template's
   * definition is deep-copied into the `apps`
   * collection as a draft with **no
   * origin-reference field** — no `template_id`, no
   * provenance, no update-subscription. The draft
   * is then governed by BLD-02/APP-03 like any
   * hand-created one: section edits bump the
   * version, lifecycle transitions move it, and the
   * platform template is never touched again.
   *
   * @param templateId the template to fork
   * @param ownerUserId the forking builder — the draft's owner
   * @param requestedAppId an optional user-chosen `app_id`; defaults to the template's id
   */
  async forkTemplate(
    templateId: string,
    ownerUserId: string,
    requestedAppId?: string,
  ): Promise<AppDefinitionDocument> {
    const template = await this.collection.findOne({
      template_id: templateId,
    });
    if (template === null) {
      throw new BuilderError(
        'TEMPLATE_NOT_FOUND',
        `template not found: ${templateId}`,
      );
    }

    const appId = requestedAppId ?? template.template_id;
    const parsed = AppIdSchema.safeParse(appId);
    if (!parsed.success) {
      throw new AppDefinitionValidationError(parsed.error.issues);
    }
    // The fork carries only curated tags (D-107) —
    // the template's tags are curated by contract,
    // asserted again at the fork boundary so a
    // mutated stored record cannot smuggle one in.
    assertCuratedTags(template.tags);

    // The deep copy: the fork's forms and roles share no
    // reference with the platform record, so no later
    // template write can reach an existing fork (D-108 —
    // `forms` carried wholesale, no origin-reference field).
    const draft = await this.definitions.createDraft({
      app_id: appId,
      name: template.name,
      description: template.description,
      createdBy: ownerUserId,
      data_mode: template.data_mode,
      tags: [...template.tags],
      forms: structuredClone(template.forms) as AppFormElement[],
      roles: structuredClone(template.roles),
    });

    // The fork's creation is an audited transition
    // like any other (D-86).
    await this.audit.append({
      timestamp: new Date(),
      actor: ownerUserId,
      action: 'app.definition_created',
      target: draft.app_id,
      new_state: draft.lifecycle,
    });

    return draft;
  }
}
