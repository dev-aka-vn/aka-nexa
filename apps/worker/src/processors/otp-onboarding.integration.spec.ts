/**
 * IDN-05 — the OTP self-onboarding flow, end-to-end through
 * the inbound-event processor over real Redis.
 *
 * The flow ROADMAP success criterion 3 names: an employee
 * with no CSV mapping self-onboards from chat — the
 * onboarding intent creates the OTP state, the code is
 * delivered through the chat pipeline's delivery port, and
 * a correct reply creates the identity mapping so the
 * employee can immediately use an app they were granted.
 *
 * The processor is composed exactly as the worker module
 * composes it (real repositories, real state machine over
 * a Redis 8.10 container); only the OTP delivery port is
 * a recording stand-in, because the live Slack DM leg is
 * the manual-verify item (06-VALIDATION.md).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';

import {
  ClarificationSessionService,
  IdentityMappingRepository,
  IdentityService,
  LinkIssuerService,
  OtpDeliveryPort,
  OtpOnboardingService,
  OtpStateMachine,
  PublishedAppLoader,
  RoutingOrchestrator,
  RuleBasedProvider,
  type PublishedApp,
} from '@akane/domain';

import { InboundEventProcessor } from './inbound-event.processor.js';
import { startThreeContainers, type ThreeContainers } from '../../../../tooling/containers.js';

const CATALOG: PublishedApp[] = [
  {
    id: 'leave-request',
    description: 'Submit a new leave request',
    parameters: [],
    intents: ['request leave'],
    aliases: ['request leave', 'leave request'],
    threshold: 0.8,
    status: 'published',
  },
];

/** The onboarding employee's chat identity — unmapped at the start. */
const NEWCOMER = 'U-newcomer-0001';

/** A 6-digit code guaranteed to differ from the delivered one. */
function otherCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

function event(overrides: Record<string, unknown>) {
  return {
    event_id: 'evt-otp-1',
    platform: 'slack',
    channel_id: 'C-onboard',
    chat_user_id: NEWCOMER,
    text: '',
    action: 'message',
    queue: 'inbound-events',
    attempt: 0,
    occurred_at: new Date().toISOString(),
    ...overrides,
  } as never;
}

describe('OTP self-onboarding through the inbound processor (IDN-05)', () => {
  let containers: ThreeContainers;
  let redis: Redis;

  beforeAll(async () => {
    containers = await startThreeContainers();
    redis = new Redis(containers.urls.cache);
  });

  afterAll(async () => {
    await redis?.quit();
    await containers?.stop();
  });

  /**
   * Compose the processor exactly as the worker module does —
   * real identity mapping repository, real OTP state machine
   * over the container's Redis — with a recording delivery
   * port standing in for the live chat leg.
   */
  function buildProcessor(deliveries: Array<{ chatUserId: string; code: string }>) {
    const delivery: OtpDeliveryPort = {
      deliverOtp: async (chatUserId, code) => {
        deliveries.push({ chatUserId, code });
      },
    };
    const mappings = new IdentityMappingRepository();
    const onboarding = new OtpOnboardingService(
      new OtpStateMachine(redis),
      mappings,
      delivery,
    );
    const processor = new InboundEventProcessor(
      new IdentityService(mappings),
      new PublishedAppLoader(CATALOG, async () => true),
      new RoutingOrchestrator([
        new RuleBasedProvider(new Map([['leave-request', ['request leave']]])),
      ]),
      new LinkIssuerService(),
      new ClarificationSessionService(redis),
      onboarding,
    );
    return { processor, mappings };
  }

  it('self-onboards an unmapped employee end-to-end (ROADMAP SC#3)', async () => {
    const deliveries: Array<{ chatUserId: string; code: string }> = [];
    const { processor, mappings } = buildProcessor(deliveries);

    // 1. The onboarding intent from an unmapped chat identity.
    const requested = await processor.process({
      data: event({ text: 'onboard' }),
    } as never);
    expect(requested).toEqual({ kind: 'otp_requested' });

    // The code is delivered exactly once, to the requesting identity.
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.chatUserId).toBe(NEWCOMER);
    const code = deliveries[0]!.code;
    expect(code).toMatch(/^\d{6}$/);

    // The OTP state exists in Redis; the plaintext never persists (T-06-13).
    const stored = await redis.get(`akane:otp:${NEWCOMER}`);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(code);

    // 2. A wrong code is counted; the mapping is not created.
    const wrong = await processor.process({
      data: event({ text: otherCode(code) }),
    } as never);
    expect(wrong).toEqual({ kind: 'otp_invalid', attemptsRemaining: 2 });
    expect(await mappings.findByChat('slack', NEWCOMER)).toBeNull();

    // 3. The correct code verifies and creates the identity mapping.
    const verified = await processor.process({
      data: event({ text: code }),
    } as never);
    expect(verified.kind).toBe('otp_verified');
    const mapping = await mappings.findByChat('slack', NEWCOMER);
    expect(mapping).not.toBeNull();
    expect(mapping?.chat_user_id).toBe(NEWCOMER);
    expect(mapping?.real_user_id).toBeTruthy();

    // 4. The next inbound event resolves the user and routes to a
    //    granted app immediately — no further onboarding.
    const next = await processor.process({
      data: event({ text: 'I want to request leave' }),
    } as never);
    expect(next.kind).toBe('link');
    if (next.kind === 'link') {
      expect(next.appId).toBe('leave-request');
      expect(next.url).toContain(mapping!.real_user_id);
    }

    // 5. The consumed code is single-use: replaying it is refused.
    const replay = await processor.process({
      data: event({ text: code }),
    } as never);
    expect(replay.kind).toBe('otp_consumed');
  });

  it('routes a non-onboarding message from an unmapped identity to unknown_user', async () => {
    const deliveries: Array<{ chatUserId: string; code: string }> = [];
    const { processor } = buildProcessor(deliveries);

    const outcome = await processor.process({
      data: event({ text: 'what is the weather' }),
    } as never);

    expect(outcome).toEqual({ kind: 'skipped', reason: 'unknown_user' });
    expect(deliveries).toHaveLength(0);
  });
});
