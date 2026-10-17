import { Injectable, Logger } from '@nestjs/common';

import type { OtpDeliveryPort } from '@akane/domain';

/**
 * The worker composition's OTP delivery leg (IDN-05).
 *
 * The live Slack DM is the manual-verify item
 * (06-VALIDATION.md: "Manual Slack OTP leg in
 * staging; state machine itself is integration-
 * tested"). Until the chat adapter plugs in, the
 * delivery is logged — the chat identity only,
 * never the code (T-06-13: the plaintext exists
 * solely inside the `deliverOtp` call).
 *
 * A later channel (the real Slack adapter, email,
 * another IM) implements the same
 * {@link OtpDeliveryPort} seam without touching
 * the state machine or the processor.
 */
@Injectable()
export class OtpDeliveryService implements OtpDeliveryPort {
  private readonly logger = new Logger(OtpDeliveryService.name);

  async deliverOtp(chatUserId: string, _code: string): Promise<void> {
    this.logger.log(`OTP delivered to chat identity ${chatUserId}`);
  }
}
