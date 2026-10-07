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
  ClarificationSessionService,
  redact,
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
    private readonly clarificationSession: ClarificationSessionService,
  ) {
    super();
  }

  async process(job: Job): Promise<ProcessorOutcome> {
    const parsed = InboundEventSchema.safeParse(job.data);
    if (!parsed.success) return { kind: 'skipped', reason: 'invalid_event' };
    const event = parsed.data;

    if (event.action === 'slash_command') return this.handleSlash(event);
    if (event.action === 'interaction') return this.handleInteraction(event);
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

  /**
   * Interaction / follow-up path: if an active clarification session exists
   * for this user+channel, process the reply through the state machine
   * before falling back to fresh single-turn routing (D-48…D-51).
   */
  private async handleInteraction(event: InboundEvent): Promise<ProcessorOutcome> {
    const chat = await this.identity.resolveChat(event.platform, event.chat_user_id);
    if (!chat) return { kind: 'skipped', reason: 'unknown_user' };

    const outcome = await this.processClarificationReply(chat.real_user_id, event);
    if (outcome) return outcome;

    // No active clarification session — fall back to fresh routing.
    return this.handleMessage(event);
  }

  /**
   * Fresh message path: check for an active clarification session first;
   * only invoke the orchestrator when there is no ongoing thread (D-49).
   */
  private async handleMessage(event: InboundEvent): Promise<ProcessorOutcome> {
    const chat = await this.identity.resolveChat(event.platform, event.chat_user_id);
    if (!chat) return { kind: 'skipped', reason: 'unknown_user' };

    const clarificationOutcome = await this.processClarificationReply(chat.real_user_id, event);
    if (clarificationOutcome) return clarificationOutcome;

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

    // Only start a clarification session when there are displayed choices
    // for the user to select from (D-48). An empty alternative list falls
    // through to the worker-owned authorized-examples reply below.
    if (outcome.toolIds.length > 0) {
      const redacted = redact(event.text);
      await this.clarificationSession.createSession(
        chat.real_user_id,
        event.channel_id,
        event.channel_id,
        redacted.text,
        [...outcome.toolIds],
        locale,
      );
    }

    return { kind: 'clarify', toolIds: outcome.toolIds };
  }

  /**
   * Process a reply against an active clarification session.
   * Returns an outcome when a session exists, or `null` when there is none.
   */
  private async processClarificationReply(
    realUserId: string,
    event: InboundEvent,
  ): Promise<ProcessorOutcome | null> {
    const session = await this.clarificationSession.getSession(
      realUserId,
      event.channel_id,
      event.channel_id,
    );
    if (!session) return null;

    const replyText = event.text.trim();
    const currentAuthorized = await this.loader.listAuthorized(realUserId);
    const permittedIds = new Set(currentAuthorized.map((app) => app.tool.id));
    const freshChoices = session.displayed_choice_ids.filter((id) => permittedIds.has(id));

    // If the displayed set is now empty, nothing to clarify against.
    if (freshChoices.length === 0) {
      await this.clarificationSession.invalidateSession(realUserId, event.channel_id, event.channel_id);
      return { kind: 'clarify', toolIds: [] };
    }

    // Try to match the reply to a displayed choice by number or by name/ID.
    const selectedId = this.matchReplyToChoice(replyText, freshChoices, currentAuthorized);

    if (selectedId) {
      // Number/name selection: re-check RBAC + canOpenNow before issuing (D-50).
      const authorizedApp = currentAuthorized.find((app) => app.tool.id === selectedId);
      if (!authorizedApp || !(await authorizedApp.canOpenNow())) {
        // Revoked between display and reply — re-filter and re-clarify.
        const remaining = freshChoices.filter((id) => {
          const app = currentAuthorized.find((a) => a.tool.id === id);
          return app !== undefined && app.canOpenNow();
        });
        await this.clarificationSession.invalidateSession(realUserId, event.channel_id, event.channel_id);
        return { kind: 'clarify', toolIds: remaining.slice(0, 3) };
      }

      await this.clarificationSession.invalidateSession(realUserId, event.channel_id, event.channel_id);
      const url = await this.linkIssuer.issue({ appId: selectedId, realUserId });
      return { kind: 'link', appId: selectedId, url };
    }

    // Not a direct selection — treat as detail-adding reply (D-50).
    const updatedSession = await this.clarificationSession.addReply(
      realUserId,
      event.channel_id,
      event.channel_id,
      {
        reply_text: replyText,
        reply_ts: Date.now(),
        reevaluates_original: true,
      },
    );

    if (!updatedSession || updatedSession.replies_used >= 2) {
      // Two unsuccessful replies — offer examples/slash commands and stop (D-51).
      await this.clarificationSession.invalidateSession(realUserId, event.channel_id, event.channel_id);
      return { kind: 'clarify', toolIds: freshChoices.slice(0, 3) };
    }

    // Re-evaluate original + reply as one context via the orchestrator.
    const locale = session.locale === 'vi' ? 'vi' : 'en';
    const combinedText = `${session.original_question} ${replyText}`;
    const deadlineEpochMs = Date.parse(event.occurred_at) + ROUTING_BUDGET_MS;

    const outcome = await this.orchestrator.route({
      draft: {
        spec_version: JEV_SPEC_VERSION,
        request_id: event.event_id,
        state: {
          locale,
          conversation_id: event.channel_id,
          turn_count: updatedSession.replies_used,
          force_clarification: locale !== 'en' && locale !== 'vi',
        },
        question: combinedText,
        context: {
          real_user_id: realUserId,
          app_hints: [],
          previous_turns: [
            { role: 'user', text: session.original_question },
            { role: 'user', text: replyText },
          ],
        },
      },
      authorizedTools: currentAuthorized.map((app) => app.tool),
      threshold: (toolId) => currentAuthorized.find((app) => app.tool.id === toolId)?.threshold ?? 1,
      canOpenNow: async (toolId) =>
        (await currentAuthorized.find((app) => app.tool.id === toolId)?.canOpenNow()) ?? false,
      deadlineEpochMs,
    });

    if (outcome.kind === 'link') {
      await this.clarificationSession.invalidateSession(realUserId, event.channel_id, event.channel_id);
      const url = await this.linkIssuer.issue({ appId: outcome.toolId, realUserId });
      return { kind: 'link', appId: outcome.toolId, url };
    }

    // Update the session with the new displayed choices for the next round.
    const redactedCombined = redact(combinedText);
    await this.clarificationSession.createSession(
      realUserId,
      event.channel_id,
      event.channel_id,
      redactedCombined.text,
      [...outcome.toolIds],
      locale,
    );

    return { kind: 'clarify', toolIds: outcome.toolIds.slice(0, 3) };
  }

  /**
   * Match a reply string to one of the displayed choice IDs.
   * Supports 1-based numeric selection and case-insensitive name/ID matching.
   */
  private matchReplyToChoice(
    replyText: string,
    choiceIds: string[],
    authorizedApps: { tool: { id: string }; aliases: readonly string[] }[],
  ): string | null {
    // Numeric selection: "1", "2", "3" → 1-based index.
    const numericMatch = replyText.match(/^(\d+)$/);
    if (numericMatch) {
      const index = Number.parseInt(numericMatch[1], 10) - 1;
      if (index >= 0 && index < choiceIds.length) return choiceIds[index]!;
      return null;
    }

    // Name/ID selection: case-insensitive match against ID or aliases.
    const lowered = replyText.toLowerCase();
    for (const choiceId of choiceIds) {
      if (choiceId.toLowerCase() === lowered) return choiceId;
      const app = authorizedApps.find((a) => a.tool.id === choiceId);
      if (app?.aliases.some((alias) => alias.toLowerCase() === lowered)) return choiceId;
    }

    return null;
  }
}
