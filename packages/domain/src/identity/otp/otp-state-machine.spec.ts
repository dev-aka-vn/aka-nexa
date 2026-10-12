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
import {
  OTP_LOCKOUT_MS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  OtpStateMachine,
  type OtpRequestDecision,
} from './otp-state-machine.js';

/** A 6-digit code guaranteed to differ from the delivered one. */
function otherCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

/** Narrow a request decision to its delivered code. */
function deliveredCode(decision: OtpRequestDecision): string {
  if (decision.status !== 'delivered') {
    throw new Error(`expected a delivered OTP, got ${decision.status}`);
  }
  return decision.code;
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
    const after = Date.now();

    expect(decision.status).toBe('delivered');

    const raw = await redis.get('akane:otp:U-shape');
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!);
    expect(record.status).toBe('pending');
    expect(record.attempts).toBe(0);
    expect(record.lockoutUntil).toBeNull();
    expect(typeof record.codeHash).toBe('string');
    // The expiry is exactly the 10-minute window from the request moment.
    expect(record.expiresAt).toBeGreaterThanOrEqual(before + OTP_TTL_MS);
    expect(record.expiresAt).toBeLessThanOrEqual(after + OTP_TTL_MS);

    // Expiry is structural: the key itself carries the TTL.
    const ttl = await redis.ttl('akane:otp:U-shape');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(OTP_TTL_MS / 1000);
  });

  it('generates a 6-digit numeric code and stores only its SHA-256 hash', async () => {
    const code = deliveredCode(await machine.request('U-hash'));

    expect(code).toMatch(/^\d{6}$/);

    const raw = await redis.get('akane:otp:U-hash');
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!);
    // SHA-256 hex: 64 characters, and never the plaintext code (T-06-13).
    expect(record.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.codeHash).not.toBe(code);
    expect(raw).not.toContain(code);
  });

  it('verify with the correct code within the TTL verifies and consumes the code', async () => {
    const code = deliveredCode(await machine.request('U-verify'));

    const verified = await machine.verify('U-verify', code);
    expect(verified).toEqual({ status: 'verified' });

    // Single-use: the pending record becomes a consumed tombstone
    // that outlives the verify by exactly the remaining window,
    // and the attempt counter is gone.
    const tombstone = JSON.parse((await redis.get('akane:otp:U-verify'))!);
    expect(tombstone.status).toBe('consumed');
    expect(await redis.get('akane:otp:U-verify:attempts')).toBeNull();
  });

  it('a wrong code counts the attempt with INCR and names the remaining count', async () => {
    const code = deliveredCode(await machine.request('U-wrong'));

    const refused = await machine.verify('U-wrong', otherCode(code));
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
    // Nothing exists: the structural TTL is the only expiry, so a
    // missing record is an expired OTP — a *consumed* one leaves
    // a tombstone instead (the single-use replay case below).
    expect(decision.status).toBe('expired');
  });

  it('refuses a replay of an already-verified code (single-use)', async () => {
    const code = deliveredCode(await machine.request('U-replay'));

    const first = await machine.verify('U-replay', code);
    expect(first).toEqual({ status: 'verified' });

    // The consumed code never verifies a second time.
    const replay = await machine.verify('U-replay', code);
    expect(replay.status).toBe('consumed');
  });
});

