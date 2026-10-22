import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';

import { IM_OUTBOUND_QUEUE, INBOUND_EVENTS_QUEUE } from '@akane/platform';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import {
  InboundEventSchema,
  JEV_SPEC_VERSION,
  type InboundEvent,
  type OutboundAction,
  type OutboundMessage,
} from '@akane/contract';
import { OUTBOUND_DELIVERY_ATTEMPTS } from './outbound-delivery.registry.js';
import {
  IdentityService,
  LinkIssuerService,
  PublishedAppLoader,
  RoutingOrchestrator,
  ClarificationSessionService,
  OtpOnboardingService,
  RoutingOutcomeRepository,
  UNLABELLED_INTENT_LABEL,
  redact,
  appIdOfToolId,
  type AuthorizedApp,
} from '@akane/domain';
import {
  OTP_ONBOARDING_INTENT,
  OtpCodeSchema,
} from '@akane/contract';

/** Absolute chat-to-link budget; `occurred_at` seeds it, never per-provider (T-03-04). */
const ROUTING_BUDGET_MS = 2000;

/**
 * The OBS-05 record's sentinel label: a routed
 * question that matched no declared label of
 * the routed app. Free-text user input never
 * lands in the record — the sentinel groups
 * unlabelled routings honestly and is inert
 * for every app's share.
 */
const UNLABELLED_INTENT = UNLABELLED_INTENT_LABEL;

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
  | { readonly kind: 'skipped'; readonly reason: string }
  // IDN-05 — OTP self-onboarding outcomes. The chat
  // adapter renders these as the employee's reply;
  // `attemptsRemaining` and `remainingMinutes` are
  // the BLD-07 actionable counts named inline.
  | { readonly kind: 'otp_requested' }
  | { readonly kind: 'otp_verified'; readonly realUserId: string }
  | { readonly kind: 'otp_invalid'; readonly attemptsRemaining: number }
  | { readonly kind: 'otp_locked'; readonly remainingMinutes: number }
  | { readonly kind: 'otp_expired' }
  | { readonly kind: 'otp_consumed' };

@Injectable()
@Processor(INBOUND_EVENTS_QUEUE)
export class InboundEventProcessor extends WorkerHost {
  constructor(
    private readonly identity: IdentityService,
    private readonly loader: PublishedAppLoader,
    private readonly orchestrator: RoutingOrchestrator,
    private readonly linkIssuer: LinkIssuerService,
    private readonly clarificationSession: ClarificationSessionService,
    private readonly onboarding: OtpOnboardingService,
    private readonly routingOutcomes: RoutingOutcomeRepository,
    @InjectQueue(IM_OUTBOUND_QUEUE) private readonly outboundQueue: Queue,
  ) {
    super();
  }

  /**
   * Run the pipeline, then hand the outcome to the delivery seam.
   *
   * BullMQ discards a processor's return value, so this used to be where every
   * `link` / `clarify` / OTP reply died silently. The outcome is now turned
   * into an `OutboundMessage` and enqueued before the promise resolves.
   *
   * `skipped` and `otp_requested` produce nothing here: there is no reply to
   * send in the first case, and in the second the code has already been
   * delivered by `OtpOnboardingService` through `OTP_DELIVERY_PORT` — a
   * plaintext OTP must never be queued (T-10-09).
   */
  async process(job: Job): Promise<ProcessorOutcome> {
    const parsed = InboundEventSchema.safeParse(job.data);
    if (!parsed.success) return { kind: 'skipped', reason: 'invalid_event' };
    const event = parsed.data;

    if (event.action === 'slash_command') {
      return this.deliver(await this.handleSlash(event), event);
    }
    if (event.action === 'interaction') {
      return this.deliver(await this.handleInteraction(event), event);
    }
    if (event.action !== 'message') return { kind: 'skipped', reason: event.action };
    return this.deliver(await this.handleMessage(event), event);
  }

