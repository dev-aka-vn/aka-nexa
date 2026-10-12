/**
 * IDN-05 — the OTP state machine, over real Redis.
 *
 * The state machine is Redis-backed by requirement (AD-9):
 * attempt counters and lockouts must survive restarts and
 * apply across instances, so this suite runs against a real
 * Redis 8.10 container — never a mock. A mock would assert
 * the shape of a call rather than the INCR/TTL semantics
 * the IDN-05 policy depends on.
 *
 * The record shape is the contract the processor's unmapped-
 * user path depends on: `{ codeHash, attempts, expiresAt,
 * lockoutUntil, status }` under `akane:otp:{chatUserId}`,
 * with a Redis TTL equal to the 10-minute expiry so expiry
 * is structural (the key disappears — there is no poll).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';

import { startThreeContainers, type ThreeContainers } from '../../../../../tooling/containers.js';

import { IdentityMappingRepository } from '../identity-mapping.repository.js';
import { OtpDeliveryPort } from './otp-delivery.port.js';
import { OtpOnboardingService } from './otp-onboarding.service.js';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MS, OtpStateMachine } from './otp-state-machine.js';

/** A 6-digit code guaranteed to differ from the delivered one. */
function otherCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

describe('OtpStateMachine (IDN-05) — over real Redis', () => {
  let containers: ThreeContainers;
  let redis: Redis;
  let machine: OtpStateMachine;

  beforeAll(async () => {
    containers = await startThreeContainers();
    redis = new Redis(containers.urls.cache);
    machine = new OtpStateMachine(redis);
  });

  afterAll(async () => {
    await redis?.quit();
    await containers?.stop();
  });

  it('request writes the exact record shape with the 10-minute TTL', async () => {
    const before = Date.now();
    const decision = await machine.request('U-shape');

    expect(decision.status).toBe('delivered');

    const raw = await redis.get('akane:otp:U-shape');
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!);
    expect(record.status).toBe('pending');
    expect(record.attempts).toBe(0);
    expect(record.lockoutUntil).toBeNull();
    expect(typeof record.codeHash).toBe('string');
    // The expiry is exactly the 10-minute window from now.
    expect(record.expiresAt).toBeGreaterThan(before);
    expect(record.expiresAt).toBeLessThanOrEqual(before + OTP_TTL_MS);

    // Expiry is structural: the key itself carries the TTL.
    const ttl = await redis.ttl('akane:otp:U-shape');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(OTP_TTL_MS / 1000);
  });

  it('generates a 6-digit numeric code and stores only its SHA-256 hash', async () => {
    const decision = await machine.request('U-hash');

    expect(decision.status).toBe('delivered');
    expect(decision.code).toMatch(/^\d{6}$/);

    const raw = await redis.get('akane:otp:U-hash');
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!);
    // SHA-256 hex: 64 characters, and never the plaintext code (T-06-13).
    expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.codeHash).not.toBe(decision.code);
    expect(raw).not.toContain(decision.code);
  });

  it('verify with the correct code within the TTL verifies and consumes the code', async () => {
    const decision = await machine.request('U-verify');
    expect(decision.status).toBe('delivered');

    const verified = await machine.verify('U-verify', decision.code);
    expect(verified).toEqual({ status: 'verified' });

    // Single-use: the pending record is gone after a successful verify.
    expect(await redis.get('akane:otp:U-verify')).toBeNull();
    expect(await redis.get('akane:otp:U-verify:attempts')).toBeNull();
  });

  it('a wrong code counts the attempt with INCR and names the remaining count', async () => {
    const decision = await machine.request('U-wrong');
    expect(decision.status).toBe('delivered');

    const refused = await machine.verify('U-wrong', otherCode(decision.code));
    expect(refused.status).toBe('invalid');
    if (refused.status === 'invalid') {
      expect(refused.attemptsRemaining).toBe(OTP_MAX_ATTEMPTS - 1);
    }

    // The attempt count is an integer over real Redis (INCR semantics).
    const counter = await redis.get('akane:otp:U-wrong:attempts');
    expect(counter).toBe('1');
    const record = JSON.parse((await redis.get('akane:otp:U-wrong'))!);
    expect(record.attempts).toBe(1);
  });

  it('refuses a code for a chat identity that never requested one', async () => {
    const decision = await machine.verify('U-never', '123456');
    expect(decision.status).toBe('consumed');
  });
});

describe('OtpOnboardingService (IDN-05) — the delivery seam', () => {
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

  it('requestOtp creates the record and delivers the code exactly once', async () => {
    const deliveries: Array<{ chatUserId: string; code: string }> = [];
    const delivery: OtpDeliveryPort = {
      deliverOtp: async (chatUserId, code) => {
        deliveries.push({ chatUserId, code });
      },
    };
    const mappings = new IdentityMappingRepository();
    const service = new OtpOnboardingService(
      new OtpStateMachine(redis),
      mappings,
      delivery,
    );

    const result = await service.requestOtp('U-deliver');

    expect(result).toEqual({ status: 'requested' });
    // The delivery port is invoked exactly once, keyed to the requesting
    // identity (T-06-11: the OTP goes only to the identity that asked).
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.chatUserId).toBe('U-deliver');
    expect(deliveries[0]!.code).toMatch(/^\d{6}$/);

    // The record exists and no mapping has been created yet.
    expect(await redis.get('akane:otp:U-deliver')).not.toBeNull();
    expect(await mappings.findByChat('slack', 'U-deliver')).toBeNull();
  });

  it('verifyOtp on success creates the identity mapping keyed to the chat identity', async () => {
    const deliveries: Array<{ chatUserId: string; code: string }> = [];
    const delivery: OtpDeliveryPort = {
      deliverOtp: async (chatUserId, code) => {
        deliveries.push({ chatUserId, code });
      },
    };
    const mappings = new IdentityMappingRepository();
    const service = new OtpOnboardingService(
      new OtpStateMachine(redis),
      mappings,
      delivery,
    );

    await service.requestOtp('U-map');

    // The plaintext code exists only in the delivery-port call (T-06-13):
    // the record in Redis carries nothing but its hash.
    const code = deliveries[0]!.code;
    const record = JSON.parse((await redis.get('akane:otp:U-map'))!);
    expect(record.codeHash).not.toBe(code);

    const result = await service.verifyOtp('slack', 'U-map', code);

    expect(result.status).toBe('verified');
    const mapping = await mappings.findByChat('slack', 'U-map');
    expect(mapping).not.toBeNull();
    expect(mapping?.platform).toBe('slack');
    expect(mapping?.chat_user_id).toBe('U-map');
    expect(mapping?.real_user_id).toBe(result.realUserId);
  });
});
