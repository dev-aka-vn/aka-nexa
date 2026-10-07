import { Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  IdentityMappingRepository,
  IdentityService,
  LinkIssuerService,
  PublishedAppLoader,
  ProviderHealthService,
  ProviderRegistry,
  RuleBasedProvider,
  RoutingOrchestrator,
  ClarificationSessionService,
} from '@akane/domain';
import { REDIS_CACHE } from '@akane/platform';
import { InboundEventProcessor } from './processors/inbound-event.processor.js';

/**
 * Composition of the inbound routing path. The in-memory catalogue/authorize
 * seams are wired with the seeded demo apps here; 03-02 replaces them with the
 * real per-app RBAC list and RTE-09 cache wiring. Slash commands never reach
 * any of the decision providers (RTE-02).
 */
@Module({
  providers: [
    IdentityMappingRepository,
    IdentityService,
    LinkIssuerService,
    {
      provide: PublishedAppLoader,
      useFactory: () =>
        new PublishedAppLoader(
          [
            {
              id: 'leave-request',
              description: 'Submit a new leave request',
              parameters: ['start_date', 'end_date', 'leave_type'],
              intents: ['request leave', 'xin nghỉ phép'],
              aliases: ['request leave', 'leave request', 'xin nghỉ phép', 'xin nghi phep'],
              threshold: 0.8,
              status: 'published',
            },
          ],
          async () => true,
        ),
    },
    {
      provide: RuleBasedProvider,
      useFactory: () =>
        new RuleBasedProvider(
          new Map([
            ['leave-request', ['request leave', 'leave request', 'xin nghỉ phép', 'xin nghi phep']],
          ]),
        ),
    },
    {
      provide: ProviderRegistry,
      inject: [RuleBasedProvider],
      useFactory: (rules: RuleBasedProvider) =>
        new ProviderRegistry({ providers: [{ provider: rules }] }),
    },
    {
      provide: ProviderHealthService,
      inject: [ProviderRegistry],
      useFactory: (registry: ProviderRegistry) => new ProviderHealthService(registry.chain()),
    },
    {
      provide: RoutingOrchestrator,
      inject: [ProviderRegistry, ProviderHealthService],
      useFactory: (registry: ProviderRegistry, health: ProviderHealthService) =>
        new RoutingOrchestrator(registry.chain(), { health, attemptCaps: registry.attemptCaps() }),
    },
    {
      provide: ClarificationSessionService,
      inject: [REDIS_CACHE],
      useFactory: (redis: import('ioredis').Redis) =>
        new ClarificationSessionService(redis),
    },
    InboundEventProcessor,
  ],
})
export class WorkerModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly providerHealth: ProviderHealthService) {}

  onApplicationBootstrap(): void {
    this.providerHealth.start();
  }

  onApplicationShutdown(): void {
    this.providerHealth.stop();
  }
}
