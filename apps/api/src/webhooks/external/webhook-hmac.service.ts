import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';

import { ConnectorCredentialsRepository } from '@akane/domain';

const SIGNATURE_RE = /^sha256=[0-9a-fA-F]{64}$/;

@Injectable()
export class WebhookHmacService {
  private readonly logger = new Logger(WebhookHmacService.name);

  constructor(private readonly creds: ConnectorCredentialsRepository) {}

  async verify(connectorId: string, rawBody: Buffer, presentedSignature: string): Promise<void> {
    // Fast-fail on envelope shape so an unauthenticated request cannot force a
    // credential-store lookup / KMS decrypt.
    if (typeof presentedSignature !== 'string' || !SIGNATURE_RE.test(presentedSignature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    const ref = `webhook:${connectorId}:hmac-sha256`;
    let secret: string;
    try {
      const cred = await this.creds.get(ref);
      if (!cred) {
        this.logger.warn({ reason: 'missing_secret', connectorId });
        throw new UnauthorizedException('Invalid signature');
      }
      secret = cred.decryptedValue;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.warn({ reason: 'secret_decrypt_failed', connectorId });
      throw new UnauthorizedException('Invalid signature');
    }

    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody ?? '');
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    const presented = Buffer.from(presentedSignature.slice('sha256='.length), 'hex');

    if (presented.length !== expected.length) {
      throw new UnauthorizedException('Invalid signature');
    }
    if (!crypto.timingSafeEqual(presented, expected)) {
      throw new UnauthorizedException('Invalid signature');
    }
  }
}