import { Module } from '@nestjs/common';

import { MongoModule, MongoService } from '@akane/platform';
import { AppBuilderModule } from '../app-builder/app-builder.module.js';
import { AuditController } from './audit.controller.js';
import { AppPurgeService, AuditRepository } from '@akane/domain';

@Module({
  imports: [MongoModule, AppBuilderModule],
  controllers: [AuditController],
  providers: [
    {
      provide: AppPurgeService,
      useFactory: (mongo: MongoService, audit: AuditRepository): AppPurgeService =>
        new AppPurgeService(mongo, audit, 30),
      inject: [MongoService, AuditRepository],
    },
  ],
  exports: [AppPurgeService],
})
export class AuditModule {}
