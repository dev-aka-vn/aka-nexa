/**
 * Clarification Session Service Tests
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ClarificationSessionService } from './clarification-session.service.js';
import { Redis } from 'ioredis';

/** Minimal in-memory stand-in for the Redis subset used by the service. */
class FakeRedis {
  private store = new Map<string, string>();
  private ttis = new Map<string, number>();

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK'> {
    this.store.set(key, value);
    // Support `PX <ttl>` style positional args used by the service.
    if (args[0] === 'PX' && typeof args[1] === 'number') {
      this.ttis.set(key, Date.now() + args[1]);
    }
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) {
      this.store.delete(key);
      this.ttis.delete(key);
      return null;
    }
    return this.store.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    this.ttis.delete(key);
    return this.store.delete(key) ? 1 : 0;
  }

  async pttl(key: string): Promise<number> {
    if (this.isExpired(key)) {
      this.store.delete(key);
      this.ttis.delete(key);
      return -2;
    }
    const ttl = this.ttis.get(key);
    if (ttl === undefined) return -1;
    return Math.max(0, ttl - Date.now());
  }

  async quit(): Promise<void> {
    this.store.clear();
    this.ttis.clear();
  }

  private isExpired(key: string): boolean {
    const ttl = this.ttis.get(key);
    if (ttl === undefined) return false;
    return Date.now() > ttl;
  }
}

