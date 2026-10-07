import { describe, expect, it, vi } from 'vitest';
import {
  IdentityMappingRepository,
  IdentityService,
  LinkIssuerService,
  PublishedAppLoader,
  RuleBasedProvider,
  RoutingOrchestrator,
  type PublishedApp,
} from '@akane/domain';
import type { JevRequest, JevResponse } from '@akane/contract';

import { InboundEventProcessor } from './inbound-event.processor.js';

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
  const processor = new InboundEventProcessor(identity, loader, orchestrator, new LinkIssuerService());
  return { processor, decideSpy };
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
