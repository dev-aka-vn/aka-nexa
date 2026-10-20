/**
 * BLD-02 / APP-02 / APP-05 / D-86 — the app-definition
 * lifecycle, end-to-end over real MongoDB (testcontainers)
 * through the API endpoints.
 *
 * Every behavior here is a plan invariant, and each is
 * asserted through the HTTP surface a builder admin drives:
 *
 * 1. `POST /apps` with `{name, app_id, description}` creates a
 *    **draft** — and a draft is unreachable by any link,
 *    trigger, or route (APP-02): the JEV routing path only ever
 *    exposes `published` apps, so a draft in the catalog
 *    authorizes nothing. A non-conforming `app_id` is rejected
 *    inline, naming the lowercase-hyphenated rule.
 * 2. `PATCH /apps/:id` with a general-settings section update
 *    creates version 2 and appends the AUD-01 entry
 *    `{actor, action: 'app.definition_updated', target, previous_state,
 *    new_state}` (D-86 — the audit log is the process's real one,
 *    not a double).
 * 3. `POST /apps/:id/deprecate` sets lifecycle `deprecated` with
 *    the owner-supplied notice, appends the transition, and the
 *    trigger-registration seam refuses the app
 *    (`TRIGGER_REGISTER_REFUSED_DEPRECATED`, APP-05).
 * 4. A duplicate `app_id` is rejected with the specific inline
 *    `app ID already in use` error — the unique index on the
 *    `apps` collection is the guard.
 *
 * ## What this spec deliberately does not cover
 *
 * Version retention and rollback (APP-03's 20-version window)
 * and the archive/submission gate (APP-06) are task 2's
 * behaviors and live in `app-definition.versions.spec.ts` and
 * the task-2 extension of this file.
 */

import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AppDefinitionService,
  AppLifecycle,
  AuditRepository,
  PermissionCheckService,
  PublishedAppLoader,
  ReadVerifierService,
  RbacCacheService,
  RbacService,
  Submission,
  SubmissionRepository,
  TemplateSeed,
  type PublishedApp,
  type ReadLinkJwtVerifier,
} from '@akane/domain';
import { ConfigModule, MongoService } from '@akane/platform';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

import { AppBuilderModule } from './app-builder.module.js';
import { ReadModule } from '../read/read.module.js';

const OWNER = 'user-0001';

/** Reserve an ephemeral loopback port for the listening app. */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** A JSON POST/PUT/PATCH helper returning `{status, body}`. */
async function call(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

// ─── Real ES256 read-link minting (the APP-06 proof) ──────────────────
//
// The read path is deliberately unchanged by archiving (APP-06), so the
// proof needs a genuinely signed view link: an ES256 JWT minted with
// Node's built-in crypto — no jose import (R2 boundary) — verified by a
// NodeCryptoJwtVerifier that performs real public-key verification, the
// same shape the platform crypto module owns in production.

const { privateKey: READ_LINK_PRIVATE_KEY, publicKey: READ_LINK_PUBLIC_KEY } =
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const READ_LINK_PUBLIC_PEM = READ_LINK_PUBLIC_KEY.export({
  type: 'spki',
  format: 'pem',
}) as string;
const READ_LINK_PRIVATE_PEM = READ_LINK_PRIVATE_KEY.export({
  type: 'sec1',
  format: 'pem',
}) as string;

/** The renderer origin the deployment issues links for. */
const READ_LINK_ISSUER = 'https://akane.test';
const READ_LINK_AUDIENCE = 'https://renderer.akane.test';

/**
 * Sign a read-link payload with the deployment's
 * ES256 key. The header carries the deployment's
 * key id by default; `{ kidless: true }` omits
 * it — the verifier's kid-keyed lookup then
 * falls through to its per-key try path
 * (jwt-verifier.ts), the shape a single-key
 * deployment's links take.
 */
function signReadLink(
  payload: Record<string, unknown>,
  opts: { kidless?: boolean } = {},
): string {
  const header: Record<string, string> = {
    alg: 'ES256',
    typ: 'JWT',
  };
  if (!opts.kidless) {
    header.kid = 'read-link-1';
  }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  const signature = signer.sign(
    { key: READ_LINK_PRIVATE_PEM, dsaEncoding: 'ieee-p1363' },
  );
  return `${signingInput}.${signature.toString('base64url')}`;
}

/**
 * Real ES256 verification with the public key alone — the
 * production-verification path, re-implemented over node:crypto so the
 * spec never reaches jose (R2).
 */
class NodeCryptoReadLinkVerifier implements ReadLinkJwtVerifier {
  async verify(token: string): Promise<Record<string, unknown>> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('bad_signature');
    }
    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(sigB64, 'base64url');
    const verifier = createVerify('SHA256');
    verifier.update(signingInput);
    if (
      !verifier.verify(
        { key: READ_LINK_PUBLIC_PEM, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    ) {
      throw new Error('bad_signature');
    }
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString(),
    ) as Record<string, unknown>;
    if (payload.iss !== READ_LINK_ISSUER || payload.aud !== READ_LINK_AUDIENCE) {
      throw new Error('bad_signature');
    }
    return payload;
  }
}

