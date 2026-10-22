import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack request signing (OUT-04, T-10-07).
 *
 * ## Slack's scheme is not the connector `sha256=` scheme
 *
 * Slack signs a string that includes a *version prefix* and the request
 * **timestamp**, over the **raw** request body:
 *
 * ```
 * v0:<x-slack-request-timestamp>:<raw body>
 * ```
 *
 * and sends the result as `x-slack-signature: v0=<hex>`. Two consequences that
 * a body-only verifier gets wrong:
 *
 *  1. Dropping the timestamp from the signed material makes a captured request
 *     replayable forever — the signature no longer commits to *when* it was
 *     sent. That is why the timestamp is inside the MAC, and why the replay
 *     window is checked separately.
 *  2. Re-serialising the parsed body changes the bytes Slack signed
 *     (key order, whitespace, unicode escaping). The MAC must be computed over
 *     the exact received bytes, which is what `@RawBody()` provides
 *     (`rawBody: true` in `apps/api/src/main.ts`, enabled for both the JSON and
 *     urlencoded parsers).
 *
 * ## Why this lives in `packages/platform`, not in the Slack adapter
 *
 * It is transport authentication, not platform semantics: it knows nothing
 * about Slack events, forms or conversations. Keeping it here lets the two
 * Slack receivers (Events API and slash commands) share one implementation
 * instead of two copies of a constant-time compare.
 *
 * ## Failing closed when unconfigured
 *
 * `SLACK_SIGNING_SECRET` is optional in the boot schema (a deployment that has
 * not connected Slack must still boot — Teams' guard is lazy for the same
 * reason). An absent secret therefore produces `not_configured`, a distinct
 * failure the receiver maps to `503` rather than to `401`: no request can be
 * authentic without the secret, and the operator needs an actionable signal
 * instead of a silent "every Slack event is forged".
 */

/** Slack's signature version prefix. Both the header and the MAC use it. */
export const SLACK_SIGNATURE_VERSION = 'v0';

/** Request headers Slack sends (lowercase; Nest normalises header names). */
export const SLACK_SIGNATURE_HEADER = 'x-slack-signature';
export const SLACK_TIMESTAMP_HEADER = 'x-slack-request-timestamp';
/** Slack's own retry headers — informational, dedupe is by event id. */
export const SLACK_RETRY_NUM_HEADER = 'x-slack-retry-num';
export const SLACK_RETRY_REASON_HEADER = 'x-slack-retry-reason';

/**
 * Replay window, in seconds, matching Slack's documented 5-minute guidance.
 *
 * Configurable per call so a test can exercise the boundary without sleeping,
 * and so a deployment with unusually-skewed clocks can widen it without a code
 * change to the comparison.
 */
export const SLACK_REPLAY_WINDOW_SECONDS = 300;

/**
 * Why a request was rejected. Deliberately enumerated rather than a boolean:
 * the receivers map `not_configured` to `503` (operator fault) and everything
 * else to `401` (caller fault), and a test can assert *which* check failed
 * instead of only that something did.
 */
export type SlackVerificationFailure =
  | 'not_configured'
  | 'missing_headers'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'malformed_signature'
  | 'signature_mismatch';

export type SlackVerificationResult =
  | { readonly ok: true; readonly timestamp: number }
  | { readonly ok: false; readonly reason: SlackVerificationFailure };

export interface SlackVerificationOptions {
  /**
   * Current epoch **milliseconds**. Injected so the replay window is testable
   * without freezing the process clock.
   */
  readonly nowMs?: number;
  readonly replayWindowSeconds?: number;
}

/** `v0=` followed by exactly 32 bytes of hex. */
const SIGNATURE_PATTERN = /^v0=([0-9a-f]{64})$/i;
/** Epoch seconds as Slack sends them: digits only, no sign, no fraction. */
const TIMESTAMP_PATTERN = /^\d{1,12}$/;

/**
 * Verify one Slack request.
 *
 * Pure function — no DI, no config, no logging — so the security property is
 * assertable in isolation. `SlackWebhookVerifier` is the injectable wrapper
 * that supplies the configured secret.
 *
 * Order matters: shape checks run before the MAC so a malformed request cannot
 * make the process compute a digest (cheap, but also the only path that could
 * throw on a bad hex decode), and the replay check runs before the MAC because
 * a stale request must be rejected even when its signature is valid.
 */
export function verifySlackSignature(
  rawBody: Buffer | string | undefined,
  signature: string | undefined,
  timestamp: string | number | undefined,
  signingSecret: string | undefined,
  options: SlackVerificationOptions = {},
): SlackVerificationResult {
  if (typeof signingSecret !== 'string' || signingSecret.length === 0) {
    return { ok: false, reason: 'not_configured' };
  }

  if (
    typeof signature !== 'string' ||
    signature.length === 0 ||
    timestamp === undefined ||
    timestamp === null ||
    String(timestamp).length === 0
  ) {
    return { ok: false, reason: 'missing_headers' };
  }

  const timestampText = String(timestamp);
  if (!TIMESTAMP_PATTERN.test(timestampText)) {
    return { ok: false, reason: 'malformed_timestamp' };
  }
  const timestampSeconds = Number.parseInt(timestampText, 10);

  // `Math.abs`, not `now - ts > window`: without it a signature carrying a
  // far-future timestamp would remain inside the window indefinitely.
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const windowSeconds = options.replayWindowSeconds ?? SLACK_REPLAY_WINDOW_SECONDS;
  if (Math.abs(nowSeconds - timestampSeconds) > windowSeconds) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const signatureMatch = SIGNATURE_PATTERN.exec(signature);
  if (!signatureMatch) {
    return { ok: false, reason: 'malformed_signature' };
  }

  // The MAC is over the raw bytes: `v0:<ts>:` concatenated with the untouched
  // body. `Buffer.concat` rather than template interpolation of the body —
  // a non-ASCII body must not be re-encoded on the way into the digest.
  const bodyBytes = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody ?? '', 'utf8');
  const signedPayload = Buffer.concat([
    Buffer.from(`${SLACK_SIGNATURE_VERSION}:${timestampText}:`, 'utf8'),
    bodyBytes,
  ]);

  const expected = createHmac('sha256', signingSecret)
    .update(signedPayload)
    .digest();
  const presented = Buffer.from(signatureMatch[1], 'hex');

  // `timingSafeEqual` throws on unequal lengths, so length is compared first.
  // Neither length is secret — a SHA-256 digest is always 32 bytes — and a
  // length mismatch cannot be a valid signature anyway.
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, reason: 'signature_mismatch' };
  }

  return { ok: true, timestamp: timestampSeconds };
}

/**
 * The injectable form, bound to the boot-validated signing secret.
 *
 * Reads `SLACK_SIGNING_SECRET` through `ConfigService` rather than
 * `process.env` so the value is the one the boot schema validated
 * (`packages/platform/src/config/config.schema.ts`) and so no module in this
 * repository grows a second, unvalidated configuration surface.
 */
@Injectable()
export class SlackWebhookVerifier {
  constructor(private readonly config: ConfigService) {}

  /** True when a signing secret is configured; a receiver can surface it on /health. */
  get isConfigured(): boolean {
    return this.secret !== undefined;
  }

  private get secret(): string | undefined {
    const value = this.config.get<string>('SLACK_SIGNING_SECRET');
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  verify(
    rawBody: Buffer | string | undefined,
    signature: string | undefined,
    timestamp: string | undefined,
    options?: SlackVerificationOptions,
  ): SlackVerificationResult {
    return verifySlackSignature(rawBody, signature, timestamp, this.secret, options);
  }
}
