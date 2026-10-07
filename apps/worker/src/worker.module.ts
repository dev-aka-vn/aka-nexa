import { Module } from '@nestjs/common';
import {
  IdentityMappingRepository,
  IdentityService,
  LinkIssuerService,
  PublishedAppLoader,
  RuleBasedProvider,
  RoutingOrchestrator,
} from '@akane/domain';
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
      provide: RoutingOrchestrator,
      inject: [RuleBasedProvider],
      useFactory: (rules: RuleBasedProvider) => new RoutingOrchestrator([rules]),
    },
    InboundEventProcessor,
  ],
})
export class WorkerModule {}
