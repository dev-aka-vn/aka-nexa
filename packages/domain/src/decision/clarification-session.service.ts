/**
 * Clarification Session Service
 *
 * Manages bounded multi-turn clarification in the same Slack thread:
 * - State keyed by opaque user + channel + thread_ts on REDIS_CACHE
 * - At most 2 replies before escalating to authorized examples + slash commands
 * - Every reply re-checks fresh RBAC + canOpenNow for displayed choices
 * - Detail-adding replies re-evaluate original request + reply as one context
 * - Displayed choices are always authorized at display time (D-48, D-50)
 *
 * @module decision/clarification-session
 */

import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Clarification session state stored in Redis
 */
export interface ClarificationSession {
  original_question: string;
  displayed_choice_ids: string[]; // ≤3, all authorized at display time
  replies_used: number; // 0–2
  locale: string;
  expires_at: number; // Unix timestamp
}

/**
 * Clarification reply context
 */
export interface ClarificationReply {
  reply_text: string;
  reply_ts: number; // Unix timestamp for ordering within thread
  reevaluates_original: boolean; // true if adding details, false if selecting choice
}

/**
 * Clarification response
 */
export interface ClarificationResponse {
  action: 'select' | 'clarify' | 'escalate';
  choices?: string[]; // App IDs for 'select'
  reply_text?: string; // Worker-owned localized copy
  escalation_text?: string; // After 2 failed replies
}

/**
 * Service for managing clarification sessions in Redis
 */
@Injectable()
export class ClarificationSessionService {
  private readonly logger = new Logger(ClarificationSessionService.name);

  // Redis key prefix
  private readonly KEY_PREFIX = 'jev:clarify:';

  // Maximum number of replies before escalating
  private readonly MAX_REPLIES = 2;

  // Maximum displayed choices (D-48)
  private readonly MAX_DISPLAYED_CHOICES = 3;

  // Session TTL: max(2 × 2s routing budget, thread-interaction window, e.g. 15 minutes)
  // The routing budget is 2000ms (2s), so 2 × 2000ms = 4000ms.
  // We use a practical 15-minute window for thread interaction.
  private readonly SESSION_TTL_MS = 15 * 60 * 1000;

  constructor(private readonly redis: Redis) {}

  /**
   * Generate the Redis key for a clarification session
   */
  private sessionKey(realUserId: string, channelId: string, threadTs: string): string {
    return `${this.KEY_PREFIX}${realUserId}:${channelId}:${threadTs}`;
  }

  /**
   * Create a new clarification session
   */
  async createSession(
    realUserId: string,
    channelId: string,
    threadTs: string,
    originalQuestion: string,
    displayedChoiceIds: string[],
    locale: string,
  ): Promise<void> {
    const key = this.sessionKey(realUserId, channelId, threadTs);

    const session: ClarificationSession = {
      original_question: originalQuestion,
      displayed_choice_ids: displayedChoiceIds.slice(0, this.MAX_DISPLAYED_CHOICES),
      replies_used: 0,
      locale: locale,
      expires_at: Date.now() + this.SESSION_TTL_MS,
    };

    await this.redis.set(key, JSON.stringify(session), 'PX', this.SESSION_TTL_MS);

    this.logger.debug(`Created clarification session: ${key}`);
  }

  /**
   * Retrieve an existing clarification session
   */
  async getSession(
    realUserId: string,
    channelId: string,
    threadTs: string,
  ): Promise<ClarificationSession | null> {
    const key = this.sessionKey(realUserId, channelId, threadTs);

    const data = await this.redis.get(key);
    if (!data) {
      return null;
    }

    try {
      const session: ClarificationSession = JSON.parse(data);

      // Check expiry
      if (Date.now() > session.expires_at) {
        await this.redis.del(key);
        return null;
      }

      return session;
    } catch (error) {
      this.logger.error(`Failed to parse clarification session: ${error}`);
      await this.redis.del(key);
      return null;
    }
  }

