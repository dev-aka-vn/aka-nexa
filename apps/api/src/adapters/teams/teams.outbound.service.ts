import { Inject, Injectable } from '@nestjs/common';
import {
  CloudAdapter,
  loadAuthConfigFromEnv,
  type AuthConfiguration,
} from '@microsoft/agents-hosting';
import type { OutboundMessage } from '@akane/contract';
import { ConversationReferenceRepository } from '@akane/domain';

export const TEAMS_CLOUD_ADAPTER = Symbol('TEAMS_CLOUD_ADAPTER');

/**
 * Lazily built holder around the Agents SDK CloudAdapter. Construction does not
 * touch the environment; the adapter and auth config are built on first delivery
 * so a module without Teams env vars still boots.
 */
export class TeamsCloudAdapterHolder {
  private authConfig?: AuthConfiguration;
  private adapter?: CloudAdapter;

  get botAppId(): string {
    if (!this.authConfig) {
      this.authConfig = loadAuthConfigFromEnv();
    }
    return this.authConfig.clientId ?? '';
  }

  async ensureAdapter(): Promise<CloudAdapter> {
    if (!this.adapter) {
      this.authConfig = loadAuthConfigFromEnv();
      this.adapter = new CloudAdapter(this.authConfig);
    }
    return this.adapter;
  }

  async continueConversation(
    botAppId: string,
    reference: unknown,
    logic: (context: { sendActivity: (activity: unknown) => Promise<unknown> }) => Promise<void>,
    isResponse?: boolean,
  ): Promise<void> {
    const adapter = await this.ensureAdapter();
    const id = botAppId && botAppId.length > 0 ? botAppId : this.botAppId;
    await adapter.continueConversation(id, reference as never, logic as never, isResponse as never);
  }
}

function readErrorStatus(error: unknown): number | string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { statusCode?: unknown; response?: unknown; code?: unknown };
  if (typeof candidate.statusCode === 'number' || typeof candidate.statusCode === 'string') {
    return candidate.statusCode;
  }
  const response = candidate.response;
  if (typeof response === 'object' && response !== null) {
    const status = (response as { status?: unknown }).status;
    if (typeof status === 'number' || typeof status === 'string') {
      return status;
    }
  }
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  return undefined;
}

@Injectable()
export class TeamsOutboundService {
  constructor(
    private readonly convRefRepo: ConversationReferenceRepository,
    @Inject(TEAMS_CLOUD_ADAPTER) private readonly adapter: {
      continueConversation: (
        botAppId: string,
        reference: unknown,
        logic: (context: { sendActivity: (activity: unknown) => Promise<unknown> }) => Promise<void>,
      ) => Promise<void>;
      botAppId?: string;
    },
  ) {}

  private getBotAppId(): string {
    const holder = this.adapter as { botAppId?: string };
    if (typeof holder.botAppId === 'string' && holder.botAppId.length > 0) {
      return holder.botAppId;
    }
    try {
      return loadAuthConfigFromEnv().clientId ?? '';
    } catch {
      return '';
    }
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (message.platform !== 'teams') {
      throw new Error(`Invalid platform for Teams outbound: ${message.platform}`);
    }

    const key = ConversationReferenceRepository.key(message.channel_id, message.chat_user_id);
    const ref = await this.convRefRepo.get(key);
    if (!ref) {
      throw new Error(
        `No conversation reference for ${message.channel_id}/${message.chat_user_id}`,
      );
    }

    const logic = async (context: { sendActivity: (activity: unknown) => Promise<unknown> }) => {
      await context.sendActivity({ type: 'message', text: message.text });
    };

    try {
      await this.adapter.continueConversation(this.getBotAppId(), ref.reference, logic);
    } catch (error: unknown) {
      if (this.isRetryableError(error)) {
        throw error;
      }
      throw new Error(`Non-retryable Teams delivery error: ${String(error)}`);
    }
  }

  async sendFormLink(message: OutboundMessage): Promise<void> {
    if (message.platform !== 'teams') {
      throw new Error(`Invalid platform for Teams outbound: ${message.platform}`);
    }
    await this.sendMessage(message);
  }

  private isRetryableError(error: unknown): boolean {
    const status = readErrorStatus(error);
    if (status === 429) return true;
    if (typeof status === 'number' && status >= 500) return true;
    if (status === 'ECONNRESET' || status === 'ETIMEDOUT' || status === 'ECONNABORTED') return true;
    return false;
  }
}