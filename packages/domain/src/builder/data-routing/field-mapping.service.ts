/**
 * The field-mapping service (BLD-05).
 *
 * The visual mapping's data contract: the
 * form-field → connector-field mapping the App
 * Builder's data-routing tab edits. The mapping
 * is stored on the app definition's
 * `field-mapping` section — the same section
 * the connector-request flow's `mapping` shape
 * feeds — and every store is an **audited
 * transition** (D-86).
 *
 * ## The rules
 *
 * 1. **Owner-scoped, fail-closed** (D-97): an
 *    actor who does not own the app gets the
 *    same `APP_NOT_FOUND` refusal as a missing
 *    app — never a 403 that would leak the
 *    app's existence.
 * 2. **Zod-validated** against the contract:
 *    a string→string record, `.strict()` so a
 *    smuggled key or a non-string value is
 *    refused inline with the field named
 *    (BLD-07).
 * 3. **Round-trips through the definition**: the
 *    store lands on the version-bumped section
 *    patch (APP-03), and the read serves exactly
 *    what was stored.
 */

import { z } from 'zod';

import { FieldMappingPutSchema } from '@akane/contract';

import {
  AppNotFoundError,
  type AppDefinitionDocument,
  type AppDefinitionRepository,
} from '../data-access/app-definition.repository.js';
import { AuditRepository, type AuditEntry } from '../../audit/audit.repository.js';

/** A Zod validation failure, carried inline with the offending fields (BLD-07). */
export class FieldMappingValidationError extends Error {
  constructor(
    public readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(
      issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    );
    this.name = 'FieldMappingValidationError';
  }
}

/** The stored mapping as the routing tab serves it. */
export interface FieldMappingRecord {
  readonly app_id: string;
  readonly field_mapping: Record<string, string>;
  readonly version: number;
}

export class FieldMappingService {
  constructor(
    private readonly definitions: AppDefinitionRepository,
    private readonly audit: AuditRepository,
  ) {}

  /**
   * The routing tab's read: the app's stored
   * mapping, or an empty mapping for an app that
   * never stored one. Owner-scoped, fail-closed.
   */
  async getMapping(
    appId: string,
    actor: string,
  ): Promise<FieldMappingRecord> {
    const definition = await this.assertOwner(appId, actor);
    return {
      app_id: appId,
      field_mapping:
        (definition.field_mapping as Record<
          string,
          string
        > | null) ?? {},
      version: definition.version,
    };
  }

  /**
   * The routing tab's write: validate, store on
   * the `field-mapping` section (version-bumped,
   * APP-03), and append the `field_mapping.stored`
   * AUD-01 entry with the version transition.
   */
  async storeMapping(
    appId: string,
    actor: string,
    input: unknown,
  ): Promise<FieldMappingRecord> {
    const parsed = FieldMappingPutSchema.safeParse(input);
    if (!parsed.success) {
      throw new FieldMappingValidationError(
        parsed.error.issues,
      );
    }

    // Fail-closed owner-scoping: a non-owner and
    // a missing app are the same refusal.
    await this.assertOwner(appId, actor);

    const before = await this.definitions.findByAppId(appId);
    const updated = await this.definitions.updateSection(
      appId,
      'field-mapping',
      { field_mapping: parsed.data.field_mapping },
    );
    if (updated === null) {
      throw new AppNotFoundError(appId);
    }

    await this.audit.append({
      timestamp: new Date(),
      actor,
      action: 'field_mapping.stored',
      target: appId,
      previous_state: String(before?.version ?? 0),
      new_state: String(updated.version),
      field_count: Object.keys(parsed.data.field_mapping).length,
    } satisfies AuditEntry);

    return {
      app_id: appId,
      field_mapping: parsed.data.field_mapping,
      version: updated.version,
    };
  }

  /** The definition, if the actor owns its app. */
  private async assertOwner(
    appId: string,
    actor: string,
  ): Promise<AppDefinitionDocument> {
    const definition = await this.definitions.findByAppId(appId);
    if (definition === null || definition.createdBy !== actor) {
      throw new AppNotFoundError(appId);
    }
    return definition;
  }
}
