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
 */

import { Module } from '@nestjs/common';

import {
  AppDefinitionRepository,
  AppDefinitionService,
  AuditRepository,
  TemplateSeed,
} from '@akane/domain';
import { MongoModule, MongoService } from '@akane/platform';

import { AppBuilderController } from './app-builder.controller.js';

@Module({
  imports: [MongoModule],
  controllers: [AppBuilderController],
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
  ],
})
export class AppBuilderModule {}
