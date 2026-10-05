import { describe, expect, it } from 'vitest';

import {
  MAX_READ_LINK_TTL_SECONDS,
  READ_LINK_CLAIMS_VERSION,
  READ_LINK_TTL_EXCEEDS_CEILING,
  ReadLinkActionSchema,
  ReadLinkClaimsSchema,
} from './read-link-claims.js';
import { TOKEN_CLASSES } from './token-classes.js';

/**
 * D-24 again, on the claim set. `.strict()` rejects an **extra** key at
 * runtime; only a test against a literal array catches a key that was
 * **removed** from the schema at author time. Both are here, and they catch
 * opposite failure modes.
 *
 * This is the one-way contract in the phase (D-21): a 90-day link outlives most
 * deploy cycles, so "we'll add the claim later" is not available. `V1` is the
 * version-named constant a deliberate break edits.
 */
const V1 = [
  'action',
  'app_id',
  'app_version',
  'aud',
  'exp',
  'form_id',
  'form_version',
  'iat',
  'iss',
  'jti',
  'nbf',
  'perm_version',
  'query_version',
  'sub',
  'target_id',
] as const;

const DAY = 24 * 60 * 60;
const ISSUED_AT = 1_760_000_000;

const VIEW_LINK = {
  iss: 'dep_vn_01',
  aud: 'https://forms.akane.example',
  sub: 'usr_42',
  jti: 'jti_01',
  iat: ISSUED_AT,
  nbf: ISSUED_AT,
  exp: ISSUED_AT + 90 * DAY,
  action: 'view',
  app_id: 'hr-leave-request',
  form_id: 'leave_form',
  form_version: 3,
  app_version: 7,
  perm_version: 2,
  query_version: 1,
  target_id: 'sub_01',
} as const;

describe('ReadLinkClaimsSchema frozen claim set (LNK-07, D-21, D-24)', () => {
  it('names the claim version 1.0', () => {
    expect(READ_LINK_CLAIMS_VERSION).toBe('1.0');
  });

  it('freezes the top-level key set', () => {
    expect(Object.keys(ReadLinkClaimsSchema.shape).sort()).toEqual([...V1]);
  });

  it('admits exactly the six D-21 actions, including the reserved draft class', () => {
    expect([...ReadLinkActionSchema.options].sort()).toEqual([
      'create',
      'draft',
      'edit',
      'notification',
      'query',
      'view',
    ]);
  });

  it('rejects a claim object carrying an unlisted key rather than stripping it', () => {
    const result = ReadLinkClaimsSchema.safeParse({
      ...VIEW_LINK,
      user_email: 'anna.pino@example.com',
    });

    expect(result.success).toBe(false);
  });

  it('carries no version claim of its own — the version is a code constant plus the published $id', () => {
    // A `v` / `ver` / `claims_version` claim would be the first addition that
    // invalidates every outstanding link, so its absence is asserted by name.
    const claimNames = Object.keys(ReadLinkClaimsSchema.shape);
    const versionShaped = claimNames.filter((name) =>
      /^(v|ver|version|ver_no|schema_version|claims_version)$/.test(name),
    );

    expect(versionShaped).toEqual([]);
  });

  it('carries perm_version as the ACL-07 integer epoch', () => {
    const result = ReadLinkClaimsSchema.safeParse({ ...VIEW_LINK, perm_version: 2 });

    expect(result.success).toBe(true);

    const fractional = ReadLinkClaimsSchema.safeParse({
      ...VIEW_LINK,
      perm_version: 2.5,
    });
    expect(fractional.success).toBe(false);

    const textual = ReadLinkClaimsSchema.safeParse({
      ...VIEW_LINK,
      perm_version: '2',
    });
    expect(textual.success).toBe(false);
  });

  it('makes target_id optional and requires query_version', () => {
    const withoutTarget = { ...VIEW_LINK } as Record<string, unknown>;
    delete withoutTarget.target_id;

    expect(ReadLinkClaimsSchema.safeParse(withoutTarget).success).toBe(true);

    const withoutQueryVersion = { ...VIEW_LINK } as Record<string, unknown>;
    delete withoutQueryVersion.query_version;
    expect(ReadLinkClaimsSchema.safeParse(withoutQueryVersion).success).toBe(false);
  });

  it('refuses a link that outlives the 90-day ceiling', () => {
    expect(ReadLinkClaimsSchema.safeParse(VIEW_LINK).success).toBe(true);

    const tooLong = ReadLinkClaimsSchema.safeParse({
      ...VIEW_LINK,
      exp: ISSUED_AT + MAX_READ_LINK_TTL_SECONDS + 1,
    });

    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues.map((i) => i.message)).toContain(
        READ_LINK_TTL_EXCEEDS_CEILING,
      );
    }
  });
});

describe('TOKEN_CLASSES (D-22 — reserve the shape, do not build the machine)', () => {
  const actions = [...ReadLinkActionSchema.options];

  it('has exactly one row per action, each with ttl and consume', () => {
    expect(Object.keys(TOKEN_CLASSES).sort()).toEqual([...actions].sort());

    for (const action of actions) {
      const row = TOKEN_CLASSES[action];
      expect(row.action).toBe(action);
      expect(typeof row.ttl).toBe('string');
      expect(row.ttl.length).toBeGreaterThan(0);
      expect(typeof row.consume).toBe('boolean');
    }
  });

  it('marks draft present but not emittable in v1', () => {
    expect(TOKEN_CLASSES.draft).toBeDefined();
    expect(TOKEN_CLASSES.draft.emittedInV1).toBe(false);

    const emittable = actions.filter((action) => TOKEN_CLASSES[action].emittedInV1);
    expect(emittable.sort()).toEqual([
      'create',
      'edit',
      'notification',
      'query',
      'view',
    ]);
  });

  it('consumes create and edit tokens, and never consumes a read link', () => {
    expect(TOKEN_CLASSES.create.consume).toBe(true);
    expect(TOKEN_CLASSES.edit.consume).toBe(true);
    expect(TOKEN_CLASSES.view.consume).toBe(false);
    expect(TOKEN_CLASSES.query.consume).toBe(false);
  });
});