/** The frozen D-21 view-link claim set for one submission. */
function viewLinkClaims(input: {
  jti: string;
  sub: string;
  appId: string;
  targetId: string;
}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: READ_LINK_ISSUER,
    aud: READ_LINK_AUDIENCE,
    sub: input.sub,
    jti: input.jti,
    iat: now,
    nbf: now,
    exp: now + 3600,
    action: 'view',
    app_id: input.appId,
    form_id: `${input.appId}-form`,
    form_version: 1,
    app_version: 1,
    perm_version: 1,
    query_version: 1,
    target_id: input.targetId,
  };
}

/**
 * The frozen D-21 edit-link claim set for one
 * submission — the view set with the `edit`
 * action discriminant (D-40). `permVersion`
 * is the epoch the link was minted at; two
 * links minted at different epochs keep the
 * permission cache's key distinct.
 */
function editLinkClaims(input: {
  jti: string;
  sub: string;
  appId: string;
  targetId: string;
  permVersion?: number;
}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: READ_LINK_ISSUER,
    aud: READ_LINK_AUDIENCE,
    sub: input.sub,
    jti: input.jti,
    iat: now,
    nbf: now,
    exp: now + 3600,
    action: 'edit',
    app_id: input.appId,
    form_id: `${input.appId}-form`,
    form_version: 1,
    app_version: 1,
    perm_version: input.permVersion ?? 1,
    query_version: 1,
    target_id: input.targetId,
  };
}

/**
 * A ReadVerifierService over the real permission check — the same
 * composition the read path uses, with the RBAC seam stubbed to allow
 * (the permission policy itself is the authz element's concern, not the
 * lifecycle's).
 */
function readVerifierFor(sub: string): ReadVerifierService {
  const rbac = new RbacService();
  const cache = new RbacCacheService();
  vi.spyOn(rbac, 'hasPermission').mockResolvedValue(true);
  // The permission check caches the granted-permission list after
  // the first allow (PermissionCheckService.check) — the grant list
  // must carry the view permission or the cached hit denies.
  vi.spyOn(rbac, 'getPermissions').mockResolvedValue([
    'asset-request:view',
  ]);
  return new ReadVerifierService(
    new NodeCryptoReadLinkVerifier(),
    new PermissionCheckService(rbac, cache),
    {
      // The submission record written before the archive — the link's
      // target keeps resolving because the verifier does not consume
      // lifecycle state.
      async findByIdOwned(submissionId: string, realUserId: string) {
        return {
          _id: submissionId,
          real_user_id: realUserId,
          app_id: 'asset-request',
          form_id: 'asset-request-form',
          form_version: 1,
          data: { asset: 'laptop-042' },
        };
      },
    },
  );
}

