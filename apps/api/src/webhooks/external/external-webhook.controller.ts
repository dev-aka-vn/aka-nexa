import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  RawBody,
  UnauthorizedException,
} from '@nestjs/common';

import { NonceStoreService } from './nonce-store.service.js';
import { ExternalWebhookService } from './external-webhook.service.js';
import { WebhookHmacService } from './webhook-hmac.service.js';

@Controller('webhooks/external')
export class ExternalWebhookController {
  constructor(
    private readonly nonceStore: NonceStoreService,
    private readonly webhookService: ExternalWebhookService,
    private readonly hmac: WebhookHmacService,
  ) {}

  @Post(':connectorId')
  @HttpCode(200)
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
    await this.nonceStore.checkAndStoreNonce(nonce, timestamp, connectorId);

    // 2. Signature verification on raw body (NOT-01)
    if (!signature) {
      throw new UnauthorizedException('Missing signature header');
    }

    const raw = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
    if (!raw || raw.length === 0) {
      throw new BadRequestException('Missing request body');
    }

    await this.hmac.verify(connectorId, raw, signature);

    // 3. Ack fast and enqueue processing (minimal payload)
    let parsedBody: unknown = {};
    try {
      parsedBody = JSON.parse(raw.toString('utf8'));
    } catch {
      parsedBody = body ?? {};
    }

    const jobId = await this.webhookService.enqueueNotification({
      connectorId,
      body: parsedBody,
      receivedAt: new Date().toISOString(),
    });

    return { ok: true, jobId };
  }
}