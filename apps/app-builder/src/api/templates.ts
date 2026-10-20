/**
 * The template gallery contract (D-105,
 * D-107, APP-09).
 *
 * The curated tag vocabulary is **frozen
 * server-side** (`packages/domain`
 * `tag-set.ts`, D-107). The SPA carries the
 * same frozen set structurally — the SPA
 * compiles against structural schemas and
 * never imports `@akane/domain` (the
 * browser bundle must not carry the Mongo
 * driver the domain package reaches for).
 * If the vocabulary changes, it changes in
 * `tag-set.ts` first; this copy follows.
 *
 * The served record is the template seed
 * plus the loader's own fields (the content
 * hash, the platform ownership marker, the
 * load timestamp in its ISO wire form).
 */

/**
 * The one enumerated tag set — the union of
 * the use-case and department axes. `hr`
 * belongs to both axes; the set carries it
 * once. Mirrors `PLATFORM_TAGS` exactly.
 */
export const PLATFORM_TAGS = [
  'time-off',
  'travel',
  'procurement',
  'assets',
  'hr',
  'it',
  'facilities',
  'expenses',
  'onboarding',
  'external',
  'engineering',
  'operations',
  'finance',
  'sales',
  'all-staff',
] as const;

export type PlatformTag = (typeof PLATFORM_TAGS)[number];

/** How a template's app integrates. */
export type TemplateDataMode = 'internal' | 'external' | 'hybrid';

/**
 * One served template — the gallery card's
 * fields. The seed's `forms`, `roles`, and
 * trigger set ride along in the payload but are
 * not read here (the fork endpoint owns them).
 */
export interface TemplateRecord {
  readonly template_id: string;
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly tags: readonly string[];
  readonly data_mode: TemplateDataMode;
  /** The connector an `external` template integrates through, if any. */
  readonly connector_ref: string | null;
  readonly content_hash: string;
  readonly owner: 'platform';
  /** ISO wire form — the loader's load timestamp. */
  readonly loadedAt: string;
}

/** The gallery response (`GET /templates`). */
export interface TemplatesResponse {
  readonly templates: readonly TemplateRecord[];
}

/**
 * The structural response schema. A
 * malformed payload throws at the boundary;
 * an out-of-vocabulary tag is dropped from
 * the rendered chips rather than rendered
 * (the vocabulary is the contract).
 */
export const TemplatesSchema = {
  parse: (data: unknown): TemplatesResponse => {
    const payload = data as { templates?: unknown };
    if (!Array.isArray(payload.templates)) {
      throw new Error('malformed template gallery');
    }
    return {
      templates: payload.templates.map(
        (record) => {
          const template = record as Partial<TemplateRecord> | null;
          if (
            typeof template !== 'object' ||
            template === null ||
            typeof template.template_id !== 'string' ||
            typeof template.name !== 'string' ||
            typeof template.description !== 'string'
          ) {
            throw new Error('malformed template record');
          }
          return {
            template_id: template.template_id,
            name: template.name,
            description: template.description,
            domain:
              typeof template.domain === 'string'
                ? template.domain
                : '',
            tags: Array.isArray(template.tags)
              ? template.tags.filter(
                  (tag): tag is PlatformTag =>
                    (PLATFORM_TAGS as readonly string[]).includes(
                      tag as PlatformTag,
                    ),
                )
              : [],
            data_mode:
              template.data_mode === 'external' ||
              template.data_mode === 'hybrid'
                ? template.data_mode
                : 'internal',
            connector_ref:
              typeof template.connector_ref === 'string'
                ? template.connector_ref
                : null,
            content_hash:
              typeof template.content_hash === 'string'
                ? template.content_hash
                : '',
            owner: 'platform',
            loadedAt:
              typeof template.loadedAt === 'string'
                ? template.loadedAt
                : '',
          };
        },
      ),
    };
  },
};
