import { Module } from '@nestjs/common';
import { MongoModule, MongoService } from '@akane/platform';

import { DslService } from '../dsl/dsl.service.js';
import { SubmissionRepository } from '../submissions/submission.repository.js';
import { SubmissionRevisionsRepository } from '../submissions/data-access/submission-revisions.repository.js';
import { IdentityMappingRepository } from '../identity/identity-mapping.repository.js';
import { LinkIssuerService } from '../links/link-issuer.service.js';
import { ConversationReferenceRepository } from './data-access/conversation-reference.repository.js';
import { NotificationAssemblerService } from './notification-assembler.service.js';

@Module({
  imports: [MongoModule],
  providers: [
    DslService,
    IdentityMappingRepository,
    LinkIssuerService,
    {
      provide: SubmissionRepository,
      useFactory: (dsl: DslService): SubmissionRepository => new SubmissionRepository(dsl),
      inject: [DslService],
    },
    {
      provide: SubmissionRevisionsRepository,
      useFactory: (mongo: MongoService): SubmissionRevisionsRepository =>
        new SubmissionRevisionsRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: ConversationReferenceRepository,
      useFactory: (mongo: MongoService): ConversationReferenceRepository =>
        new ConversationReferenceRepository(mongo),
      inject: [MongoService],
    },
    {
      provide: NotificationAssemblerService,
      useFactory: (
        revisions: SubmissionRevisionsRepository,
        submissions: SubmissionRepository,
        identity: IdentityMappingRepository,
        linkIssuer: LinkIssuerService,
      ): NotificationAssemblerService =>
        new NotificationAssemblerService(revisions, submissions, identity, linkIssuer),
      inject: [
        SubmissionRevisionsRepository,
        SubmissionRepository,
        IdentityMappingRepository,
        LinkIssuerService,
      ],
    },
  ],
  exports: [
    NotificationAssemblerService,
    ConversationReferenceRepository,
    SubmissionRevisionsRepository,
    SubmissionRepository,
    IdentityMappingRepository,
    LinkIssuerService,
  ],
})
export class NotificationsModule {}