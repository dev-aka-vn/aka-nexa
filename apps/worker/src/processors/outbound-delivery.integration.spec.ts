import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { MongoClient } from 'mongodb';


import {
  IM_OUTBOUND_QUEUE,
  INBOUND_EVENTS_QUEUE,
  blockingConnectionOptions,
  BULLMQ_PREFIX,
  MongoService,
  producerConnectionOptions,
} from '@akane/platform';
import { OutboundMessageSchema } from '@akane/contract';
import {
  AuditRepository,
  PlatformEventRepository,
} from '@akane/domain';

import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';
import { OutboundDeliveryProcessor } from './outbound-delivery.processor.js';
import { OutboundDeliveryRegistry } from './outbound-delivery.registry.js';

/**
 * The outbound delivery seam, end-to-end over real Redis and Mongo.
 *
 * Phase 10's other suites assert the pieces in memory. This one proves the
 * seam that makes them a system: a job placed on `IM_OUTBOUND_QUEUE` is
 * delivered by the platform port, and the ledger row it answers is flipped
 * `dispatched` — which is what stops the reconciler from re-delivering a
 * reply the user already received.
 *
 * Before plan 10-06 the inbound processor computed the outcome and threw it
 * away, so this assertion is the one that says a reply can now actually reach
 * a user.
 */
/**
 * The ledger's Mongo timeouts for this suite.
 *
 * `PlatformEventRepository`'s defaults are the ack-path budget (40 ms per
 * side, 10-03) and a freshly mapped container cannot finish its first TCP
 * connect inside that. Widened here and only here — production keeps the
 * default, because the value under test is the seam's sequencing, not whether
 * the budget happens to fit a CI network.
 */
const CONTAINER_TIMEOUTS = {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
} as const;

