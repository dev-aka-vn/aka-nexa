/**
 * The identity-directory search contract (ACL-02).
 *
 * The role-assignment autocomplete queries the directory
 * by name or email **prefix** and resolves matches to
 * `real_user_id` — the only assignment target the
 * platform supports. The response contract structurally
 * cannot carry a group or attribute target: `users` is
 * the only collection in it, and every entry is a user
 * record (ACL-02's "never offers a group or attribute
 * target" is enforced by the schema, not by a filter).
 *
 * The endpoint is served by the API (plan 06-08 adds
 * `GET /users/search`); the SPA compiles against the
 * contract and the specs stub it.
 */

/** A directory user, resolved to its opaque real_user_id. */
export interface DirectoryUser {
  readonly real_user_id: string;
  readonly name: string;
  readonly email: string;
}

/** The search response (`GET /users/search?q=<prefix>`). */
export interface UsersSearchResponse {
  readonly users: readonly DirectoryUser[];
}

/**
 * The structural response schema. A malformed payload
 * throws at the boundary — an unvalidated entry never
 * reaches the autocomplete (BLD-07's discipline).
 */
export const UsersSearchSchema = {
  parse: (data: unknown): UsersSearchResponse => {
    const payload = data as { users?: unknown };
    if (!Array.isArray(payload.users)) {
      throw new Error('malformed user search response');
    }
    const users = payload.users.map((entry) => {
      const user = entry as Partial<DirectoryUser>;
      if (
        typeof user?.real_user_id !== 'string' ||
        typeof user?.name !== 'string' ||
        typeof user?.email !== 'string'
      ) {
        throw new Error('malformed user search entry');
      }
      return {
        real_user_id: user.real_user_id,
        name: user.name,
        email: user.email,
      };
    });
    return { users };
  },
};

// ─── The IDN-08 SSO mapping surface (D-110) ───────────

/**
 * One SSO identity mapping — the IDN-08
 * record the Users page lists. `platform`
 * is always `oidc`: the mapping surface
 * only ever maps OIDC subjects. Mirrors
 * the `@akane/contract` `SsoMappingSchema`
 * structurally (the SPA compiles against
 * structural schemas, never the contract
 * package's Zod runtime).
 */
export interface SsoMappingView {
  readonly platform: 'oidc';
  readonly oidc_sub: string;
  readonly real_user_id: string;
  readonly email?: string;
}

/**
 * One served mapping's structural schema.
 * A malformed payload throws at the
 * boundary — an unvalidated mapping never
 * reaches the list (BLD-07).
 */
export const SsoMappingViewSchema = {
  parse: (data: unknown): SsoMappingView => {
    const record = data as Partial<SsoMappingView> | null;
    if (
      typeof record !== 'object' ||
      record === null ||
      record.platform !== 'oidc' ||
      typeof record.oidc_sub !== 'string' ||
      typeof record.real_user_id !== 'string'
    ) {
      throw new Error('malformed SSO mapping');
    }
    const { email } = record;
    return {
      platform: 'oidc',
      oidc_sub: record.oidc_sub,
      real_user_id: record.real_user_id,
      ...(typeof email === 'string' ? { email } : {}),
    };
  },
};

/**
 * The list response (`GET
 * /users/sso-mappings?email=…`) — a bare
 * array, the IDN-07 search shape.
 */
export const SsoMappingListSchema = {
  parse: (data: unknown): SsoMappingView[] => {
    if (!Array.isArray(data)) {
      throw new Error('malformed SSO mapping list');
    }
    return data.map((mapping) =>
      SsoMappingViewSchema.parse(mapping),
    );
  },
};

/**
 * The create response (`POST
 * /users/sso-mappings`) — the created
 * mapping, served on 201.
 */
export const SsoMappingCreateResponseSchema = {
  parse: (data: unknown): SsoMappingView =>
    SsoMappingViewSchema.parse(data),
};
