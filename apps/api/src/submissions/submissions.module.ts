/**
 * The submissions module (BLD-08, D-111) — the
 * backend for the self-service App Builder's
 * submissions viewer and its visible-column
 * CSV export.
 *
 * Composed in the factory-provider shape the
 * `app-builder.module.ts` module uses: every
 * provider with dependencies is a **factory
 * provider** with an explicit `inject` list, so
 * the graph is identical under the test runner
 * (which emits no `design:paramtypes` metadata
 * for bare-class providers) and in production.
 *
 * ## The composition
 *
 * The viewer reads through the `ReadModule`
 * providers (`SubmissionRepository` for the
 * in-memory submission store, the
 * `SubmissionRevisionsRepository` for the
 * downstream references) and the
 * `AppBuilderModule` providers
 * (`AppDefinitionRepository` for the
 * fail-closed owner check, `AuditRepository`
 * for the AUD-01 export trail). The export
 * service composes the two: the same filter
 * produces the view's rows and the export's
 * rows, so the row counts agree by
 * construction (D-111).
 */

import { Module } from '@nestjs/common';

import {
  AppDefinitionRepository,
  AuditRepository,
  SubmissionRepository,
  SubmissionRevisionsRepository,
} from '@akane/domain';

import { AppBuilderModule } from '../app-builder/app-builder.module.js';
import { ReadModule } from '../read/read.module.js';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionExportService } from './submission-export.service.js';

@Module({
  imports: [ReadModule, AppBuilderModule],
  controllers: [SubmissionsController],
  providers: [
    {
      // BLD-08: the visible-column export —
      // the viewer's projection, serialized
      // with csv-stringify, every export an
      // audited event.
      provide: SubmissionExportService,
      useFactory: (
        submissions: SubmissionRepository,
        revisions: SubmissionRevisionsRepository,
        audit: AuditRepository,
      ): SubmissionExportService =>
        new SubmissionExportService(
          submissions,
          revisions,
          audit,
        ),
      inject: [
        SubmissionRepository,
        SubmissionRevisionsRepository,
        AuditRepository,
      ],
    },
  ],
})
export class SubmissionsModule {}
