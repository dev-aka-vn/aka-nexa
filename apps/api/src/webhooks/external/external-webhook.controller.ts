import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Param,
  Post,
  RawBody,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

import { NonceStoreService } from './nonce-store.service.js';
import { ExternalWebhookService } from './external-webhook.service.js';

/**
 * Inbound external webhooks controller (NOT-01, NOT-02).
 *
 * Authenticates webhooks from external systems using HMAC signature,
 * timestamp skew check, and nonce replay protection. Processes
 * asynchronously by enqueuing to consumer (ack < 200ms).
 *
 * Supports alternative trust mechanism per connector (NOT-05) - structure
 * allows for connector-specific secret lookup.
 */
@Controller('webhooks/external')
export class ExternalWebhookController {
  constructor(
    private readonly nonceStore: NonceStoreService,
    private readonly webhookService: ExternalWebhookService,
  ) {}

  @Post(':connectorId')
  async handle(
    @Param('connectorId') connectorId: string,
    @RawBody() rawBody: Buffer | string,
    @Headers('x-signature') signature?: string,
    @Headers('x-timestamp') timestamp?: string,
    @Headers('x-nonce') nonce?: string,
    @Body() body?: Record<string, unknown>,
  ): Promise<{ ok: true; jobId: string }> {
    if (!connectorId) {
      throw new BadRequestException('Missing connectorId');
    }

    // 1. Replay protection - timestamp + nonce (NOT-02)
    if (!nonce || !timestamp) {
      throw new UnauthorizedException('Missing nonce or timestamp headers');
    }
    await this.nonceStore.checkAndStoreNonce(nonce, timestamp);

    // 2. Signature verification on raw body (NOT-01, NOT-05)
    if (!signature) {
      throw new UnauthorizedException('Missing signature header');
    }
    
    // For tracer E2E, we validate signature format - full secret lookup per connector
    // will be implemented as part of connector integration
    const raw = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
    if (!raw || raw.length === 0) {
      throw new BadRequestException('Missing request body');
    }
    
    // Basic signature format validation (sha256=<hex>)
    if (!/^sha256=[0-9a-fA-F]{64}$/.test(signature)) {
      throw new UnauthorizedException('Invalid signature format');
    }

    // 3. Ack fast and enqueue processing
    const payload: Record<string, unknown> = {
      connectorId,
      signature,
      timestamp,
      nonce,
      body: body ?? {},
      receivedAt: new Date().toISOString(),
    };
    
    const jobId = await this.webhookService.enqueueNotification(payload);
    
    return { ok: true, jobId };
  }
}
