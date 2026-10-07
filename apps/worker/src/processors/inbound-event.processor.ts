import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  InboundEventSchema,
  JEV_SPEC_VERSION,
  type InboundEvent,
} from '@akane/contract';
import {
  IdentityService,
  LinkIssuerService,
  PublishedAppLoader,
  RoutingOrchestrator,
} from '@akane/domain';

/** Absolute chat-to-link budget; `occurred_at` seeds it, never per-provider (T-03-04). */
const ROUTING_BUDGET_MS = 2000;

/**
 * Deterministic slash → app binding (Phase 2 path). Slash commands NEVER
 * construct or call a JevProvider (RTE-02): this map is the whole decision.
 */
const SLASH_COMMAND_APP: Readonly<Record<string, string>> = {
  '/leave request': 'leave-request',
  '/leave': 'leave-request',
};

/** Coarse en/vi/other guess for the frozen `state.locale` field (D-60/D-62). */
function detectLocale(text: string): string {
  if (/\p{Script=Latin}/u.test(text) && /[a-z]/i.test(text) && !/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text)) {
    return 'en';
  }
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text)) {
    return 'vi';
  }
  return 'und';
}

export type ProcessorOutcome =
  | { readonly kind: 'link'; readonly appId: string; readonly url: string }
  | { readonly kind: 'clarify'; readonly toolIds: readonly string[] }
  | { readonly kind: 'skipped'; readonly reason: string };

@Injectable()
@Processor('inbound-events')
export class InboundEventProcessor extends WorkerHost {
  constructor(
    private readonly identity: IdentityService,
    private readonly loader: PublishedAppLoader,
    private readonly orchestrator: RoutingOrchestrator,
    private readonly linkIssuer: LinkIssuerService,
  ) {
    super();
  }

  async process(job: Job): Promise<ProcessorOutcome> {
    const parsed = InboundEventSchema.safeParse(job.data);
    if (!parsed.success) return { kind: 'skipped', reason: 'invalid_event' };
    const event = parsed.data;

    if (event.action === 'slash_command') return this.handleSlash(event);
    if (event.action !== 'message') return { kind: 'skipped', reason: event.action };
    return this.handleMessage(event);
  }

  /** Phase 2 deterministic path — no JevProvider is constructed or invoked. */
  private async handleSlash(event: InboundEvent): Promise<ProcessorOutcome> {
    const chat = await this.identity.resolveChat(event.platform, event.chat_user_id);
    if (!chat) return { kind: 'skipped', reason: 'unknown_user' };
    const command = event.text.trim().toLowerCase();
    const appId = event.app_id ?? SLASH_COMMAND_APP[command] ?? SLASH_COMMAND_APP[command.split(' ')[0]];
    if (!appId) return { kind: 'clarify', toolIds: [] };
    const authorized = await this.loader.listAuthorized(chat.real_user_id);
    const match = authorized.find((app) => app.tool.id === appId);
    if (!match || !(await match.canOpenNow())) return { kind: 'clarify', toolIds: [] };
    const url = await this.linkIssuer.issue({ appId: match.tool.id, realUserId: chat.real_user_id });
    return { kind: 'link', appId: match.tool.id, url };
  }

  private async handleMessage(event: InboundEvent): Promise<ProcessorOutcome> {
    const chat = await this.identity.resolveChat(event.platform, event.chat_user_id);
    if (!chat) return { kind: 'skipped', reason: 'unknown_user' };

    const authorized = await this.loader.listAuthorized(chat.real_user_id);
    const locale = detectLocale(event.text);
    const deadlineEpochMs = Date.parse(event.occurred_at) + ROUTING_BUDGET_MS;

    const outcome = await this.orchestrator.route({
      draft: {
        spec_version: JEV_SPEC_VERSION,
        request_id: event.event_id,
        state: {
          locale,
          conversation_id: event.channel_id,
          turn_count: 0,
          force_clarification: locale !== 'en' && locale !== 'vi',
        },
        question: event.text,
        context: {
          real_user_id: chat.real_user_id,
          app_hints: event.app_id ? [event.app_id] : [],
          previous_turns: [],
        },
      },
      authorizedTools: authorized.map((app) => app.tool),
      threshold: (toolId) => authorized.find((app) => app.tool.id === toolId)?.threshold ?? 1,
      canOpenNow: async (toolId) =>
        (await authorized.find((app) => app.tool.id === toolId)?.canOpenNow()) ?? false,
      deadlineEpochMs,
    });

    if (outcome.kind === 'link') {
      const url = await this.linkIssuer.issue({ appId: outcome.toolId, realUserId: chat.real_user_id });
      return { kind: 'link', appId: outcome.toolId, url };
    }
    return { kind: 'clarify', toolIds: outcome.toolIds };
  }
}
