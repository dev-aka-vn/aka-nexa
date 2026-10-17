/**
 * The OTP self-onboarding service (IDN-05).
 *
 * The employee path for joining a chat identity
 * to a `real_user_id`: an employee with no CSV/
 * SSO mapping proves their own identity by
 * verifying an OTP delivered through their IM
 * account — deliberately separate from the admin
 * path (IDN-08's SSO mapping, which carries no
 * OTP) and from builder access (BLD-12).
 *
 * The state machine owns the OTP policy (10-minute
 * expiry, the attempt budget, the lockout); this
 * service owns the two things around it: the
 * delivery through the chat pipeline's port, and
 * the identity mapping a verified onboarding
 * creates — the join that makes the next inbound
 * event resolve the user with no further
 * onboarding (ROADMAP SC#3).
 */

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { IdentityMappingRepository } from '../identity-mapping.repository.js';
import { OtpDeliveryPort } from './otp-delivery.port.js';
import { OtpStateMachine, type OtpRequestDecision, type OtpVerifyDecision } from './otp-state-machine.js';

/** The outcome of `requestOtp`: the code was requested and delivered, or the lockout refusal. */
export type OtpRequestResult =
  | { readonly status: 'requested' }
  | {
      readonly status: 'locked';
      readonly lockoutUntil: number;
      readonly remainingMinutes: number;
    };

/** The outcome of `verifyOtp`: the created mapping, or the state machine's refusal passed through. */
export type OtpVerifyResult =
  | { readonly status: 'verified'; readonly realUserId: string }
  | { readonly status: 'invalid'; readonly attemptsRemaining: number }
  | {
      readonly status: 'locked';
      readonly lockoutUntil: number;
      readonly remainingMinutes: number;
    }
  | { readonly status: 'expired' }
  | { readonly status: 'consumed' };

@Injectable()
export class OtpOnboardingService {
  constructor(
    private readonly stateMachine: OtpStateMachine,
    private readonly mappings: IdentityMappingRepository,
    private readonly delivery: OtpDeliveryPort,
  ) {}

  /**
   * Request an onboarding OTP for the chat
   * identity. Creates the OTP state and delivers
   * the code through the chat pipeline's delivery
   * port — exactly once, to the requesting
   * identity (T-06-11). Refuses with the lockout
   * remaining named inline while a lockout is
   * active (BLD-07).
   */
  async requestOtp(chatUserId: string): Promise<OtpRequestResult> {
    const decision: OtpRequestDecision = await this.stateMachine.request(chatUserId);
    if (decision.status === 'locked') {
      return {
        status: 'locked',
        lockoutUntil: decision.lockoutUntil,
        remainingMinutes: decision.remainingMinutes,
      };
    }
    // The plaintext code exists only in memory, between
    // the state machine and the delivery-port call
    // (T-06-13: it is never persisted or logged).
    await this.delivery.deliverOtp(chatUserId, decision.code);
    return { status: 'requested' };
  }

  /**
   * Verify the code the employee replied with. On
   * success the chat identity is mapped to a new
   * `real_user_id` — the mapping the next inbound
   * event resolves — and the code is consumed
   * (single-use). Every refusal the state machine
   * raises passes through unchanged.
   */
  async verifyOtp(
    platform: string,
    chatUserId: string,
    code: string,
  ): Promise<OtpVerifyResult> {
    const decision: OtpVerifyDecision = await this.stateMachine.verify(chatUserId, code);
    if (decision.status !== 'verified') {
      return decision;
    }
    // A verified onboarding joins the chat identity to a
    // new real_user_id (crypto.randomUUID — Node
    // stdlib, no dependency; PRD ids are UUID-shaped).
    const realUserId = randomUUID();
    await this.mappings.upsert({
      platform,
      chat_user_id: chatUserId,
      real_user_id: realUserId,
    });
    return { status: 'verified', realUserId };
  }
}