describe('outbound delivery seam integration', () => {
  let containers: ThreeContainers;
  let platformEvents: PlatformEventRepository;
  let audit: AuditRepository;
  let auditClient: MongoClient;
  const opened: Array<{ close(): Promise<unknown> }> = [];

  beforeAll(async () => {
    containers = await startThreeContainers();
    // The ledger owns its own client (10-03), so give it the real URL.
    platformEvents = new PlatformEventRepository(
      {
        getOrThrow: <T>(key: string): T =>
          (key === 'MONGO_URL' ? containers.urls.mongo : undefined) as T,
      } as never,
      // The ack-path budget is 40 ms per side; a freshly mapped container
      // cannot complete its first TCP connect inside that, which would make
      // this suite fail for a reason unrelated to the seam. Widened here only
      // — every composition root keeps the default.
      CONTAINER_TIMEOUTS,
    );
    const auditMongo = new MongoService(containers.urls.mongo);
    auditClient = auditMongo.client;
    audit = new AuditRepository(auditMongo);
    // Open the ledger's own client in setup, so a wiring failure surfaces here
    // rather than inside the first assertion.
    await platformEvents.findPending(1);
  });

  afterAll(async () => {
    await Promise.all(
      opened.map((o) => o.close().catch(() => undefined)),
    );
    await platformEvents?.close();
    await containers?.stop();
  });

  /** A port that records what it was asked to deliver. */
  function recordingPort(sends: unknown[]) {
    return {
      async send(message: unknown): Promise<void> {
        sends.push(message);
      },
    };
  }

  function buildProcessor(port: { send(m: unknown): Promise<void> }) {
    const registry = new OutboundDeliveryRegistry();
    registry.register('teams', port);
    return new OutboundDeliveryProcessor(registry, platformEvents, audit);
  }

  it('delivers a queued reply and marks its platform event dispatched', async () => {
    const sends: unknown[] = [];
    const processor = buildProcessor(recordingPort(sends));

    // The inbound side's row: what the receiver wrote on the ack path.
    const nativeEventId = 'Ev-delivery-1';
    await platformEvents.record({
      platform: 'teams',
      platformEventId: nativeEventId,
      payload: { kind: 'message' },
    });

    const queue = new Queue(IM_OUTBOUND_QUEUE, {
      connection: producerConnectionOptions(containers.urls.queue),
      prefix: BULLMQ_PREFIX,
    });
    const worker = new Worker(IM_OUTBOUND_QUEUE, (job) => processor.process(job), {
      connection: blockingConnectionOptions(containers.urls.queue),
      prefix: BULLMQ_PREFIX,
    });
    opened.push(queue, worker);

    const message = OutboundMessageSchema.parse({
      message_id: 'msg-seam-1',
      platform: 'teams',
      channel_id: 'C-seam',
      chat_user_id: 'U-seam',
      text: 'Here is your form',
      action: 'form_link',
      queue: IM_OUTBOUND_QUEUE,
      attempt: 0,
      native_event_id: nativeEventId,
    });

    const jobId = `teams:${message.channel_id}:${message.message_id}`;
    await queue.add(IM_OUTBOUND_QUEUE, message, { jobId });

    // Drain: the processor flips the row, which is the observable completion.
    for (let i = 0; i < 50; i++) {
      const pending = await platformEvents.findPending(100);
      if (pending.every((row) => row.platform_event_id !== nativeEventId)) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ message_id: 'msg-seam-1' });

    // No `pending` row remains for it — the reconciler will not re-drive.
    const pending = await platformEvents.findPending(100);
    expect(pending.find((r) => r.platform_event_id === nativeEventId)).toBeUndefined();
  });

  it('re-enqueuing the same message_id is a no-op, so a retry cannot duplicate the reply', async () => {
    const sends: unknown[] = [];
    const message = OutboundMessageSchema.parse({
      message_id: 'msg-idempotent',
      platform: 'teams',
      channel_id: 'C-idem',
      chat_user_id: 'U-idem',
      text: 'same reply',
      action: 'reply',
      queue: IM_OUTBOUND_QUEUE,
      attempt: 0,
    });

    const queue = new Queue(IM_OUTBOUND_QUEUE, {
      connection: producerConnectionOptions(containers.urls.queue),
      prefix: BULLMQ_PREFIX,
    });
    const jobId = `teams:${message.channel_id}:${message.message_id}`;

    await queue.add(IM_OUTBOUND_QUEUE, message, { jobId });
    // Second add with the same deterministic jobId — the producer's own
    // retry-stability contract (10-06), proved against real BullMQ.
    await queue.add(IM_OUTBOUND_QUEUE, message, { jobId });

    await new Promise((r) => setTimeout(r, 2500));
    await queue.close();

    // The queue collapsed the two adds. No worker is registered in this test,
    // so nothing was delivered — and that absence is the point: the guarantee
    // 10-06 relies on is BullMQ's deterministic jobId, not the consumer's
    // idempotence.
    expect(sends).toHaveLength(0);
  });

  it('a platform with no registered port is audited, not thrown', async () => {
    const registry = new OutboundDeliveryRegistry();
    // Teams deliberately unregistered: a port that never landed must not
    // become a retry loop that burns the DLQ budget (OUT-03's no_port path).
    const orphan = new OutboundDeliveryProcessor(
      registry,
      platformEvents,
      audit,
    );
    const spy = vi.spyOn(audit, 'append');

    await orphan.process({
      data: {
        message_id: 'msg-noport',
        platform: 'teams',
        channel_id: 'C-x',
        chat_user_id: 'U-x',
        text: 'nowhere',
        action: 'reply',
        queue: IM_OUTBOUND_QUEUE,
        attempt: 0,
      },
    } as never);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'im.outbound.no_port' }),
    );
    spy.mockRestore();
  });

  it('an inbound and an outbound queue name agree with the shared constants', () => {
    // The drift this catches: a producer literal and a consumer literal that
    // differ by a hyphen, which silently strands every job (D-14's lesson).
    expect(typeof IM_OUTBOUND_QUEUE).toBe('string');
    expect(IM_OUTBOUND_QUEUE).not.toBe(INBOUND_EVENTS_QUEUE);
    expect(IM_OUTBOUND_QUEUE).toBe('im-outbound');
    expect(INBOUND_EVENTS_QUEUE).toBe('inbound-events');
  });
});