  /**
   * Turn one outcome into the outbound envelope and enqueue it.
   *
   * ## The `message_id` is derived, never random
   *
   * `crypto.randomUUID()` would produce a different id every time the inbound
   * job is retried, and the id must be stable across delivery retries (10-01)
   * — the contract calls it "producer-generated, unique per outbound message,
   * stable across delivery retries". Hashing `(platform, event_id, action)`
   * gives both: unique per inbound event, and identical on every retry of it.
   *
   * ## The `jobId` is deterministic for the same reason
   *
   * BullMQ de-duplicates on `jobId` while a job with that id still exists, so
   * a re-driven inbound event cannot enqueue the reply twice.
   */
  private async deliver(
    outcome: ProcessorOutcome,
    event: InboundEvent,
  ): Promise<ProcessorOutcome> {
    const message = this.outboundFrom(outcome, event);
    if (!message) return outcome;

    await this.outboundQueue.add(
      IM_OUTBOUND_QUEUE,
      message,
      {
        // 10-06: bounded retries; the jittered backoff strategy is registered
        // on the consumer side, not here.
        attempts: OUTBOUND_DELIVERY_ATTEMPTS,
        jobId: `${event.platform}:${event.channel_id}:${message.message_id}`,
      },
    );

    return outcome;
  }

  /**
   * Map a pipeline outcome onto an outbound envelope, or `null` when the
   * outcome has no reply to send.
   *
   * Only OTP *code* delivery stays off the queue (`otp_requested` carries no
   * code in its outcome, so there is nothing to leak); the OTP *status*
   * outcomes are ordinary text and belong on the queue like any other reply.
   */
  private outboundFrom(
    outcome: ProcessorOutcome,
    event: InboundEvent,
  ): OutboundMessage | null {
    const action = outboundActionFor(outcome);
    if (!action) return null;

    const text = outboundTextFor(outcome);
    if (text === null) return null;

    return {
      message_id: outboundMessageId(event),
      platform: event.platform,
      channel_id: event.channel_id,
      chat_user_id: event.chat_user_id,
      text,
      action,
      queue: IM_OUTBOUND_QUEUE,
      // Filled in by the delivery processor from `job.attemptsMade`; the
      // enqueue itself is the first attempt.
      attempt: 0,
      // The inbound event this reply answers. The delivery processor marks the
      // ledger row for it `dispatched`, so the reconciler does not re-deliver.
      native_event_id: event.event_id,
      ...(event.thread_id ? { thread_id: event.thread_id } : {}),
      ...(event.reply_to_message_id
        ? { reply_to_message_id: event.reply_to_message_id }
        : {}),
    };
  }

  /** Form-driven slash path — no JevProvider is constructed or invoked (RTE-02). */
  private async handleSlash(event: InboundEvent): Promise<ProcessorOutcome> {
    const chat = await this.identity.resolveChat(event.platform, event.chat_user_id);
    if (!chat) return { kind: 'skipped', reason: 'unknown_user' };
    const authorized = await this.loader.listAuthorized(chat.real_user_id);
    // Slash commands arrive as '/leave request'; aliases store the
    // command without the leading slash (D-06/D-07 persisted shape), so
    // strip it before matching (07-08 Task 3, form-driven slash path).
    const command = event.text.trim().toLowerCase().replace(/^\/+/, '');
    const aliasMatch = (app: AuthorizedApp, cmd: string) =>
      app.aliases.some((alias) => alias.toLowerCase() === cmd);
    let matches = authorized.filter((app) => aliasMatch(app, command));
    if (matches.length === 0 && command.includes(' ')) {
      const first = command.split(' ')[0]!;
      matches = authorized.filter((app) => aliasMatch(app, first));
    }
    if (matches.length === 0) return { kind: 'clarify', toolIds: [] };
    if (matches.length > 1) return { kind: 'clarify', toolIds: matches.map((m) => m.tool.id) };
    const match = matches[0]!;
    if (!(await match.canOpenNow())) return { kind: 'clarify', toolIds: [] };
    const url = await this.linkIssuer.issue({
      appId: appIdOfToolId(match.tool.id),
      realUserId: chat.real_user_id,
      formId: match.form.form_id,
      formVersion: match.form.form_version,
      action: match.form.action,
    });
    return { kind: 'link', appId: appIdOfToolId(match.tool.id), url };
  }

  /**
   * Interaction / follow-up path: if an active clarification session exists
   * for this user+channel, process the reply through the state machine
   * before falling back to fresh single-turn routing (D-48…D-51).
   */
  private async handleInteraction(event: InboundEvent): Promise<ProcessorOutcome> {
    const chat = await this.identity.resolveChat(event.platform, event.chat_user_id);
    if (!chat) return this.handleUnmappedOnboarding(event);

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
    if (!chat) return this.handleUnmappedOnboarding(event);

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
      const matched = authorized.find((app) => app.tool.id === outcome.toolId);
      const url = await this.linkIssuer.issue({
        appId: appIdOfToolId(outcome.toolId),
        realUserId: chat.real_user_id,
        formId: matched?.form.form_id ?? appIdOfToolId(outcome.toolId).split(':')[1] ?? 'submit',
        formVersion: matched?.form.form_version ?? 1,
        action: matched?.form.action ?? 'create',
      });
      await this.recordRoutingOutcome(
        event,
        authorized,
        outcome.toolId,
        event.text,
      );
      return { kind: 'link', appId: appIdOfToolId(outcome.toolId), url };
    }

