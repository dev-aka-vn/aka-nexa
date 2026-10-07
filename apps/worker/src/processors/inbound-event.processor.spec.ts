import { describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import {
  IdentityMappingRepository,
  IdentityService,
  LinkIssuerService,
  PublishedAppLoader,
  RuleBasedProvider,
  RoutingOrchestrator,
  ClarificationSessionService,
  type PublishedApp,
} from '@akane/domain';
import type { JevRequest, JevResponse } from '@akane/contract';

import { InboundEventProcessor } from './inbound-event.processor.js';

/** Minimal in-memory Redis stand-in for clarification-session specs. */
class FakeRedis {
  private store = new Map<string, string>();
  private ttis = new Map<string, number>();
  async set(key: string, value: string, ...args: unknown[]): Promise<'OK'> {
    this.store.set(key, value);
    if (args[0] === 'PX' && typeof args[1] === 'number') this.ttis.set(key, Date.now() + args[1]);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) { this.store.delete(key); this.ttis.delete(key); return null; }
    return this.store.get(key) ?? null;
  }
  async del(key: string): Promise<number> { this.ttis.delete(key); return this.store.delete(key) ? 1 : 0; }
  async pttl(key: string): Promise<number> {
    if (this.isExpired(key)) { this.store.delete(key); this.ttis.delete(key); return -2; }
    const ttl = this.ttis.get(key); if (ttl === undefined) return -1;
    return Math.max(0, ttl - Date.now());
  }
  async quit(): Promise<void> { this.store.clear(); this.ttis.clear(); }
  private isExpired(key: string): boolean { const ttl = this.ttis.get(key); if (ttl === undefined) return false; return Date.now() > ttl; }
}

const CATALOG: PublishedApp[] = [
  {
    id: 'leave-request',
    description: 'Submit a new leave request',
    parameters: [],
    intents: ['request leave', 'xin nghỉ phép'],
    aliases: ['request leave', 'leave request', 'xin nghỉ phép'],
    threshold: 0.8,
    status: 'published',
  },
  {
    id: 'hr-private',
    description: 'Restricted HR app',
    parameters: [],
    intents: ['fire someone'],
    aliases: ['fire someone'],
    threshold: 0.8,
    status: 'published',
  },
];

async function buildProcessor(opts: {
  authorizeIds?: string[];
  provider?: RuleBasedProvider;
} = {}) {
  const repo = new IdentityMappingRepository();
  await repo.upsert({ platform: 'slack', chat_user_id: 'U1', real_user_id: 'usr_1' });
  const identity = new IdentityService(repo);
  const authorizeIds = new Set(opts.authorizeIds ?? ['leave-request']);
  const loader = new PublishedAppLoader(CATALOG, async (appId) => authorizeIds.has(appId));
  const provider =
    opts.provider ??
    new RuleBasedProvider(new Map(CATALOG.map((a) => [a.id, a.aliases])));
  const decideSpy = vi.spyOn(provider, 'decide');
  const orchestrator = new RoutingOrchestrator([provider]);
  const clarification = new ClarificationSessionService(new FakeRedis() as unknown as Redis);
  const processor = new InboundEventProcessor(identity, loader, orchestrator, new LinkIssuerService(), clarification);
  return { processor, decideSpy, clarification };
}

function event(overrides: Record<string, unknown>) {
  return {
    event_id: 'evt_1',
    platform: 'slack',
    channel_id: 'C1',
    chat_user_id: 'U1',
    text: '',
    action: 'message',
    queue: 'inbound-events',
    attempt: 0,
    occurred_at: new Date().toISOString(),
    ...overrides,
  } as never;
}

