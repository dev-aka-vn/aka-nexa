import { Module } from '@nestjs/common';

import { MongoModule, MongoService } from '@akane/platform';
import { AppBuilderModule } from '../app-builder/app-builder.module.js';
import { AuditController, AccessReviewController } from './audit.controller.js';
import {
  AppPurgeService,
  AuditRepository,
  AuditQueryService,
  AuditExportService,
  AccessReviewService,
} from '@akane/domain';

@Module({
  imports: [MongoModule, AppBuilderModule],
  controllers: [AuditController, AccessReviewController],
  providers: [
    {
      provide: AuditQueryService,
      useFactory: (audit: AuditRepository) => new AuditQueryService(audit),
      inject: [AuditRepository],
    },
    {
      provide: AuditExportService,
      useFactory: (audit: AuditRepository, query: AuditQueryService) =>
        new AuditExportService(audit, query),
      inject: [AuditRepository, AuditQueryService],
    },
    {
      provide: AccessReviewService,
      useFactory: (mongo: MongoService, audit: AuditRepository) =>
        new AccessReviewService(mongo, audit),
      inject: [MongoService, AuditRepository],
    },
    {
      provide: AppPurgeService,
      useFactory: (mongo: MongoService, audit: AuditRepository): AppPurgeService =>
        new AppPurgeService(mongo, audit, 30),
      inject: [MongoService, AuditRepository],
    },
  ],
  exports: [AuditQueryService, AuditExportService, AccessReviewService, AppPurgeService],
})
export class AuditModule {}