describe('OtpStateMachine (IDN-05) — policy edges', () => {
  let containers: ThreeContainers;
  let redis: Redis;
  /** The pinned clock: the 10-minute boundary is stepped, not waited out. */
  let clock: number;
  let machine: OtpStateMachine;

  beforeAll(async () => {
    containers = await startThreeContainers();
    redis = new Redis(containers.urls.cache);
    clock = 1_770_000_000_000;
    machine = new OtpStateMachine(redis, () => clock);
  });

  afterAll(async () => {
    await redis?.quit();
    await containers?.stop();
  });

  it('a code one second inside the TTL verifies; one second past it is refused OTP_EXPIRED', async () => {
    const code = deliveredCode(await machine.request('U-boundary'));

    // 9:59 — one second inside the 10-minute window.
    clock += OTP_TTL_MS - 1000;
    expect(await machine.verify('U-boundary', code)).toEqual({ status: 'verified' });

    // A fresh OTP, presented one second past the window: the TTL
    // is the boundary, not a grace window.
    const second = deliveredCode(await machine.request('U-boundary-2'));
    clock += OTP_TTL_MS + 2000;
    expect(await machine.verify('U-boundary-2', second)).toEqual({ status: 'expired' });
  });

  it('the third failed attempt is the last; the fourth is refused with the lockout armed from the third failure', async () => {
    const code = deliveredCode(await machine.request('U-attempts'));

    // Attempts 1, 2, 3 fail, each naming the remaining count.
    clock += 1000;
    expect(await machine.verify('U-attempts', otherCode(code))).toEqual({
      status: 'invalid',
      attemptsRemaining: 2,
    });
    clock += 1000;
    expect(await machine.verify('U-attempts', otherCode(code))).toEqual({
      status: 'invalid',
      attemptsRemaining: 1,
    });
    clock += 1000;
    const thirdFailureAt = clock;
    expect(await machine.verify('U-attempts', otherCode(code))).toEqual({
      status: 'invalid',
      attemptsRemaining: 0,
    });

    // The 4th attempt is refused with the lockout active — and the
    // lockout is measured from the THIRD failure, not the first.
    clock += 1000;
    const fourth = await machine.verify('U-attempts', otherCode(code));
    expect(fourth.status).toBe('locked');
    if (fourth.status === 'locked') {
      expect(fourth.lockoutUntil).toBe(thirdFailureAt + OTP_LOCKOUT_MS);
      expect(fourth.remainingMinutes).toBe(OTP_LOCKOUT_MS / 60_000);
    }

    // The record itself carries the lockout, with every transition
    // recorded alongside its attempt count.
    const record = JSON.parse((await redis.get('akane:otp:U-attempts'))!);
    expect(record.status).toBe('locked');
    expect(record.attempts).toBe(3);
    expect(record.lockoutUntil).toBe(thirdFailureAt + OTP_LOCKOUT_MS);
    expect(record.transitions.map((t: { status: string }) => t.status)).toEqual([
      'requested',
      'invalid',
      'invalid',
      'invalid',
      'locked',
    ]);
  });

  it('requestOtp refuses during the lockout naming the remaining minutes, then resets after it lapses', async () => {
    const code = deliveredCode(await machine.request('U-lockout'));

    // Three failed attempts arm the lockout from the third failure.
    clock += 60_000;
    await machine.verify('U-lockout', otherCode(code));
    clock += 60_000;
    await machine.verify('U-lockout', otherCode(code));
    clock += 60_000;
    const thirdFailureAt = clock;
    await machine.verify('U-lockout', otherCode(code));
    const lockoutUntil = thirdFailureAt + OTP_LOCKOUT_MS;

    // One minute into the lockout, a new request is refused with
    // the remaining minutes named inline (BLD-07).
    clock = thirdFailureAt + 60_000;
    const refused = await machine.request('U-lockout');
    expect(refused.status).toBe('locked');
    if (refused.status === 'locked') {
      expect(refused.lockoutUntil).toBe(lockoutUntil);
      expect(refused.remainingMinutes).toBe(29);
    }

    // After the lockout lapses, a fresh request succeeds and the
    // attempt budget resets to zero.
    clock = lockoutUntil + 1000;
    const fresh = await machine.request('U-lockout');
    expect(fresh.status).toBe('delivered');
    const record = JSON.parse((await redis.get('akane:otp:U-lockout'))!);
    expect(record.status).toBe('pending');
    expect(record.attempts).toBe(0);
    expect(await redis.get('akane:otp:U-lockout:attempts')).toBeNull();
  });

  it('a code requested by one chat identity never verifies for another', async () => {
    const code = deliveredCode(await machine.request('U-identity-a'));

    // The same code presented by a different identity never
    // verifies — the key is namespaced per chat identity (T-06-11).
    const cross = await machine.verify('U-identity-b', code);
    expect(cross.status).not.toBe('verified');
    expect(await redis.get('akane:otp:U-identity-b')).toBeNull();

    // The rightful owner still verifies within the window.
    clock += 1000;
    expect(await machine.verify('U-identity-a', code)).toEqual({ status: 'verified' });
  });

  it('two concurrent wrong-code verifications count exactly two attempts (INCR atomicity)', async () => {
    const code = deliveredCode(await machine.request('U-concurrent'));

    await Promise.all([
      machine.verify('U-concurrent', otherCode(code)),
      machine.verify('U-concurrent', otherCode(code)),
    ]);

    // Redis INCR is atomic: no lost updates under parallelism.
    expect(await redis.get('akane:otp:U-concurrent:attempts')).toBe('2');
    const record = JSON.parse((await redis.get('akane:otp:U-concurrent'))!);
    expect(record.attempts).toBe(2);
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
    if (result.status !== 'verified') {
      throw new Error(`expected a verified onboarding, got ${result.status}`);
    }
    const mapping = await mappings.findByChat('slack', 'U-map');
    expect(mapping).not.toBeNull();
    expect(mapping?.platform).toBe('slack');
    expect(mapping?.chat_user_id).toBe('U-map');
    expect(mapping?.real_user_id).toBe(result.realUserId);
  });
});