describe('InboundEventProcessor — slash vs natural-language parity', () => {
  it('slash command never touches a JevProvider and gets the same link as EN message', async () => {
    const { processor, decideSpy } = await buildProcessor();
    const slash = await processor.process({
      data: event({ action: 'slash_command', text: '/leave request' }),
    } as never);
    expect(slash).toEqual({ kind: 'link', appId: 'leave-request', url: '/l/leave-request?u=usr_1' });
    expect(decideSpy).not.toHaveBeenCalled();

    const message = await processor.process({
      data: event({ text: 'I want to request leave' }),
    } as never);
    expect(message).toEqual({ kind: 'link', appId: 'leave-request', url: '/l/leave-request?u=usr_1' });
    expect(decideSpy).toHaveBeenCalledTimes(1);
  });

  it('a Vietnamese request reaches the same link as the slash command', async () => {
    const { processor } = await buildProcessor();
    const slash = await processor.process({
      data: event({ action: 'slash_command', text: '/leave request' }),
    } as never);
    const message = await processor.process({
      data: event({ text: 'Tôi muốn xin nghỉ phép' }),
    } as never);
    expect(message).toEqual(slash);
  });

  it('the provider payload contains only authorized tools, never the global catalogue', async () => {
    const { processor, decideSpy } = await buildProcessor({ authorizeIds: ['leave-request'] });
    await processor.process({
      data: event({ text: 'I want to request leave' }),
    } as never);
    expect(decideSpy).toHaveBeenCalledTimes(1);
    const req = decideSpy.mock.calls[0][0] as JevRequest;
    expect(req.tools.map((t) => t.id)).toEqual(['leave-request']);
  });

  it('verified:false from the provider never yields a link (D-23 negative path)', async () => {
    const provider = new RuleBasedProvider(new Map());
    vi.spyOn(provider, 'decide').mockImplementation(async (req: JevRequest): Promise<JevResponse> => ({
      spec_version: '1.0',
      request_id: req.request_id,
      choice: { tool_id: 'leave-request', confidence: 0.99, verified: false },
      clarification_needed: false,
      provider: 'rule-based',
      latency_ms: 1,
    }));
    const { processor } = await buildProcessor({ provider });
    const out = await processor.process({
      data: event({ text: 'request leave' }),
    } as never);
    expect(out.kind).toBe('clarify');
  });

  it('a conflicting match clarifies instead of linking', async () => {
    const provider = new RuleBasedProvider(
      new Map([
        ['leave-request', ['request leave']],
        ['hr-private', ['request leave']],
      ]),
    );
    const { processor } = await buildProcessor({
      authorizeIds: ['leave-request', 'hr-private'],
      provider,
    });
    const out = await processor.process({
      data: event({ text: 'request leave' }),
    } as never);
    expect(out.kind).toBe('clarify');
    if (out.kind === 'clarify') {
      expect([...out.toolIds].sort()).toEqual(['hr-private', 'leave-request']);
    }
  });
});