describe('ClarificationSessionService', () => {
  let service: ClarificationSessionService;
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new ClarificationSessionService(redis as unknown as Redis);
  });

  afterEach(async () => {
    await redis.quit();
  });

  describe('createSession', () => {
    it('should create a new clarification session', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);

      expect(session).not.toBeNull();
      expect(session?.original_question).toBe(originalQuestion);
      expect(session?.displayed_choice_ids).toEqual(displayedChoiceIds);
      expect(session?.replies_used).toBe(0);
      expect(session?.locale).toBe(locale);
      expect(session?.expires_at).toBeGreaterThan(Date.now());
    });

    it('should limit displayed choices to MAX_DISPLAYED_CHOICES (3)', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['app1', 'app2', 'app3', 'app4', 'app5'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);

      expect(session?.displayed_choice_ids).toHaveLength(3);
      expect(session?.displayed_choice_ids).toEqual(['app1', 'app2', 'app3']);
    });

    it('should handle empty displayed choices', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds: string[] = [];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);

      expect(session?.displayed_choice_ids).toHaveLength(0);
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);

      expect(session).not.toBeNull();
      expect(session?.original_question).toBe(originalQuestion);
    });

    it('should return null for non-existent session', async () => {
      const session = await service.getSession('user-123', 'C123', '123.456');

      expect(session).toBeNull();
    });

    it('should return null for expired session', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      // Manually expire the session by manipulating the fake Redis TTL
      const key = service['sessionKey'](realUserId, channelId, threadTs);
      const raw = await redis['get'](key);
      if (raw) {
        const parsed = JSON.parse(raw);
        parsed.expires_at = Date.now() - 1000;
        await redis['set'](key, JSON.stringify(parsed), 'PX', 60000);
      }

      const session = await service.getSession(realUserId, channelId, threadTs);

      expect(session).toBeNull();
    });

    it('should return null and delete malformed session data', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      // Store malformed JSON directly in fake redis
      const key = service['sessionKey'](realUserId, channelId, threadTs);
      await redis['del'](key);
      await redis['set'](key, '{malformed}', 'PX', 60000);

      const session = await service.getSession(realUserId, channelId, threadTs);

      expect(session).toBeNull();
    });
  });

  describe('addReply', () => {
    it('should increment reply count', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      // Add first reply
      const reply1: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply1);

      const session1 = await service.getSession(realUserId, channelId, threadTs);
      expect(session1?.replies_used).toBe(1);

      // Add second reply
      const reply2: any = { reply_text: '2', reply_ts: 200, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply2);

      const session2 = await service.getSession(realUserId, channelId, threadTs);
      expect(session2?.replies_used).toBe(2);
    });

    it('should re-evaluate original question when reply adds details', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      // Add a detail-adding reply
      const reply: any = {
        reply_text: 'but I need it for tomorrow',
        reply_ts: 100,
        reevaluates_original: true,
      };
      await service.addReply(realUserId, channelId, threadTs, reply);

      const session = await service.getSession(realUserId, channelId, threadTs);
      expect(session?.original_question).toBe('I want to request leave but I need it for tomorrow');
    });

    it('should NOT re-evaluate original question for choice selection', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      // Add a choice selection
      const reply: any = {
        reply_text: '1',
        reply_ts: 100,
        reevaluates_original: false,
      };
      await service.addReply(realUserId, channelId, threadTs, reply);

      const session = await service.getSession(realUserId, channelId, threadTs);
      expect(session?.original_question).toBe(originalQuestion);
    });

    it('should extend expiry on each reply', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const key = service['sessionKey'](realUserId, channelId, threadTs);
      // Allow a tick so the initial PTTL is not the full TTL.
      await new Promise((r) => setTimeout(r, 10));
      const initialExpiry = await redis.pttl(key);

      // Add a reply
      const reply: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply);

      const newExpiry = await redis.pttl(key);
      expect(newExpiry).toBeGreaterThan(initialExpiry);
    });
  });

  describe('getClarificationResponse', () => {
    it('should return escalate action after MAX_REPLIES', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      // Add 2 replies (max)
      const reply1: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply1);

      const reply2: any = { reply_text: '2', reply_ts: 200, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply2);

      const session = await service.getSession(realUserId, channelId, threadTs);
      const response = await service.getClarificationResponse(session!, reply2, ['hr-leave-request:create_leave']);

      expect(response.action).toBe('escalate');
      expect(response.escalation_text).toBeDefined();
    });

    it('should return clarify action with choice confirmation for choice selection', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const reply: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      const session = await service.getSession(realUserId, channelId, threadTs);
      const response = await service.getClarificationResponse(session!, reply, ['hr-leave-request:create_leave']);

      expect(response.action).toBe('clarify');
      expect(response.reply_text).toBeDefined();
      expect(response.choices).toEqual(['hr-leave-request:create_leave']);
    });

    it('should return clarify action with detail confirmation for detail-adding reply', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const reply: any = {
        reply_text: 'but I need it for tomorrow',
        reply_ts: 100,
        reevaluates_original: true,
      };
      const session = await service.getSession(realUserId, channelId, threadTs);
      const response = await service.getClarificationResponse(session!, reply, ['hr-leave-request:create_leave']);

      expect(response.action).toBe('clarify');
      expect(response.reply_text).toBeDefined();
      expect(response.choices).toEqual(['hr-leave-request:create_leave']);
    });

    it('should limit choices to MAX_DISPLAYED_CHOICES (3)', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['app1', 'app2', 'app3', 'app4', 'app5'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const reply: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      const session = await service.getSession(realUserId, channelId, threadTs);
      const response = await service.getClarificationResponse(session!, reply, ['app1', 'app2', 'app3', 'app4', 'app5']);

      expect(response.choices).toHaveLength(3);
      expect(response.choices).toEqual(['app1', 'app2', 'app3']);
    });
  });

  describe('invalidateSession', () => {
    it('should delete a clarification session', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      await service.invalidateSession(realUserId, channelId, threadTs);

      const session = await service.getSession(realUserId, channelId, threadTs);
      expect(session).toBeNull();
    });
  });

  describe('getEscalationText', () => {
    it('should return English escalation text by default', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const reply1: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply1);

      const reply2: any = { reply_text: '2', reply_ts: 200, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply2);

      const session = await service.getSession(realUserId, channelId, threadTs);
      const response = await service.getClarificationResponse(session!, reply2, ['hr-leave-request:create_leave']);

      expect(response.action).toBe('escalate');
      expect(response.escalation_text).toContain('/leave request');
    });

    it('should return Vietnamese escalation text for locale:vi', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'Tôi muốn xin nghỉ phép';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'vi';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const reply1: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply1);

      const reply2: any = { reply_text: '2', reply_ts: 200, reevaluates_original: false };
      await service.addReply(realUserId, channelId, threadTs, reply2);

      const session = await service.getSession(realUserId, channelId, threadTs);
      const response = await service.getClarificationResponse(session!, reply2, ['hr-leave-request:create_leave']);

      expect(response.action).toBe('escalate');
      expect(response.escalation_text).toContain('/xin nghỉ phép');
    });
  });

  describe('getChoiceConfirmationText', () => {
    it('should return English confirmation text by default', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);
      const reply: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      const response = await service.getClarificationResponse(session!, reply, ['hr-leave-request:create_leave']);

      expect(response.reply_text).toContain("I'm processing");
    });

    it('should return Vietnamese confirmation text for locale:vi', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'Tôi muốn xin nghỉ phép';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'vi';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);
      const reply: any = { reply_text: '1', reply_ts: 100, reevaluates_original: false };
      const response = await service.getClarificationResponse(session!, reply, ['hr-leave-request:create_leave']);

      expect(response.reply_text).toContain("Tôi đang xử lý");
    });
  });

  describe('getDetailConfirmationText', () => {
    it('should return English detail confirmation text by default', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'I want to request leave';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'en';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);
      const reply: any = {
        reply_text: 'but I need it for tomorrow',
        reply_ts: 100,
        reevaluates_original: true,
      };
      const response = await service.getClarificationResponse(session!, reply, ['hr-leave-request:create_leave']);

      expect(response.reply_text).toContain("re-evaluating");
    });

    it('should return Vietnamese detail confirmation text for locale:vi', async () => {
      const realUserId = 'user-123';
      const channelId = 'C123';
      const threadTs = '123.456';
      const originalQuestion = 'Tôi muốn xin nghỉ phép';
      const displayedChoiceIds = ['hr-leave-request:create_leave'];
      const locale = 'vi';

      await service.createSession(realUserId, channelId, threadTs, originalQuestion, displayedChoiceIds, locale);

      const session = await service.getSession(realUserId, channelId, threadTs);
      const reply: any = {
        reply_text: 'nhưng tôi cần nó vào ngày mai',
        reply_ts: 100,
        reevaluates_original: true,
      };
      const response = await service.getClarificationResponse(session!, reply, ['hr-leave-request:create_leave']);

      expect(response.reply_text).toContain("Tôi đang đánh giá lại");
    });
  });
});
