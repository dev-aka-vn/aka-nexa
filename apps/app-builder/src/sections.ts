/**
 * The shared section vocabulary (BLD-02, BLD-03).
 *
 * The twelve contract sections (SectionNameSchema) are
 * the editor's tabs and the permission matrix's rows.
 * This module is the single place both surfaces read the
 * vocabulary from, with the human labels the mockup's
 * app-detail chrome uses.
 */

import { SectionNameSchema } from '@akane/contract';

import type { AppDefinition } from './api/definition.js';

/** The twelve app sections, in contract order. */
export const APP_SECTIONS = SectionNameSchema
  .options as readonly string[];

export type AppSection = (typeof APP_SECTIONS)[number];

/** The section tab labels (the mockup's vocabulary). */
const SECTION_LABELS: Readonly<Record<AppSection, string>> = {
  general: 'General',
  metadata: 'Metadata',
  triggers: 'Triggers',
  'jev-behavior': 'JEV behavior',
  'role-assignments': 'Role assignments',
  'roles-permissions': 'Roles & permissions',
  forms: 'Forms',
  versioning: 'Versioning',
  'data-routing': 'Data routing',
  'field-mapping': 'Field mapping',
  lifecycle: 'Lifecycle state',
  retention: 'Retention policy',
  'deprecation-notice': 'Deprecation notice',
};

/** The human label for a section (the tab text). */
export function sectionLabel(section: string): string {
  return SECTION_LABELS[section as AppSection] ?? section;
}

/**
 * The definition document field each section's patch
 * carries (the repository's section-field mapping —
 * one section owns one field, except `general` and
 * `metadata`, which own two each).
 */
export const SECTION_FIELDS: Readonly<
  Record<AppSection, readonly string[]>
> = {
  general: ['name', 'description'],
  metadata: ['tags', 'data_mode'],
  triggers: ['triggers'],
  'jev-behavior': ['jev_behavior'],
  'role-assignments': ['role_assignments'],
  'roles-permissions': ['roles_permissions'],
  forms: ['form_schema'],
  versioning: ['versioning_policy'],
  'data-routing': ['routing_config'],
  'field-mapping': ['field_mapping'],
  lifecycle: ['lifecycle_prefs'],
  retention: ['retention_policy'],
  'deprecation-notice': ['deprecation_notice'],
};

/** The current value of a section, read off the definition. */
export function sectionValue(
  section: AppSection,
  definition: AppDefinition,
): unknown {
  const fields = SECTION_FIELDS[section];
  if (fields.length === 1) {
    return definition[fields[0] as keyof AppDefinition];
  }
  // Multi-field sections (general, metadata) edit as
  // their own controls, not as JSON.
  return null;
}

/** Build a section patch from a parsed JSON payload. */
export function sectionPatch(
  section: AppSection,
  payload: unknown,
): Record<string, unknown> {
  const [field] = SECTION_FIELDS[section];
  return { [field]: payload };
}
