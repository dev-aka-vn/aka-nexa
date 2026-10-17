/**
 * The OTP delivery port (IDN-05) — the hexagonal
 * seam the chat pipeline implements.
 *
 * The port's single parameter is the requesting
 * chat identity (T-06-11): the OTP is delivered
 * only to the identity that requested it, and the
 * plaintext code exists solely inside this in-
 * memory call — it is never persisted, logged or
 * returned anywhere else (T-06-13).
 *
 * The live Slack DM leg is the manual-verify item
 * (06-VALIDATION.md); the worker composition
 * provides the implementation, and a later channel
 * (email, another IM) adds a port implementation
 * without touching the state machine.
 */
export interface OtpDeliveryPort {
  /** Deliver the 6-digit `code` to the chat identity that requested it. */
  deliverOtp(chatUserId: string, code: string): Promise<void>;
}
