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
