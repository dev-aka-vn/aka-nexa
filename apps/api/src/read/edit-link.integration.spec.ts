import { randomUUID } from 'node:crypto';

import {
  AppDefinitionService,
  DataRouterService,
  LinkTokenStore,
  SubmissionRevisionsRepository,
  type RedisStructuralSeam,
} from '@akane/domain';
import { MongoService } from '@akane/platform';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

/**
 * LNK-02 / phase-05 success criterion 4, against real Redis and MongoDB.
 *
 * SC#4 reads: *"An edit link can be reopened repeatedly but consumes on submit,
 * and a second submit returns the original confirmation rather than creating a
 * duplicate record."* Three mechanisms carry that sentence, and each is asserted
 * below:
 *
 * 1. **The claim is the index, not a read-then-write.** `DataRouterService.routeEdit`
 *    inserts a revision carrying `edit_jti`; the repository owns a *partial unique*
 *    index on that field. A second submit for the same jti therefore fails at the
 *    insert (`11000`) rather than at a prior read, so two concurrent submits cannot
 *    both win. This is the assertion that cannot be made against a mock.
 * 2. **The confirmation is replayed from Redis** (`ak:tok:edit:outcome:<jti>`) for
 *    the full 4-hour window, so the resubmitting browser gets the original
 *    revision id and downstream reference instead of a duplicate row.
 * 3. **The edit and its outbox row commit together**, so a crash between them
 *    cannot leave a revision nobody will ever deliver.
 *
 * ## What this spec deliberately does not cover
 *
 * It exercises the seam directly, not over HTTP, so `ReadController.editPost`'s
 * own branch (catch `11000` → look up the stored outcome → answer `replayed`) is
 * not executed here. The two lookups that branch performs are asserted instead —
 * see "gives the controller's replay branch the data it needs". A full HTTP test
 * would drag a Nest graph in to prove the same two lookups work.
 */
describe('edit-link integration (LNK-02, SC#4)', () => {
  let containers: ThreeContainers;
  let mongo: MongoService;
  let redis: Redis;
  let revisions: SubmissionRevisionsRepository;
  let router: DataRouterService;
  let tokens: LinkTokenStore;

  const submissionId = `sub-${randomUUID()}`;
  const appId = 'hr-leave';
  const formId = 'leave-request';
  const connectorRef = 'redmine-hr';

  beforeAll(async () => {
    containers = await startThreeContainers();

    mongo = new MongoService(containers.urls.mongo);
    redis = new Redis(containers.urls.cache);
    await redis.flushall();

    await mongo.db().createCollection('submission_revisions');
    await mongo.db().createCollection('outbox');

    revisions = new SubmissionRevisionsRepository(mongo);
    // APP-06's lifecycle guard runs at the
    // seam; this spec's subject is the
    // edit link's single-use semantics, so
    // the definition store is a pass-through
    // double. The guard itself is proven on
    // the real path in the app-definition
    // integration spec.
    router = new DataRouterService(
      mongo,
      {
        assertAcceptsSubmissions: async (): Promise<void> =>
          undefined,
      } as unknown as AppDefinitionService,
    );
    tokens = new LinkTokenStore(redis as unknown as RedisStructuralSeam);

    // Create the partial unique index on `edit_jti` the way production does — as a
    // side effect of the *create* path. `routeEdit` relies on that index but does
    // not create it itself, and this mirrors the real ordering: an edit link is
    // only ever issued for a submission that already exists.
    const session = mongo.client.startSession();
    try {
      await session.withTransaction(async () => {
        await revisions.insertInSession(submissionId, 1, { subject: 'original' }, session);
      });
    } finally {
      await session.endSession();
    }
  }, 180_000);

  afterAll(async () => {
    await redis?.quit();
    await mongo?.client.close();
    await containers?.stop();
  });

  it('claims the edit once: a second submit for the same jti creates no second revision', async () => {
    const jti = `jti-${randomUUID()}`;
    const input = {
      submissionId,
      appId,
      formId,
      data: { subject: 'first' },
      connectorRef,
      revision: 2,
      editJti: jti,
    };

    await expect(router.routeEdit(input)).resolves.toEqual({ status: 'accepted', revision: 2 });

    // The duplicate insert is what fails — no read-then-write race window exists.
    await expect(
      router.routeEdit({ ...input, data: { subject: 'second' } }),
    ).rejects.toMatchObject({ code: 11000 });

    const rows = await mongo
      .db()
      .collection('submission_revisions')
      .find({ edit_jti: jti })
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toEqual({ subject: 'first' });
  });

  it('gives the controller\u2019s replay branch the data it needs after that 11000', async () => {
    const jti = `jti-${randomUUID()}`;
    const outcome = { submission_id: submissionId, revision: 6, downstreamRef: 'redmine#4242' };

    await expect(
      router.routeEdit({
        submissionId,
        appId,
        formId,
        data: { subject: 'replay me' },
        connectorRef,
        revision: 6,
        editJti: jti,
      }),
    ).resolves.toEqual({ status: 'accepted', revision: 6 });
    await tokens.recordOutcome(jti, outcome, 14_400);

    // `editPost` answers `replayed` by consulting exactly these two: the stored
    // outcome first (preferred — it carries the downstream reference), the
    // revision row second (fallback).
    await expect(tokens.readOutcome(jti)).resolves.toEqual(outcome);
    const fallback = await revisions.findByEditJti(jti);
    expect(fallback).toMatchObject({ submission_id: submissionId, revision: 6 });
  });

  it('consume replay ttl — the replay record is kept only for its window', async () => {
    const jti = `jti-${randomUUID()}`;
    await tokens.recordOutcome(jti, { submission_id: submissionId, revision: 9 }, 300);

    await expect(redis.ttl(`ak:tok:edit:outcome:${jti}`)).resolves.toBeGreaterThan(0);
    await expect(redis.ttl(`ak:tok:edit:outcome:${jti}`)).resolves.toBeLessThanOrEqual(300);
  });

  it('treats an unreadable replay record as absent rather than throwing', async () => {
    const key = `ak:tok:edit:outcome:${randomUUID()}`;

    await redis.set(key, 'not-json', 'EX', 300);
    await expect(tokens.readOutcome(key.slice('ak:tok:edit:outcome:'.length))).resolves.toBeNull();

    // Structurally valid JSON that is not an outcome must also fail closed: a
    // `revision` with no `submission_id` would otherwise replay as `undefined`.
    await redis.set(key, JSON.stringify({ revision: 1 }), 'EX', 300);
    await expect(tokens.readOutcome(key.slice('ak:tok:edit:outcome:'.length))).resolves.toBeNull();
  });

  it('writes the edit revision and its outbox row in one transaction', async () => {
    const jti = `jti-${randomUUID()}`;

    const result = await router.routeEdit({
      submissionId,
      appId,
      formId,
      data: { subject: 'edited' },
      connectorRef,
      revision: 3,
      editJti: jti,
    });
    expect(result).toEqual({ status: 'accepted', revision: 3 });

    const stored = await revisions.findByEditJti(jti);
    expect(stored).toMatchObject({
      submission_id: submissionId,
      revision: 3,
      outbound: 'not_sent',
      edit_jti: jti,
    });

    const outbox = await mongo
      .db()
      .collection('outbox')
      .findOne({ revisionRef: `${submissionId}:3` });
    expect(outbox).toMatchObject({
      published: false,
      connectorRef,
      submissionId,
      revision: 3,
    });
  });
});
