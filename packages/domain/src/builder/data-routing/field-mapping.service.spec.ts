/**
 * BLD-05 — the field-mapping service.
 *
 * The visual mapping's data contract: the form-field →
 * connector-field mapping the App Builder's data-routing
 * tab edits, stored on the app definition's
 * `field-mapping` section — the same section the
 * connector-request flow's `mapping` shape feeds.
 *
 * ## The rules this spec proves
 *
 * 1. `storeMapping` validates against the Zod contract and
 *    refuses an invalid mapping inline, naming the offending
 *    field (BLD-07).
 * 2. `storeMapping` and `getMapping` are **owner-scoped,
 *    fail-closed**: an actor who does not own the app gets
 *    the same `APP_NOT_FOUND` refusal as a missing app —
 *    never a 403 that would leak the app's existence
 *    (D-97 discipline, applied to BLD-05).
 * 3. `storeMapping` round-trips: the mapping lands on the
 *    definition's `field_mapping` through the version-bumped
 *    `field-mapping` section patch (APP-03), and `getMapping`
 *    serves exactly what was stored.
 * 4. Every store is an **audited transition** (D-86): the
 *    `field_mapping.stored` AUD-01 entry carries the version
 *    transition.
 */

import { describe, expect, it } from 'vitest';

import { FieldMappingPutSchema } from '@akane/contract';
import type { FieldMappingRecord } from '@akane/contract';

import {
  AppNotFoundError,
  applySectionPatch,
  type AppDefinitionDocument,
} from '../data-access/app-definition.repository.js';
import { AuditRepository, type AuditEntry } from '../../audit/audit.repository.js';

import { FieldMappingService } from './field-mapping.service.js';
import { FieldMappingValidationError } from './field-mapping.service.js';

// ─── Doubles ──────────────────────────────────────────────

/**
 * The definition store's surface the service consumes — the
 * real repository's `applySectionPatch` models the write, so
 * the double behaves exactly like the `findOneAndUpdate` path
 * it stands in for.
 */
class FakeDefinitions {
  constructor(
    private readonly docs: AppDefinitionDocument[] = [],
  ) {}

  async findByAppId(
    appId: string,
  ): Promise<AppDefinitionDocument | null> {
    return (
      this.docs.find((doc) => doc.app_id === appId) ?? null
    );
  }

  async updateSection(
    appId: string,
    section: 'field-mapping',
    patch: Record<string, unknown>,
  ): Promise<AppDefinitionDocument | null> {
    const index = this.docs.findIndex((doc) => doc.app_id === appId);
    if (index === -1) {
      return null;
    }
    const current = this.docs[index]!;
    const updated = applySectionPatch(
      current,
      section,
      patch,
      current.version + 1,
    );
    this.docs[index] = updated;
    return updated;
  }
}

/** A definition in the extended builder shape. */
function definition(
  overrides: Partial<AppDefinitionDocument> = {},
): AppDefinitionDocument {
  return {
    app_id: 'leave-request',
    name: 'Leave Request',
    description: 'Request time off',
    data_mode: 'external',
    lifecycle: 'draft',
    version: 1,
    tags: ['time-off', 'all-staff'],
    forms: [
      {
        form_id: 'submit',
        kind: 'submit',
        schema: {},
        form_version: 1,
        triggers: null,
        config: {},
      },
    ],
    roles: {},
    routing_config: null,
    field_mapping: null,
    retention_policy: null,
    deprecation_notice: null,
    lifecycle_prefs: null,
    jev_behavior: null,
    role_assignments: null,
    roles_permissions: null,
    versioning_policy: null,
    metadata: null,
    createdBy: 'user-0001',
    createdAt: new Date('2026-10-12T00:00:00.000Z'),
    ...overrides,
  };
}

/** The form-field → connector-field mapping the routing tab edits. */
const MAPPING: FieldMappingRecord['field_mapping'] = {
  employee_name: 'full_name',
  start_date: 'from',
  end_date: 'to',
  reason: 'description',
};

// ─── The spec ─────────────────────────────────────────────

