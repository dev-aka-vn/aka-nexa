import { Injectable } from '@nestjs/common';

import type { ImPlatform, OutboundMessage } from '@akane/contract';

/**
 * The outbound delivery registry — platform → port (OUT-03, OUT-12).
 *
 * ## Why a registry and not a switch inside the processor
 *
 * Adding a platform must not mean editing the delivery logic. Phase 12 (Zalo)
 * and Phase 13 (Telegram) each land one adapter and one line here; the
 * processor, the retry policy and the failure-notice path stay untouched. The
 * converse is the failure mode this avoids: a `switch` that grows a case per
 * platform and eventually mis-routes one.
 *
 * ## What an unregistered platform means
 *
 * Not a crash. A job whose platform has no port is audited as
 * `im.outbound.no_port` and dropped — the alternative (throwing) would put an
 * audit row through BullMQ's retry budget five times for a static
 * configuration defect. OUT-03's boot-time assertion is what catches it
 * before a job runs.
 */
export const OUTBOUND_DELIVERY_REGISTRY = Symbol('OUTBOUND_DELIVERY_REGISTRY');

/**
 * Attempts before an undeliverable outbound job is abandoned to the DLQ
 * (OUT-14).
 *
 * The producer sets this on the job; the consumer registers the matching
 * backoff strategy. Shared here because the two halves must agree on the
 * budget — a producer that enqueues with three attempts and a consumer that
 * computes `isLastAttempt` against five would loop one attempt short of the
 * retry it promised.
 */
export const OUTBOUND_DELIVERY_ATTEMPTS = 5;

export interface OutboundDeliveryPortLike {
  send(message: OutboundMessage): Promise<void>;
}

@Injectable()
export class OutboundDeliveryRegistry {
  private readonly ports = new Map<ImPlatform, OutboundDeliveryPortLike>();

  register(platform: ImPlatform, port: OutboundDeliveryPortLike): void {
    this.ports.set(platform, port);
  }

  get(platform: ImPlatform): OutboundDeliveryPortLike | undefined {
    return this.ports.get(platform);
  }

  /** The platforms that have a registered port — the boot assertion's input. */
  registered(): readonly ImPlatform[] {
    return [...this.ports.keys()];
  }
}

/**
 * The OUT-03 capability token, resolved from the registry.
 *
 * Kept beside the registry so the two cannot drift: the token's value *is*
 * `registry.registered()`, so a port registered after boot would silently
 * disagree with the value the guard read. The registry is mutably registered
 * before boot for exactly the platforms this build supports, and the token is
 * the frozen snapshot the assertion runs against.
 */
export function outboundDeliveryRegistrationsProvider(
  registry: OutboundDeliveryRegistry,
): readonly ImPlatform[] {
  return registry.registered();
}