describe('InboundEventProcessor — clarification session wiring', () => {
  it('creates a clarification session when the orchestrator returns clarify with alternatives', async () => {
    const provider = new RuleBasedProvider(
      new Map([
        ['leave-request', ['request leave']],
        ['hr-private', ['request leave']],
      ]),
    );
    const { processor, clarification } = await buildProcessor({
      authorizeIds: ['leave-request', 'hr-private'],
      provider,
    });
    const out = await processor.process({
      data: event({ text: 'request leave' }),
    } as never);
    expect(out.kind).toBe('clarify');
    expect(out.toolIds).toHaveLength(2);

    const session = await clarification.getSession('usr_1', 'C1', 'C1');
    expect(session).not.toBeNull();
    expect(session?.original_question).toBe('request leave');
    expect(session?.displayed_choice_ids).toEqual(['leave-request', 'hr-private']);
    expect(session?.replies_used).toBe(0);
  });

  it('resolves a numeric reply against the displayed choices in the same thread', async () => {
    const provider = new RuleBasedProvider(
      new Map([
        ['leave-request', ['request leave']],
        ['hr-private', ['request leave']],
      ]),
    );
    const { processor } = await buildProcessor({
      authorizeIds: ['leave-request', 'hr-private'],
      provider,
    });
    await processor.process({
      data: event({ text: 'request leave' }),
    } as never);

    const reply = await processor.process({
      data: event({ action: 'interaction', text: '1' }),
    } as never);
    expect(reply.kind).toBe('link');
    if (reply.kind === 'link') {
      expect(reply.appId).toBe('leave-request');
    }
  });

  it('resolves a name reply against the displayed choices in the same thread', async () => {
    const provider = new RuleBasedProvider(
      new Map([
        ['leave-request', ['request leave']],
        ['hr-private', ['request leave']],
      ]),
    );
    const { processor } = await buildProcessor({
      authorizeIds: ['leave-request', 'hr-private'],
      provider,
    });
    await processor.process({
      data: event({ text: 'request leave' }),
    } as never);

    const reply = await processor.process({
      data: event({ action: 'interaction', text: 'leave request' }),
    } as never);
    expect(reply.kind).toBe('link');
    if (reply.kind === 'link') {
      expect(reply.appId).toBe('leave-request');
    }
  });

  it('re-evaluates original + reply as one context for a detail-adding follow-up', async () => {
    const provider = new RuleBasedProvider(
      new Map([['leave-request', ['tomorrow']]]),
    );
    const { processor, decideSpy } = await buildProcessor({ provider });
    // First message creates a clarification session (no match for "I need something").
    await processor.process({
      data: event({ text: 'I need something' }),
    } as never);

    // Detail-adding reply falls through to fresh routing with combined text.
    const reply = await processor.process({
      data: event({ action: 'interaction', text: 'for tomorrow' }),
    } as never);
    expect(reply.kind).toBe('link');
    if (reply.kind === 'link') {
      expect(reply.appId).toBe('leave-request');
    }
    // Provider called twice: once for the first ambiguous message, once for the combined follow-up.
    expect(decideSpy).toHaveBeenCalledTimes(2);
    const req = decideSpy.mock.calls[1][0] as JevRequest;
    expect(req.question).toContain('tomorrow');
  });

  it('escalates after two unsuccessful replies and invalidates the session', async () => {
    const provider = new RuleBasedProvider(
      new Map([
        ['leave-request', ['request leave']],
        ['hr-private', ['request leave']],
      ]),
    );
    const { processor, clarification } = await buildProcessor({
      authorizeIds: ['leave-request', 'hr-private'],
      provider,
    });
    await processor.process({
      data: event({ text: 'request leave' }),
    } as never);

    // First unsuccessful reply.
    const reply1 = await processor.process({
      data: event({ action: 'interaction', text: 'not sure' }),
    } as never);
    expect(reply1.kind).toBe('clarify');

    // Second unsuccessful reply.
    const reply2 = await processor.process({
      data: event({ action: 'interaction', text: 'maybe this' }),
    } as never);
    expect(reply2.kind).toBe('clarify');

    // Third attempt should also clarify (no third round started).
    const reply3 = await processor.process({
      data: event({ action: 'interaction', text: 'help' }),
    } as never);
    expect(reply3.kind).toBe('clarify');

    // Session should be invalidated after escalation.
    const session = await clarification.getSession('usr_1', 'C1', 'C1');
    expect(session).toBeNull();
  });

  it('re-filters revoked apps on every reply (D-50)', async () => {
    const provider = new RuleBasedProvider(
      new Map([
        ['leave-request', ['request leave']],
        ['hr-private', ['request leave']],
      ]),
    );
    const { processor, clarification } = await buildProcessor({
      authorizeIds: ['leave-request', 'hr-private'],
      provider,
    });
    // First message creates the session with both apps displayed.
    await processor.process({
      data: event({ text: 'request leave' }),
    } as never);

    // Revoke hr-private before the reply by building a processor with fewer auths,
    // but sharing the same ClarificationSessionService so the session lookup works.
    const repo2 = new IdentityMappingRepository();
    await repo2.upsert({ platform: 'slack', chat_user_id: 'U1', real_user_id: 'usr_1' });
    const identity2 = new IdentityService(repo2);
    const authorizeIds2 = new Set(['leave-request']);
    const loader2 = new PublishedAppLoader(CATALOG, async (appId) => authorizeIds2.has(appId));
    const orchestrator2 = new RoutingOrchestrator([provider]);
    const processor2 = new InboundEventProcessor(identity2, loader2, orchestrator2, new LinkIssuerService(), clarification);

    const reply = await processor2.process({
      data: event({ action: 'interaction', text: '1' }),
    } as never);
    expect(reply.kind).toBe('link');
    if (reply.kind === 'link') {
      expect(reply.appId).toBe('leave-request');
    }
  });

  it('falls back to fresh routing when no clarification session exists', async () => {
    const { processor, decideSpy } = await buildProcessor();
    const out = await processor.process({
      data: event({ action: 'interaction', text: 'I want to request leave' }),
    } as never);
    expect(out.kind).toBe('link');
    expect(decideSpy).toHaveBeenCalledTimes(1);
  });
});