describe('field mapping (BLD-05)', () => {
  it('stores the mapping on the field-mapping section and round-trips it through getMapping', async () => {
    const definitions = new FakeDefinitions([definition()]);
    const audit = new AuditRepository();
    const service = new FieldMappingService(
      definitions as never,
      audit,
    );

    const stored = await service.storeMapping(
      'leave-request',
      'user-0001',
      { field_mapping: MAPPING },
    );

    expect(stored).toEqual({
      app_id: 'leave-request',
      field_mapping: MAPPING,
      version: 2,
    });

    // The definition itself carries the mapping.
    const doc = await definitions.findByAppId('leave-request');
    expect(doc?.field_mapping).toEqual(MAPPING);

    // And the read serves exactly what was stored.
    const read = await service.getMapping('leave-request', 'user-0001');
    expect(read).toEqual(stored);
  });

  it('serves an empty mapping for an app that never stored one', async () => {
    const definitions = new FakeDefinitions([definition()]);
    const service = new FieldMappingService(
      definitions as never,
      new AuditRepository(),
    );

    const read = await service.getMapping('leave-request', 'user-0001');
    expect(read).toEqual({
      app_id: 'leave-request',
      field_mapping: {},
      version: 1,
    });
  });

  it('is owner-scoped, fail-closed — a non-owner gets the same APP_NOT_FOUND as a missing app', async () => {
    const definitions = new FakeDefinitions([definition()]);
    const service = new FieldMappingService(
      definitions as never,
      new AuditRepository(),
    );

    // PUT: another owner cannot store against this app.
    await expect(
      service.storeMapping(
        'leave-request',
        'user-0002',
        { field_mapping: MAPPING },
      ),
    ).rejects.toThrow(AppNotFoundError);

    // GET: the same fail-closed refusal.
    await expect(
      service.getMapping('leave-request', 'user-0002'),
    ).rejects.toThrow(AppNotFoundError);

    // An unknown app is indistinguishable from a foreign one.
    await expect(
      service.getMapping('no-such-app', 'user-0001'),
    ).rejects.toThrow(AppNotFoundError);
  });

  it('refuses an invalid mapping inline, naming the offending field', async () => {
    const definitions = new FakeDefinitions([definition()]);
    const audit = new AuditRepository();
    const service = new FieldMappingService(
      definitions as never,
      audit,
    );

    // A non-string value (a smuggled nested object) is rejected.
    await expect(
      service.storeMapping('leave-request', 'user-0001', {
        field_mapping: { employee_name: { nested: 'no' } },
      }),
    ).rejects.toThrow(FieldMappingValidationError);

    // The contract's strict shape: an unlisted key is rejected.
    await expect(
      service.storeMapping('leave-request', 'user-0001', {
        field_mapping: MAPPING,
        extra: 'not allowed',
      }),
    ).rejects.toThrow(FieldMappingValidationError);

    // The contract itself proves the shape: a string→string record.
    expect(
      FieldMappingPutSchema.safeParse({ field_mapping: MAPPING }).success,
    ).toBe(true);
    expect(
      FieldMappingPutSchema.safeParse({
        field_mapping: { employee_name: 42 },
      }).success,
    ).toBe(false);

    // Nothing was written and nothing was audited.
    expect((await definitions.findByAppId('leave-request'))?.field_mapping).toBeNull();
    expect(await audit.findAll()).toHaveLength(0);
  });

  it('appends an audited field_mapping.stored AUD-01 entry with the version transition', async () => {
    const definitions = new FakeDefinitions([definition()]);
    const audit = new AuditRepository();
    const service = new FieldMappingService(
      definitions as never,
      audit,
    );

    await service.storeMapping(
      'leave-request',
      'user-0001',
      { field_mapping: MAPPING },
    );

    const entries = (await audit.findAll()) as AuditEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'user-0001',
      action: 'field_mapping.stored',
      target: 'leave-request',
      previous_state: '1',
      new_state: '2',
      field_count: Object.keys(MAPPING).length,
    });
  });
});