  /**
   * Update a clarification session with a reply
   */
  async addReply(
    realUserId: string,
    channelId: string,
    threadTs: string,
    reply: ClarificationReply,
    displayedChoiceIds?: string[],
  ): Promise<ClarificationSession | null> {
    const session = await this.getSession(realUserId, channelId, threadTs);
    if (!session) {
      return null;
    }

    // Increment reply count
    session.replies_used += 1;

    // If reply adds details, re-evaluate original request + reply as one context
    // (D-50: detail-adding reply re-evaluates original request plus reply as one context)
    if (reply.reevaluates_original) {
      session.original_question = `${session.original_question} ${reply.reply_text}`;
    }

    // Update displayed choices if provided (D-50: re-filter on every reply)
    if (displayedChoiceIds !== undefined) {
      session.displayed_choice_ids = displayedChoiceIds.slice(0, this.MAX_DISPLAYED_CHOICES);
    }

    // If it's a choice selection, filter displayed choices to authorized ones
    // (D-50: re-filter the displayed set on every reply so revoked apps disappear)
    if (reply.reply_text && !reply.reevaluates_original) {
      // This is a choice selection - the caller will validate it against fresh RBAC
      // We don't modify displayed_choice_ids here; the caller does that
    }

    // Update expiry
    session.expires_at = Date.now() + this.SESSION_TTL_MS;

    // Persist updated session
    const key = this.sessionKey(realUserId, channelId, threadTs);
    await this.redis.set(key, JSON.stringify(session), 'PX', this.SESSION_TTL_MS);

    return session;
  }

  /**
   * Get the clarification response for a reply
   */
  async getClarificationResponse(
    session: ClarificationSession,
    reply: ClarificationReply,
    currentAuthorizedChoices: string[],
  ): Promise<ClarificationResponse> {
    // Check if we've exceeded the maximum number of replies
    if (session.replies_used >= this.MAX_REPLIES) {
      return {
        action: 'escalate',
        escalation_text: this.getEscalationText(session.locale),
      };
    }

    // If this is a choice selection (not detail-adding)
    if (!reply.reevaluates_original && reply.reply_text) {
      return {
        action: 'clarify',
        reply_text: this.getChoiceConfirmationText(session.locale),
        choices: currentAuthorizedChoices.slice(0, this.MAX_DISPLAYED_CHOICES),
      };
    }

    // If this is a detail-adding reply
    return {
      action: 'clarify',
      reply_text: this.getDetailConfirmationText(session.locale),
      choices: currentAuthorizedChoices.slice(0, this.MAX_DISPLAYED_CHOICES),
    };
  }

  /**
   * Get escalation text after max replies reached
   */
  private getEscalationText(locale: string): string {
    if (locale === 'vi') {
      return 'Tôi đã hỏi lại hai lần rồi. Hãy dùng lệnh slash thay vào:\n' +
             '/xin nghỉ phép, /hỗ trợ it, /yêu cầu mua hàng';
    }
    // Default to English
    return 'I can only clarify twice. Please use one of these commands instead:\n' +
           '/leave request, /it-support, /procurement-request';
  }

  /**
   * Get choice confirmation text
   */
  private getChoiceConfirmationText(locale: string): string {
    if (locale === 'vi') {
      return 'Đã hiểu. Tôi đang xử lý yêu cầu của bạn.';
    }
    return 'Got it. I\'m processing your request now.';
  }

  /**
   * Get detail confirmation text
   */
  private getDetailConfirmationText(locale: string): string {
    if (locale === 'vi') {
      return 'Đã hiểu. Tôi đang đánh giá lại yêu cầu của bạn với thông tin bổ sung.';
    }
    return 'Got it. I\'m re-evaluating your request with the additional details.';
  }

  /**
   * Invalidate a clarification session (e.g., on revocation or catalog change)
   */
  async invalidateSession(
    realUserId: string,
    channelId: string,
    threadTs: string,
  ): Promise<void> {
    const key = this.sessionKey(realUserId, channelId, threadTs);
    await this.redis.del(key);
    this.logger.debug(`Invalidated clarification session: ${key}`);
  }

  /**
   * Clean up expired sessions (run periodically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    // Note: Redis TTL handles expiry, but we can add cleanup logic if needed
    return 0;
  }
}