    // Only start a clarification session for fresh messages, not for thread
    // replies that fell through after escalation (D-51: never start a third round).
    if (outcome.toolIds.length > 0 && event.action !== 'interaction') {
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
   * IDN-05 — the unmapped-user path.
   *
   * An employee with no CSV/SSO mapping self-onboards
   * by OTP: the onboarding keyword (the IDN-04
   * prompt's expected reply) requests a code, a
   * 6-digit reply verifies it. A verified onboarding
   * creates the identity mapping, so the next
   * inbound event resolves the user with no further
   * onboarding (ROADMAP SC#3). Anything else from
   * an unmapped identity stays `unknown_user`.
   *
   * Only messages and interaction replies carry the
   * onboarding flow — a slash command from an
   * unmapped identity is still unknown_user.
   */
  private async handleUnmappedOnboarding(event: InboundEvent): Promise<ProcessorOutcome> {
    if (event.action !== 'message' && event.action !== 'interaction') {
      return { kind: 'skipped', reason: 'unknown_user' };
    }
    const text = event.text.trim();
    // A 6-digit reply is a code verification; the keyword
    // is a fresh onboarding request. The code is checked
    // first — a code reply never reads as a keyword.
    const code = OtpCodeSchema.safeParse(text);
    if (code.success) return this.handleOtpVerify(event, code.data);
    if (OTP_ONBOARDING_INTENT.test(text)) return this.handleOtpRequest(event);
    return { kind: 'skipped', reason: 'unknown_user' };
  }

  /** The onboarding intent: create the OTP state and deliver the code. */
  private async handleOtpRequest(event: InboundEvent): Promise<ProcessorOutcome> {
    const result = await this.onboarding.requestOtp(event.chat_user_id);
    if (result.status === 'locked') {
      return { kind: 'otp_locked', remainingMinutes: result.remainingMinutes };
    }
    return { kind: 'otp_requested' };
  }

  /** A code reply: verify it, creating the identity mapping on success. */
  private async handleOtpVerify(event: InboundEvent, code: string): Promise<ProcessorOutcome> {
    const result = await this.onboarding.verifyOtp(
      event.platform,
      event.chat_user_id,
      code,
    );
    switch (result.status) {
      case 'verified':
        return { kind: 'otp_verified', realUserId: result.realUserId };
      case 'invalid':
        return { kind: 'otp_invalid', attemptsRemaining: result.attemptsRemaining };
      case 'locked':
        return { kind: 'otp_locked', remainingMinutes: result.remainingMinutes };
      case 'expired':
        return { kind: 'otp_expired' };
      case 'consumed':
        return { kind: 'otp_consumed' };
    }
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
      const selectedApp = currentAuthorized.find((app) => app.tool.id === selectedId);
      const url = await this.linkIssuer.issue({
        appId: appIdOfToolId(selectedId),
        realUserId,
        formId: selectedApp?.form.form_id ?? 'submit',
        formVersion: selectedApp?.form.form_version ?? 1,
        action: selectedApp?.form.action ?? 'create',
      });
      return { kind: 'link', appId: appIdOfToolId(selectedId), url };
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
      const reevalApp = currentAuthorized.find((app) => app.tool.id === outcome.toolId);
      const url = await this.linkIssuer.issue({
        appId: appIdOfToolId(outcome.toolId),
        realUserId,
        formId: reevalApp?.form.form_id ?? 'submit',
        formVersion: reevalApp?.form.form_version ?? 1,
        action: reevalApp?.form.action ?? 'create',
      });
      await this.recordRoutingOutcome(
        event,
        currentAuthorized,
        outcome.toolId,
        combinedText,
      );
      return { kind: 'link', appId: appIdOfToolId(outcome.toolId), url };
    }

    // Persist the updated displayed choices for the next round (D-50).
    await this.clarificationSession.addReply(
      realUserId,
      event.channel_id,
      event.channel_id,
      {
        reply_text: replyText,
        reply_ts: Date.now(),
        reevaluates_original: true,
      },
      outcome.toolIds,
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

  /**
   * Record one applied link routing outcome (OBS-05) —
   * the record the `routing_share{app_id}` gauge and
   * the publish gate's dry-run baseline both read.
   *
   * Written **after** the link is durably issued: a
   * record-write failure is logged and swallowed,
   * never sacrificing the already-issued link — the
   * record is the metric's substrate, not the
   * routing's. Only link outcomes are recorded: a
   * clarify outcome names no app and produces no
   * record — the distribution is over routings to
   * apps.
   */
  private async recordRoutingOutcome(
    event: InboundEvent,
    authorized: readonly AuthorizedApp[],
    appId: string,
    question: string,
  ): Promise<void> {
    const app = authorized.find((entry) => entry.tool.id === appId);
    const intentLabel =
      app === undefined
        ? UNLABELLED_INTENT
        : firstMatchingLabel(app, question);
    try {
      await this.routingOutcomes.record({
        routing_id: event.event_id,
        intent_label: intentLabel,
        app_id: appIdOfToolId(appId),
      });
    } catch (error) {
      // The link is already issued — log the record
      // failure and still return the link.
      new Logger(InboundEventProcessor.name).error(
        `routing outcome record failed for ${event.event_id}: ${String(error)}`,
      );
    }
  }
}

/**
 * The routed app's declared intent label the question
 * matched — the first of its declared intents/aliases
 * the question contains case-insensitively, or the
 * 'unlabelled' sentinel when none matches (never the
 * raw question text).
 */
function firstMatchingLabel(
  app: Pick<AuthorizedApp, 'intents' | 'aliases'>,
  question: string,
): string {
  const lowered = question.toLowerCase();
  for (const label of [...app.intents, ...app.aliases]) {
    if (label.length > 0 && lowered.includes(label.toLowerCase())) {
      return label;
    }
  }
  return UNLABELLED_INTENT;
}

/**
 * The outbound envelope action an outcome maps to, or `null` when the outcome
 * has no reply.
 *
 * The `OutboundAction` union is what makes the platform's replies
 * inspectable (10-01): an operator can tell a rendered form link from a
 * clarify prompt or an error without reading the body.
 */
function outboundActionFor(outcome: ProcessorOutcome): OutboundAction | null {
  switch (outcome.kind) {
    case 'link':
      return 'form_link';
    case 'clarify':
      return 'reply';
    case 'otp_verified':
    case 'otp_invalid':
    case 'otp_locked':
    case 'otp_expired':
    case 'otp_consumed':
      return 'error';
    case 'otp_requested':
    // No reply: the code itself was delivered by OTP onboarding through
    // OTP_DELIVERY_PORT, and re-sending it here would put a plaintext code
    // in a queue (T-10-09).
    case 'skipped':
      return null;
  }
}

/**
 * The visible text for an outcome, or `null` when there is nothing to say.
 *
 * Blunt by design: this is the seam, not the copy. Phase 11 owns the wording
 * and the locale — `detectLocale` already exists above and the envelope has
 * no locale field — so the strings live in one reviewed place rather than
 * scattered across six `return` sites.
 */
function outboundTextFor(outcome: ProcessorOutcome): string | null {
  switch (outcome.kind) {
    case 'link':
      return outcome.url;
    case 'clarify':
      return 'Which app did you mean? Reply with the app name, or /help for the list.';
    case 'otp_verified':
      return 'Your identity is confirmed. Send your request again to continue.';
    case 'otp_invalid':
      return `That code did not match. ${outcome.attemptsRemaining} attempt(s) remaining.`;
    case 'otp_locked':
      return `Too many attempts. Try again in ${outcome.remainingMinutes} minute(s).`;
    case 'otp_expired':
      return 'That code has expired. Send "onboard me" to request a new one.';
    case 'otp_consumed':
      return 'That code was already used. Send "onboard me" to request a new one.';
    case 'otp_requested':
    case 'skipped':
      return null;
  }
}

/**
 * The stable outbound message id for one inbound event.
 *
 * A digest rather than `randomUUID()` because the id must be identical on
 * every retry of the same inbound event: BullMQ re-drives the inbound job on
 * failure, and a fresh id each time would enqueue the *same* reply as several
 * distinct messages.
 */
function outboundMessageId(event: InboundEvent): string {
  return createHash('sha256')
    .update(`outbound:${event.platform}:${event.event_id}:${event.action}`)
    .digest('hex')
    .slice(0, 32);
}
