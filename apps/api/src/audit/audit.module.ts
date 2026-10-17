/**
 * The audit module (AUD-01, D-43, T-06-32) —
 * the backend for the read-only Audit Log
 * surface and the dashboard's recent-activity
 * widget.
 *
 * Owns the browse endpoint only: AUD-01 is
 * append-only by construction (the
 * `AuditRepository` exposes no update or
 * delete path), so the module's controller
 * surface is exactly one `GET /audit` — there
 * is no mutation endpoint to register.
 *
 * Composes the `AppBuilderModule` graph so
 * the {@link AuditRepository} this module's
 * controller reads is the **same process-wide
 * instance** every audited transition (app
 * definition updates, connector-request
 * transitions, ownership transfers) appends
 * to — the SubmissionsModule composes the
 * same provider for its export trail. A second
 * instance would split the log in two, which
 * is the drift this import exists to make
 * impossible.
 */

import { Module } from '@nestjs/common';

import { AppBuilderModule } from '../app-builder/app-builder.module.js';
import { AuditController } from './audit.controller.js';

@Module({
  imports: [AppBuilderModule],
  controllers: [AuditController],
})
export class AuditModule {}
