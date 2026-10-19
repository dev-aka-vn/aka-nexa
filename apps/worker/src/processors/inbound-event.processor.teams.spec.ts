import { describe, expect, it } from 'vitest';

import { IdentityMappingRepository, IdentityService, LinkIssuerService, OtpOnboardingService, OtpStateMachine, PublishedAppLoader, RuleBasedProvider, RoutingOrchestrator, ClarificationSessionService } from '@akane/domain';
import { Redis } from 'ioredis';

import { InboundEventProcessor } from './inbound-event.processor.js';

// Re-implement minimal fakes locally to avoid importing test helpers.
class FakeRedis {
  private store = new Map<string, string>();
  private ttis = new Map<string, number>();
  async set(key: string, value: string, ...args: unknown[]): Promise<'OK'> {
    this.store.set(key, value);
    if (args[0] === 'PX' && typeof args[1] === 'number') this.ttis.set(key, Date.now() + args[1]);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    const ttl = this.ttis.get(key);
    if (ttl !== undefined && Date.now() > ttl) { this.store.delete(key); this.ttis.delete(key); return null; }
    return this.store.get(key) ?? null;
  }
  async del(key: string): Promise<number> { this.ttis.delete(key); return this.store.delete(key) ? 1 : 0; }
  async pttl(key: string): Promise<number> { const ttl = this.ttis.get(key); if (ttl === undefined) return -1; return Math.max(0, ttl - Date.now()); }
  async quit(): Promise<void> { this.store.clear(); this.ttis.clear(); }
}

const CATALOG: any[] = [
  {
    id: 'leave-request',
    description: 'Submit a new leave request',
    parameters: [],
    intents: ['request leave'],
    aliases: ['request leave', 'leave request'],
    threshold: 0.8,
    status: 'published',
    forms: [{ form_id: 'submit', kind: 'submit', action: 'create', intents: ['request leave'], aliases: ['request leave'], threshold: 0.8, description: 'submit', form_version: 1 }],
  },
];

describe('InboundEventProcessor — teams platform (IM-10)', () => {
  it('routes a Teams InboundEvent through the shared kernel', async () => {
    const repo = new IdentityMappingRepository();
    await repo.upsert({ platform: 'teams', chat_user_id: 'T1', real_user_id: 'usr_teams' });
    const identity = new IdentityService(repo);
    const loader = new PublishedAppLoader(CATALOG, async () => true);
    const provider = new RuleBasedProvider(new Map([['leave-request:submit', ['request leave']]]));
    const orchestrator = new RoutingOrchestrator([provider]);
    const clarification = new ClarificationSessionService(new FakeRedis() as unknown as Redis);
    const onboarding = new OtpOnboardingService(new OtpStateMachine(new FakeRedis() as unknown as Redis), repo, { deliverOtp: async () => {} });
    const routingOutcomes = { record: async () => {}, outcomesForIntent: async () => [], outcomesForApp: async () => [] };
    const processor = new InboundEventProcessor(identity, loader, orchestrator, new LinkIssuerService(), clarification, onboarding, routingOutcomes as any);

    const out = await processor.process({
      data: {
        event_id: 'evt_teams_1',
        platform: 'teams',
        channel_id: 'C_teams',
        chat_user_id: 'T1',
        text: 'I want to request leave',
        action: 'message',
        queue: 'inbound-events',
        attempt: 0,
        occurred_at: new Date().toISOString(),
      },
    } as any);

    expect(out.kind).toBe('link');
    if (out.kind === 'link') {
      expect(out.appId).toBe('leave-request');
    }
  });
});