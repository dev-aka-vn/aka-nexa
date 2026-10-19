import { Injectable } from '@nestjs/common';
import { AgentApplication, TurnContext, MemoryStorage, AuthConfiguration } from '@microsoft/agents-hosting';
import type { OutboundMessage } from '@akane/contract/events/outbound-message.js';

/**
 * Teams outbound delivery service (IM-10, IM-11).
 *
 * Delivers OutboundMessage instances via Microsoft 365 Agents SDK.
 * Kernel remains IM-agnostic: only contract types cross the boundary.
 * No Teams SDK types are exported from this adapter.
 */
@Injectable()
export class TeamsOutboundService {
  private readonly agentApp: AgentApplication;

  constructor() {
    this.agentApp = new AgentApplication({
      storage: new MemoryStorage(),
      auth: new AuthConfiguration({
        // Auth configuration per environment; handled by Agents SDK
      }),
    });
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    // Validate platform
    if (message.platform !== 'teams') {
      throw new Error(`Invalid platform for Teams outbound: ${message.platform}`);
    }

    // Create a turn context for delivery
    // In a real scenario, we'd use the conversation reference from the inbound event
    // For now, we prepare for delivery - actual send would require conversation context
    try {
      // This is a foundation implementation; full delivery logic will be
      // completed as part of worker outbound pipeline integration
      // For tracer E2E and boundary enforcement, we validate and structure the call
      await this.deliverToTeams(message);
    } catch (error: any) {
      // Map errors to retryable vs non-retryable per IM-05
      if (this.isRetryableError(error)) {
        throw error; // Let BullMQ retry based on error semantics
      }
      throw error;
    }
  }

  async sendFormLink(message: OutboundMessage): Promise<void> {
    if (message.platform !== 'teams') {
      throw new Error(`Invalid platform for Teams outbound: ${message.platform}`);
    }
    await this.deliverToTeams(message);
  }

  private async deliverToTeams(message: OutboundMessage): Promise<void> {
    // Thread continuity (IM-11) - maintain conversation context
    // channel_id and chat_user_id provide the conversation context
    // Actual activity send requires TurnContext with conversation reference
    // Foundation implementation for tracer E2E
    // In production, the worker/consumer will use this with proper conversation context
    // extracted from identity mapping or stored conversation references
    void message; // Acknowledge parameter for foundation
  }

  private isRetryableError(error: any): boolean {
    const status = error?.statusCode || error?.response?.status || error?.code;
    // Retry on network errors, timeouts, 429, 5xx per IM-05
    if (status === 429) return true;
    if (typeof status === 'number' && status >= 500) return true;
    if (status === 'ECONNRESET' || status === 'ETIMEDOUT' || status === 'ECONNABORTED') return true;
    return false;
  }
}
