import { Injectable, NotImplementedException } from '@nestjs/common';
import type { OutboundMessage } from '@akane/contract/events/outbound-message.js';

/**
 * Teams outbound delivery service (stub for Phase 08-02).
 *
 * This service will be extended in 08-02 to deliver messages via the Microsoft
 * 365 Agents SDK. The adapter boundary is preserved: only contract types
 * (OutboundMessage) cross into this service.
 *
 * No Teams SDK types are exported from this adapter.
 */
@Injectable()
export class TeamsOutboundService {
  async sendMessage(_message: OutboundMessage): Promise<void> {
    // Stub implementation - will be completed in 08-02
    throw new NotImplementedException('Teams outbound delivery not yet implemented (Phase 08-02)');
  }

  async sendFormLink(_message: OutboundMessage): Promise<void> {
    // Stub implementation - will be completed in 08-02
    throw new NotImplementedException('Teams outbound delivery not yet implemented (Phase 08-02)');
  }
}