describe('app-definition lifecycle (BLD-02, APP-02, APP-05, D-86)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;
  let app: INestApplication;
  let baseUrl: string;
  let service: AppDefinitionService;
  let audit: AuditRepository;
  let templateSeed: TemplateSeed;
  let submissionStore: SubmissionRepository;
  let rbacCache: RbacCacheService;

  beforeAll(async () => {
    containers = await startThreeContainers();
    mongo = new MongoService(containers.urls.mongo);

    process.env.NODE_ENV = 'test';
    process.env.SERVICE_NAME = 'api';
    process.env.MONGO_URL = containers.urls.mongo;
    process.env.REDIS_CACHE_URL = containers.urls.cache;
    process.env.REDIS_QUEUE_URL = containers.urls.queue;
    // The read surface (mounted below for the APP-06
    // real-path proof) reads its link-verification
    // config from the process environment at module
    // initialization — the same four keys README's
    // "Read-link verification" section documents.
    process.env.JWT_ISSUER = READ_LINK_ISSUER;
    process.env.JWT_AUDIENCE = READ_LINK_AUDIENCE;
    process.env.JWT_READ_PUBLIC_KEY = READ_LINK_PUBLIC_PEM;
    process.env.RENDERER_ORIGIN = 'https://renderer.akane.test';

    const port = await reservePort();
    const moduleRef = await Test.createTestingModule({
      // ReadModule is mounted for the APP-06
      // real-path proof: the archived-submission
      // refusal is asserted through the same
      // POST /l/edit/:jti the renderer's form
      // submit fires, not through a direct
      // service call.
      imports: [ConfigModule, AppBuilderModule, ReadModule],
    }).compile();

    service = moduleRef.get(AppDefinitionService);
    audit = moduleRef.get(AuditRepository);
    templateSeed = moduleRef.get(TemplateSeed);
    submissionStore = moduleRef.get(SubmissionRepository);
    rbacCache = moduleRef.get(RbacCacheService);

    // D-105: the gallery loads at boot (main.ts does this
    // step in production; the spec runs it directly).
    await templateSeed.load();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(port, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await mongo?.client.close();
    await containers?.stop();
  });

  it('POST /apps creates a draft that no link, trigger, or route reaches (APP-02)', async () => {
    const created = await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      app_id: 'leave-request',
      name: 'Leave Request',
      description: 'Request time off',
      lifecycle: 'draft',
      version: 1,
    });

    // The draft is fetchable by its owner...
    const fetched = await call('GET', `${baseUrl}/apps/leave-request`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({ lifecycle: 'draft' });

    // ...but unreachable by any link, trigger, or route: the JEV
    // routing path only ever exposes published apps, so a draft in
    // the catalog authorizes nothing for any user.
    const catalog: PublishedApp[] = [
      {
        id: 'leave-request',
        description: 'Request time off',
        parameters: [],
        intents: ['request leave'],
        aliases: [],
        threshold: 0.5,
        forms: [],
        status: (fetched.body as { lifecycle: string }).lifecycle as
          | 'published'
          | 'draft'
          | 'deprecated',
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => true);
    const authorized = await loader.listAuthorized(OWNER);
    expect(authorized).toHaveLength(0);
  });

  it('rejects a non-conforming app_id inline, naming the rule', async () => {
    const rejected = await call('POST', `${baseUrl}/apps`, {
      name: 'Bad',
      app_id: 'Bad_Id',
      description: 'nope',
    });

    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).toMatch(/lowercase-hyphenated/);
  });

  it('rejects a duplicate app_id with the specific inline error', async () => {
    await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    });

    const duplicate = await call('POST', `${baseUrl}/apps`, {
      name: 'Leave Request',
      app_id: 'leave-request',
      description: 'Request time off',
    });

    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).toMatch(/app ID already in use/);
  });

  it('PATCH /apps/:id creates version 2 and appends the audited transition (D-86)', async () => {
    const before = await audit.findAll();

    const patched = await call('PATCH', `${baseUrl}/apps/leave-request`, {
      section: 'general',
      patch: { name: 'Leave Request v2' },
    });

    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      app_id: 'leave-request',
      name: 'Leave Request v2',
      version: 2,
    });

    // Exactly one new AUD-01 entry with the frozen transition shape.
    const after = await audit.findAll();
    expect(after.length).toBe(before.length + 1);
    const entry = after[after.length - 1]!;
    expect(entry.action).toBe('app.definition_updated');
    expect(entry.target).toBe('leave-request');
    expect(entry.previous_state).toBe('draft');
    expect(entry.new_state).toBe('draft');
    expect((entry as any).section).toBe('general');
  });

  it('PATCH /apps/:id refuses an unknown section inline', async () => {
    const rejected = await call('PATCH', `${baseUrl}/apps/leave-request`, {
      section: 'not-a-section',
      patch: { x: 1 },
    });

    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).toMatch(/section/);
  });

  it('deprecate sets the owner-supplied notice and the trigger path refuses the app (APP-05)', async () => {
    // Publish first: deprecation is a published → deprecated transition.
    const published = await call('POST', `${baseUrl}/apps/leave-request/publish`);
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ lifecycle: 'published', version: 3 });

    const deprecated = await call('POST', `${baseUrl}/apps/leave-request/deprecate`, {
      notice: 'Being replaced by the new HR portal',
    });

    expect(deprecated.status).toBe(200);
    expect(deprecated.body).toMatchObject({
      lifecycle: 'deprecated',
      deprecation_notice: 'Being replaced by the new HR portal',
    });

    const entries = await audit.findAll();
    expect(
      entries.find((e) => e.action === 'app.deprecated'),
    ).toMatchObject({
      target: 'leave-request',
      previous_state: 'published',
      new_state: 'deprecated',
    });

    // The trigger-registration seam refuses deprecated apps.
    expect(() =>
      AppLifecycle.assertRegistersTriggers('leave-request', 'deprecated'),
    ).toThrow(/TRIGGER_REGISTER_REFUSED_DEPRECATED/);
  });

  it('archive sets the terminal state and refuses submissions (APP-06 seam)', async () => {
    const archived = await call('POST', `${baseUrl}/apps/leave-request/archive`);

    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ lifecycle: 'archived' });

    // The submission-creation seam calls this guard — an archived
    // app accepts no new submissions.
    await expect(service.assertAcceptsSubmissions('leave-request')).rejects.toThrow(
      /SUBMISSION_REFUSED_ARCHIVED/,
    );
  });

  it('APP-05: a deprecated app stays functional — notice served, triggers unchanged, no NEW trigger registration', async () => {
    // A fresh app with a declared trigger.
    await call('POST', `${baseUrl}/apps`, {
      name: 'Expense Report',
      app_id: 'expense-report',
      description: 'Report an expense',
    });
    await call('PATCH', `${baseUrl}/apps/expense-report`, {
      section: 'forms',
      patch: {
        forms: [
          {
            form_id: 'submit',
            kind: 'submit',
            schema: {},
            form_version: 1,
            triggers: {
              intents: [],
              aliases: ['/expense'],
              threshold: 0.8,
            },
            config: {},
          },
        ],
      },
    });
    await call('POST', `${baseUrl}/apps/expense-report/publish`);

    const deprecated = await call('POST', `${baseUrl}/apps/expense-report/deprecate`, {
      notice: 'Use the finance portal from Q3',
    });

    expect(deprecated.status).toBe(200);
    expect(deprecated.body).toMatchObject({
      lifecycle: 'deprecated',
      deprecation_notice: 'Use the finance portal from Q3',
    });

    // The served definition still carries its form set — the
    // submit form's trigger unchanged — deprecation changes no
    // behavior, only the notice.
    const fetched = await call('GET', `${baseUrl}/apps/expense-report`);
    expect(fetched.body).toMatchObject({ lifecycle: 'deprecated' });
    expect(
      (
        fetched.body as {
          forms: Array<{ triggers: unknown }>;
        }
      ).forms[0].triggers,
    ).toEqual({ intents: [], aliases: ['/expense'], threshold: 0.8 });

    // A deprecated app still accepts submissions (APP-05:
    // "stays functional")...
    await expect(
      service.assertAcceptsSubmissions('expense-report'),
    ).resolves.toBeUndefined();

    // ...but the trigger-registration path refuses it.
    expect(() =>
      AppLifecycle.assertRegistersTriggers('expense-report', 'deprecated'),
    ).toThrow(/TRIGGER_REGISTER_REFUSED_DEPRECATED/);
  });

  it('APP-06 both ways: an archived app refuses new submissions on the real path while a pre-archived view link still resolves', async () => {
    await call('POST', `${baseUrl}/apps`, {
      name: 'Asset Request',
      app_id: 'asset-request',
      description: 'Request an asset',
    });
    await call('POST', `${baseUrl}/apps/asset-request/publish`);

    // The submission the edit links target. The read path's
    // submission store is the in-memory seam the IN-01 deferral
    // records; seeding it here is the same write the provisioner
    // performs when a chat-driven submission lands.
    submissionStore.upsert({
      _id: 'sub-asset-1',
      real_user_id: OWNER,
      app_id: 'asset-request',
      form_id: 'asset-request-form',
      form_version: 1,
      form_schema: {},
      data: { asset: 'laptop-042' },
      created_at: new Date(),
      status: 'completed',
    });

    // Control — the real submission path works while the app is
    // published: a POST /l/edit/:jti (the same request the
    // renderer's form submit fires) is accepted and writes the
    // revision carrying its edit jti.
    const liveToken = signReadLink(
      editLinkClaims({
        jti: 'jti-edit-live',
        sub: OWNER,
        appId: 'asset-request',
        targetId: 'sub-asset-1',
        permVersion: 1,
      }),
      { kidless: true },
    );
    const live = await call(
      'POST',
      `${baseUrl}/l/edit/jti-edit-live?token=${encodeURIComponent(liveToken)}`,
      { subject: 'edited while live' },
    );
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: 'accepted' });

    // A view link, minted and verified BEFORE the archive — the
    // submission it points at was written while the app was live.
    const token = signReadLink(
      viewLinkClaims({
        jti: 'jti-asset-1',
        sub: OWNER,
        appId: 'asset-request',
        targetId: 'sub-asset-1',
      }),
    );
    const verifier = readVerifierFor(OWNER);
    const before = await verifier.verify(token);
    expect(before.ok).toBe(true);

    // Archive the app.
    const archived = await call('POST', `${baseUrl}/apps/asset-request/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ lifecycle: 'archived' });

    // Way 1 — the real path now refuses: an edit link issued
    // while the app was published still submits through the same
    // POST /l/edit/:jti, and the submission-creation seam's
    // lifecycle guard (APP-06) answers 409
    // SUBMISSION_REFUSED_ARCHIVED. (The second link is minted at
    // a later perm_version epoch so the permission check's cache
    // key stays distinct from the control's.)
    const refusedToken = signReadLink(
      editLinkClaims({
        jti: 'jti-edit-refused',
        sub: OWNER,
        appId: 'asset-request',
        targetId: 'sub-asset-1',
        permVersion: 2,
      }),
      { kidless: true },
    );
    const refused = await call(
      'POST',
      `${baseUrl}/l/edit/jti-edit-refused?token=${encodeURIComponent(refusedToken)}`,
      { subject: 'edited after archive' },
    );
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      error: 'SUBMISSION_REFUSED_ARCHIVED',
    });

    // The refusal wrote nothing: the submission's only revision
    // is the pre-archive one, carrying the control's edit jti.
    const revisions = await mongo
      .db()
      .collection('submission_revisions')
      .find({ submission_id: 'sub-asset-1' })
      .toArray();
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.edit_jti).toBe('jti-edit-live');

    // The refusal consumed no token: the same link retries to
    // the same 409, never a replay of a recorded outcome.
    // (The permission cache is invalidated first: the
    // RbacService stub's grant list is a fixed
    // ['leave:request'] that does not carry the view
    // permission, so its cache would poison a second
    // check on the same key — a stub artifact, not the
    // production behavior, where the cached grant list
    // is the list the check tests against.)
    rbacCache.invalidate('asset-request', OWNER, 2);
    const retry = await call(
      'POST',
      `${baseUrl}/l/edit/jti-edit-refused?token=${encodeURIComponent(refusedToken)}`,
      { subject: 'edited after archive, again' },
    );
    expect(retry.status).toBe(409);
    // Way 2 — the pre-archived view link STILL resolves through
    // the unchanged ReadVerifierService: the verifier consumes
    // signature, claims, ownership, and permissions — not the
    // lifecycle field — so already-issued links keep working.
    const after = await verifier.verify(token);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.claims.app_id).toBe('asset-request');
      expect(after.submission?.app_id).toBe('asset-request');
    }
  });

  it('GET /templates serves the ten-template gallery, every one platform-owned (D-105, D-106)', async () => {
    const gallery = await call('GET', `${baseUrl}/templates`);

    expect(gallery.status).toBe(200);
    const templates = (gallery.body as { templates: Record<string, unknown>[] })
      .templates;
    expect(templates).toHaveLength(10);

    // Every template is platform-owned and read-only to
    // builders — the gallery exposes no mutation route.
    for (const template of templates) {
      expect(template.owner).toBe('platform');
    }

    // The D-106 domains: the internal request domains
    // plus the external/hybrid examples.
    const ids = templates.map((t) => t.template_id).sort();
    expect(ids).toEqual(
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
      ],
    );

    // The external/hybrid examples carry a connector_ref
    // expectation — and no credentials, ever (T-06-18).
    const redmine = templates.find(
      (t) => t.template_id === 'redmine-issue',
    )!;
    expect(redmine.data_mode).toBe('external');
    expect(redmine.connector_ref).toBe('redmine');
    expect(JSON.stringify(redmine)).not.toMatch(/credential|secret/i);
  });

  it('POST /templates/:id/fork deep-copies a template into a user-owned draft with no origin reference (D-108)', async () => {
    const forked = await call('POST', `${baseUrl}/templates/travel-request/fork`, {
      app_id: 'team-travel',
    });

    expect(forked.status).toBe(201);
    expect(forked.body).toMatchObject({
      app_id: 'team-travel',
      name: 'Travel Request',
      lifecycle: 'draft',
      version: 1,
    });

    // D-108: a snapshot, not a reference — no origin
    // field, no provenance, no update-subscription.
    const keys = Object.keys(forked.body);
    for (const field of [
      'template_id',
      'origin',
      'provenance',
      'template',
      'forked_from',
    ]) {
      expect(keys).not.toContain(field);
    }

    // The template's definition traveled with the fork.
    expect((forked.body as { tags: string[] }).tags).toEqual([
      'travel',
      'all-staff',
    ]);
    expect(
      (forked.body as { forms: unknown }).forms,
    ).toEqual(
      (
        await templateSeed.listTemplates()
      ).find((t) => t.template_id === 'travel-request')!.forms,
    );

    // The fork is editable under BLD-02/APP-03 rules.
    const edited = await call('PATCH', `${baseUrl}/apps/team-travel`, {
      section: 'general',
      patch: { name: 'Team Travel' },
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      app_id: 'team-travel',
      name: 'Team Travel',
      version: 2,
    });
  });

  it('rejects a tag outside the curated vocabulary, naming the allowed set (D-107)', async () => {
    await call('POST', `${baseUrl}/apps`, {
      name: 'Tagged',
      app_id: 'tagged-app',
      description: 'A tagged app',
    });

    const rejected = await call('PATCH', `${baseUrl}/apps/tagged-app`, {
      section: 'metadata',
      patch: { tags: ['not-a-real-tag'] },
    });

    expect(rejected.status).toBe(400);
    const rendered = JSON.stringify(rejected.body);
    expect(rendered).toMatch(/curated platform set/);
    // The allowed vocabulary is named in the refusal.
    expect(rendered).toMatch(/time-off/);
    expect(rendered).toMatch(/all-staff/);
    expect(rendered).toMatch(/engineering/);
    expect(rendered).toMatch(/not-a-real-tag/);
  });

  it('accepts curated tags on the metadata section', async () => {
    await call('POST', `${baseUrl}/apps`, {
      name: 'Curated',
      app_id: 'curated-app',
      description: 'A curated app',
    });

    const updated = await call('PATCH', `${baseUrl}/apps/curated-app`, {
      section: 'metadata',
      patch: { tags: ['time-off', 'hr'] },
    });

    expect(updated.status).toBe(200);
    expect((updated.body as { tags: string[] }).tags).toEqual([
      'time-off',
      'hr',
    ]);
  });
});
