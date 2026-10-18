import { Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  AppDefinitionRepository,
  IdentityMappingRepository,
  IdentityService,
  LinkIssuerService,
  OtpOnboardingService,
  OtpStateMachine,
  PublishedAppLoader,
  ProviderHealthService,
  ProviderRegistry,
  RoutingOrchestrator,
  RoutingOutcomeRepository,
  RuleBasedProvider,
  ClarificationSessionService,
  publishedAppFromDefinition,
  type OtpDeliveryPort,
} from '@akane/domain';
import { MongoModule, MongoService, REDIS_CACHE } from '@akane/platform';
import { InboundEventProcessor } from './processors/inbound-event.processor.js';
import { OtpDeliveryService } from './processors/otp-delivery.service.js';

/**
 * Composition of the inbound routing path. The in-memory catalogue/authorize
 * seams are wired with the seeded demo apps here; 03-02 replaces them with the
 * real per-app RBAC list and RTE-09 cache wiring. Slash commands never reach
 * any of the decision providers (RTE-02).
 */
@Module({
  imports: [MongoModule],
  providers: [
    IdentityMappingRepository,
    IdentityService,
    LinkIssuerService,
    {
      // OBS-05: the routing-outcome store the
      // inbound processor records applied link
      // routings into — the substrate the
      // routing_share gauge and the publish
      // gate's dry-run baseline read.
      provide: RoutingOutcomeRepository,
      inject: [MongoService],
      useFactory: (mongo: MongoService): RoutingOutcomeRepository =>
        new RoutingOutcomeRepository(mongo),
    },
    {
      provide: PublishedAppLoader,
      inject: [MongoService],
      useFactory: async (mongo: MongoService) => {
        const defs = new AppDefinitionRepository(mongo);
        const published = await defs.listPublished();
        const catalog = published.map(publishedAppFromDefinition);
        const authorize = async (appId: string, realUserId: string): Promise<boolean> => {
          const def = await defs.findByAppId(appId);
          if (def === null || def.lifecycle !== 'published') return false;
          if (def.createdBy === realUserId) return true;
          const ra = def.role_assignments;
          if (ra === null || ra === undefined) return true;
          if (typeof ra !== 'object') return false;
          for (const [key, value] of Object.entries(ra as Record<string, unknown>)) {
            if (key === realUserId) return true;
            if (Array.isArray(value) && value.includes(realUserId)) return true;
          }
          return false;
        };
        return new PublishedAppLoader(catalog, authorize);
      },
    },
    {
      provide: RuleBasedProvider,
      inject: [MongoService],
      useFactory: async (mongo: MongoService) => {
        const defs = new AppDefinitionRepository(mongo);
        const published = await defs.listPublished();
        const map = new Map<string, string[]>();
        for (const def of published) {
          const app = publishedAppFromDefinition(def);
          for (const form of app.forms) {
            map.set(
              `${def.app_id}:${form.form_id}`,
              [...form.intents, ...form.aliases],
            );
          }
        }
        return new RuleBasedProvider(map);
      },
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
    // IDN-05 — the OTP self-onboarding wiring. The
    // state machine shares the cache connection
    // (one ioredis client across BullMQ, sessions
    // and OTP state, STACK §4.4); the delivery
    // port is the chat-pipeline seam the live
    // Slack leg plugs into (the manual-verify
    // item in 06-VALIDATION.md).
    {
      provide: OtpStateMachine,
      inject: [REDIS_CACHE],
      useFactory: (redis: import('ioredis').Redis) => new OtpStateMachine(redis),
    },
    {
      provide: 'OTP_DELIVERY_PORT',
      useFactory: (): OtpDeliveryPort => new OtpDeliveryService(),
    },
    {
      provide: OtpOnboardingService,
      inject: [
        OtpStateMachine,
        IdentityMappingRepository,
        { token: 'OTP_DELIVERY_PORT', optional: false },
      ],
      useFactory: (
        stateMachine: OtpStateMachine,
        mappings: IdentityMappingRepository,
        delivery: OtpDeliveryPort,
      ): OtpOnboardingService =>
        new OtpOnboardingService(stateMachine, mappings, delivery),
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
