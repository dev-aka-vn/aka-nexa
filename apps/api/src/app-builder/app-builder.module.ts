/**
 * The app-builder module (BLD-02) — the backend for the
 * self-service App Builder's definition surfaces.
 *
 * Composed in the `read.module.ts` factory-provider
 * shape: every provider with dependencies is a
 * **factory provider** with an explicit `inject`
 * list. The explicit form is not just the
 * module-wiring guard's assertion target — under
 * vitest the esbuild transform does not emit
 * `design:paramtypes` decorator metadata, so a
 * bare-class provider's constructor injection
 * resolves to `undefined` and the handler 500s.
 * Explicit tokens make the graph identical in
 * the test runner and in production.
 *
 * The audit repository is dependency-free (it
 * reads the `MongoService` lazily through the
 * platform barrel), so it stays a class
 * provider; the definition repository takes the
 * `MongoService` `MongoModule` exports, the
 * audit log is the process-wide append-only
 * AUD-01 store every audited transition (D-86)
 * appends to, and the template gallery owns the
 * platform `templates` collection — its fork
 * writes through the definition repository so
 * the draft lands in the same `apps`
 * collection with the same guards.
 *
 * The publish gate (APP-07, APP-08) wires the
 * real routing chain the live router uses —
 * `RuleBasedProvider` → `ProviderRegistry` →
 * `ProviderHealthService` → `RoutingOrchestrator`
 * — over the published set the definition
 * repository serves, so the gate's dry-run is
 * the live router's own computation (Pitfall 8),
 * never a second implementation.
 */

import { Module } from '@nestjs/common';

import {
  AppDefinitionRepository,
  AppDefinitionService,
  AuditRepository,
  PublishGateService,
  ProviderHealthService,
  ProviderRegistry,
  declaredLabels,
  publishedAppFromDefinition,
  RoutingOrchestrator,
  RoutingOutcomeRepository,
  RoutingShareComputer,
  RuleBasedProvider,
  TemplateSeed,
} from '@akane/domain';
import { MongoModule, MongoService } from '@akane/platform';

import { AppBuilderController } from './app-builder.controller.js';
import { PublishController } from './publish.controller.js';

@Module({
  imports: [MongoModule],
  controllers: [AppBuilderController, PublishController],
  providers: [
    AuditRepository,
    {
      provide: AppDefinitionRepository,
      useFactory: (mongo: MongoService): AppDefinitionRepository =>
        new AppDefinitionRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: TemplateSeed,
      useFactory: (
        mongo: MongoService,
        definitions: AppDefinitionRepository,
        audit: AuditRepository,
      ): TemplateSeed => new TemplateSeed(mongo, definitions, audit),
      inject: [MongoService, AppDefinitionRepository, AuditRepository],
    },
    {
      provide: AppDefinitionService,
      useFactory: (
        repository: AppDefinitionRepository,
        audit: AuditRepository,
      ): AppDefinitionService =>
        new AppDefinitionService(repository, audit),
      inject: [AppDefinitionRepository, AuditRepository],
    },
    {
      // OBS-05: the routing-outcome store the
      // publish gate's baseline and the
      // routing_share gauge both read.
      provide: RoutingOutcomeRepository,
      useFactory: (mongo: MongoService): RoutingOutcomeRepository =>
        new RoutingOutcomeRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: RoutingShareComputer,
      useFactory: (
        outcomes: RoutingOutcomeRepository,
        definitions: AppDefinitionRepository,
      ): RoutingShareComputer =>
        new RoutingShareComputer(outcomes, async () =>
          (await definitions.listPublished()).map(
            publishedAppFromDefinition,
          ),
        ),
      inject: [RoutingOutcomeRepository, AppDefinitionRepository],
    },
    {
      // The rule-based provider's alias map is the
      // published set at boot — the same static-
      // catalog shape the live router's composition
      // root wires. The gate's arithmetic is
      // catalog-independent (a label the candidate
      // shares with an existing app always
      // abstains), so a boot-time snapshot is the
      // honest wiring, not a stale-read defect.
      provide: RuleBasedProvider,
      inject: [AppDefinitionRepository],
      useFactory: async (
        definitions: AppDefinitionRepository,
      ): Promise<RuleBasedProvider> => {
        try {
          const published = await definitions.listPublished();
          const aliases = new Map<string, string[]>();
          for (const definition of published) {
            aliases.set(definition.app_id, declaredLabels(definition));
          }
          return new RuleBasedProvider(aliases);
        } catch {
          // The routing distribution is empty until
          // the first catalog read succeeds.
          return new RuleBasedProvider(new Map());
        }
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
      useFactory: (registry: ProviderRegistry) =>
        new ProviderHealthService(registry.chain()),
    },
    {
      provide: RoutingOrchestrator,
      inject: [ProviderRegistry, ProviderHealthService],
      useFactory: (
        registry: ProviderRegistry,
        health: ProviderHealthService,
      ) =>
        new RoutingOrchestrator(registry.chain(), {
          health,
          attemptCaps: registry.attemptCaps(),
        }),
    },
    {
      provide: PublishGateService,
      inject: [
        RoutingOrchestrator,
        RoutingOutcomeRepository,
        AppDefinitionRepository,
      ],
      useFactory: (
        orchestrator: RoutingOrchestrator,
        outcomes: RoutingOutcomeRepository,
        definitions: AppDefinitionRepository,
      ): PublishGateService =>
        new PublishGateService(orchestrator, outcomes, definitions),
    },
  ],
})
export class AppBuilderModule {}
