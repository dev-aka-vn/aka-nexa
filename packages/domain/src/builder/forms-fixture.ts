import type { AppFormElement } from '@akane/contract';

/**
 * The tests' form-set fixture (07-VALIDATION Wave 0).
 *
 * One builder, one shape: every gate, loader and migration spec re-bases
 * onto `buildFormsFixture()` so no spec re-spells the `forms[]` element
 * and a shape change moves in one place.
 */

/**
 * A two-form set: a `submit` form carrying a slash/intent trigger and a
 * `list` form carrying a **different** trigger — the minimum set that
 * exercises per-form triggers (D-06/D-07), the per-form `form_version`
 * comparison (D-10) and the same-kind rejection (D-02).
 */
export function buildFormsFixture(): AppFormElement[] {
  return [
    {
      form_id: 'submit',
      kind: 'submit',
      schema: {
        components: [
          { type: 'text', key: 'title', label: 'Title', input: true },
          {
            type: 'textarea',
            key: 'description',
            label: 'Description',
            input: true,
          },
        ],
      },
      form_version: 1,
      triggers: {
        intents: ['create_thing'],
        aliases: ['/thing'],
        threshold: 0.8,
      },
      config: {},
    },
    {
      form_id: 'list',
      kind: 'list',
      schema: {},
      form_version: 1,
      triggers: {
        intents: ['list_things'],
        aliases: ['/things'],
        threshold: 0.8,
      },
      config: { query_id: 'things', columns: ['title'] },
    },
  ];
}

/**
 * The retired stored shape (D-11) — the app-level `form_schema` plus the
 * flat `triggers` array, as written by every pre-D-09 phase. 07-04's
 * migration spec is the only consumer: it feeds this document into the
 * migrator and asserts the `forms[]` result.
 */
export interface LegacyShapeDocument {
  readonly app_id: string;
  readonly name: string;
  readonly description: string;
  readonly data_mode: string;
  readonly lifecycle: string;
  readonly version: number;
  readonly tags: readonly string[];
  readonly form_schema: Record<string, unknown> | null;
  readonly triggers: readonly Record<string, unknown>[];
  readonly roles: Record<string, unknown>;
  readonly routing_config: Record<string, unknown> | null;
  readonly field_mapping: Record<string, unknown> | null;
  readonly retention_policy: Record<string, unknown> | null;
  readonly deprecation_notice: string | null;
  readonly lifecycle_prefs: Record<string, unknown> | null;
  readonly jev_behavior: Record<string, unknown> | null;
  readonly role_assignments: Record<string, unknown> | null;
  readonly roles_permissions: Record<string, unknown> | null;
  readonly versioning_policy: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/** Build the retired `form_schema` + app-level `triggers` document (D-11). */
export function buildLegacyShapeDocument(
  appId = 'test-app',
): LegacyShapeDocument {
  return {
    app_id: appId,
    name: 'Test App',
    description: 'Test',
    data_mode: 'internal',
    lifecycle: 'draft',
    version: 1,
    tags: [],
    form_schema: {
      components: [
        { type: 'text', key: 'title', label: 'Title', input: true },
      ],
    },
    triggers: [
      {
        id: 'thing',
        type: 'slash',
        command: '/thing',
        description: 'Create thing',
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
    createdBy: 'test',
    createdAt: new Date(),
  };
}
