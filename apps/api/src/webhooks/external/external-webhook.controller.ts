import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  RawBody,
  UnauthorizedException,
} from '@nestjs/common';

import { NonceStoreService } from './nonce-store.service.js';
import { ExternalWebhookService } from './external-webhook.service.js';
import { WebhookHmacService } from './webhook-hmac.service.js';
import { ConnectorTrustRepository, AuditRepository } from '@akane/domain';

@Controller('webhooks/external')
export class ExternalWebhookController {
  private readonly logger = new Logger(ExternalWebhookController.name);

  constructor(
    private readonly nonceStore: NonceStoreService,
    private readonly webhookService: ExternalWebhookService,
    private readonly hmac: WebhookHmacService,
    private readonly trustRepo: ConnectorTrustRepository,
    private readonly audit: AuditRepository,
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

    // 1b. Trust mechanism gate (NOT-05)
    let trust: Awaited<ReturnType<ConnectorTrustRepository['get']>> | null = null;
    try {
      trust = await this.trustRepo.get(connectorId);
    } catch (e) {
      this.logger.warn({ reason: 'connector_trust_lookup_failed', connectorId, error: String(e) });
      trust = null;
    }
    if (trust && trust.mechanism !== 'hmac-sha256') {
      this.logger.warn({
        reason: 'connector_trust_alternative',
        connectorId,
        mechanism: trust.mechanism,
      });
      await this.audit.append({
        timestamp: new Date(),
        actor: 'system',
        action: 'webhook.refused_alternative_trust',
        target: connectorId,
        connectorId,
        mechanism: trust.mechanism,
      });
      throw new ForbiddenException('Connector uses an alternative trust mechanism; unsigned webhook refused');
    }

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