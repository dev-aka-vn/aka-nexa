/**
 * IDN-05 — the OTP self-onboarding contracts.
 *
 * The payloads the chat ↔ worker boundary exchanges for
 * an employee with no CSV/SSO mapping: the 6-digit code
 * reply, and the onboarding outcome the worker returns
 * as the job result the chat adapter renders. These live
 * beside the frozen contracts (D-21/D-23 stay untouched),
 * following the pattern the builder-auth contracts
 * (BLD-12, D-110) established.
 *
 * The plaintext code never persists anywhere as a stored
 * value (T-06-13): it exists only inside the in-memory
 * `OtpDeliveryPort.deliverOtp` call. What crosses this
 * boundary is the *shape* of the reply text and the
 * outcome — both free of PII.
 */

import { z } from 'zod';

/**
 * A 6-digit numeric OTP code — the shape of the reply
 * text that carries the code back to the worker.
 * `safeParse` on the trimmed event text is how the
 * processor recognizes a code reply from an unmapped
 * identity.
 */
export const OtpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, 'must be a 6-digit numeric code');
export type OtpCode = z.infer<typeof OtpCodeSchema>;

/**
 * The onboarding intent — the keyword an unmapped
 * employee sends to request the code (the IDN-04
 * prompt's expected reply). Matches a bare or
 * slash-prefixed keyword at the start of the message.
 */
export const OTP_ONBOARDING_INTENT = /^(?:\/?(?:onboard|start|begin))(?:\s|$)/i;

/**
 * The IDN-05 onboarding outcome — the job result the
 * chat adapter renders as the employee's reply.
 * Mirrors the processor's OTP outcome variants;
 * `attemptsRemaining` and `remainingMinutes` are the
 * BLD-07 actionable counts named inline, never a
 * generic "locked" string.
 */
export const OtpOnboardingOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('otp_requested') }),
  z.object({
    kind: z.literal('otp_verified'),
    realUserId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('otp_invalid'),
    attemptsRemaining: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('otp_locked'),
    remainingMinutes: z.number().int().min(1),
  }),
  z.object({ kind: z.literal('otp_expired') }),
  z.object({ kind: z.literal('otp_consumed') }),
]);
export type OtpOnboardingOutcome = z.infer<typeof OtpOnboardingOutcomeSchema>;
