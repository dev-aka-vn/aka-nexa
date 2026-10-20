import {
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseFilters,
} from '@nestjs/common';

import type { Request } from 'express';

import {
  AppDefinitionService,
  AuditRepository,
  BuilderError,
  PUBLISH_SHARE_DROP_THRESHOLD_POINTS,
  PublishGateService,
  type AppDefinitionDocument,
  type PublishGateResult,
} from '@akane/domain';

import { BuilderExceptionFilter, errorBody } from './app-builder.controller.js';

/**
 * The publish endpoint (APP-07, APP-08, BLD-06).
 *
 * The gate runs **before any state change**: the
 * dry-run executes the real routing machinery
 * read-only, and `commitPublish` is called only
 * when the gate allows the publish (T-06-19). The
 * refusal is inline and specific — it names the
 * affected app and the share delta, or the
 * colliding app (BLD-07).
 *
 * Owner-scoped via the session's realUserId: a
 * non-owner's publish is a 404 that leaks
 * nothing about the app's existence.
 */
@Controller()
@UseFilters(new BuilderExceptionFilter())
export class PublishController {
  constructor(
    private readonly definitions: AppDefinitionService,
    private readonly gate: PublishGateService,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * Publish one draft. The confirmation payload
   * carries the BLD-06 change summary — the same
   * rows the admin saw are the rows the AUD-01
   * entry retains.
   */
  @Post('apps/:id/publish')
  @HttpCode(200)
  async publish(
    @Param('id') appId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const actor = actorOf(req);
    const definition = await this.definitions.findByAppId(appId);
    if (definition === null || definition.createdBy !== actor) {
      throw new NotFoundException(
        errorBody('APP_NOT_FOUND', `app not found: ${appId}`),
      );
    }

    // The gate: read-only, before any state change.
    const result = await this.gate.evaluate(appId, actor);
    if (!result.allowed) {
      const formReason = formRuleRefusalMessage(definition);
      throw new BuilderError(
        'PUBLISH_REFUSED',
        formReason ?? refusalMessage(result),
      );
    }

    // BLD-06 boundary: an already-published app is a
    // zero-change publish — a legitimate audited
    // event with no state to commit. The version
    // does not move and the summary is empty, named
    // inline, never a generic confirmation.
    if (definition.lifecycle === 'published') {
      await this.audit.append({
        timestamp: new Date(),
        actor,
        action: 'app.published',
        target: appId,
        previous_state: 'published',
        new_state: 'published',
        changeSummary: [],
        zero_change: true,
      });
      return {
        ...toDefinitionResponse(definition),
        changeSummary: [],
        zero_change: true,
      };
    }

    const published = await this.definitions.commitPublish(
      appId,
      actor,
      result,
    );
    return {
      ...toDefinitionResponse(published),
      changeSummary: result.changeSummary,
      zero_change: false,
    };
  }
}

/** Form-set refusal reasons (D-05, APP-12/SC#2, D-08, FRM-14). */
function formRuleRefusalMessage(
  definition: AppDefinitionDocument,
): string | null {
  const forms = definition.forms ?? [];
  if (!forms.some((f) => f.kind === 'submit')) {
    return 'publish refused: app requires at least one submit form';
  }
  if (
    forms.some(
      (f) =>
        (f.kind === 'show' || f.kind === 'edit') && f.triggers !== null,
    )
  ) {
    return 'publish refused: a show or edit form cannot carry a trigger';
  }
  for (const form of forms) {
    if (form.kind === 'list') {
      const cfg = form.config as { query_id?: unknown; columns?: unknown };
      if (
        typeof cfg?.query_id !== 'string' ||
        (cfg.query_id as string).length === 0
      ) {
        return 'publish refused: list form requires query_id';
      }
      if (!Array.isArray(cfg.columns) || cfg.columns.length === 0) {
        return 'publish refused: list form requires columns';
      }
    }
    if (form.kind === 'show') {
      const cfg = form.config as { fields?: unknown };
      if (!Array.isArray(cfg?.fields) || cfg.fields.length === 0) {
        return 'publish refused: show form requires fields';
      }
    }
  }
  // trigger uniqueness
  const counts = new Map<string, number>();
  for (const form of forms) {
    const trigger = form.triggers as Record<string, unknown> | null;
    if (trigger === null || trigger === undefined) continue;
    const declared = [
      ...(Array.isArray(trigger['intents']) ? trigger['intents'] : []),
      ...(Array.isArray(trigger['aliases']) ? trigger['aliases'] : []),
    ].filter((l): l is string => typeof l === 'string' && l.length > 0);
    // Dedupe per form (a single form listing the same label in
    // both intents and aliases is one resolution, not a collision).
    const uniqueDeclared = [...new Set(declared)];
    const labels =
      uniqueDeclared.length > 0
        ? uniqueDeclared
        : (['id', 'command'] as const)
            .map((k) => trigger[k])
            .filter((v): v is string => typeof v === 'string' && v.length > 0);
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  if ([...counts.values()].some((c) => c > 1)) {
    return 'Publish blocked: a trigger resolves to more than one form. Each trigger activates exactly one form. Edit the trigger and publish again.';
  }
  return null;
}

/** The inline refusal: the named party and the named delta. */
function refusalMessage(result: PublishGateResult): string {
  if (result.descriptionCollisionWith !== null) {
    return `publish refused: description collides with published app ${result.descriptionCollisionWith}`;
  }
  const worst = [...result.shareDrops].sort(
    (a, b) => b.points - a.points,
  )[0];
  if (worst !== undefined) {
    return `publish refused: app ${worst.app_id} routing share drops ${worst.points} points (maximum ${PUBLISH_SHARE_DROP_THRESHOLD_POINTS})`;
  }
  return 'publish refused: routing share drop exceeds the threshold';
}

/** The authenticated builder admin's identity (D-104). */
function actorOf(req: Request): string {
  const user = (req as Request & { user?: { realUserId?: string } }).user;
  return user?.realUserId ?? 'anonymous';
}

/** The served projection: the definition minus Mongo's `_id`. */
function toDefinitionResponse(doc: AppDefinitionDocument): Record<string, unknown> {
  const { _id, ...definition } = doc;
  return definition;
}
