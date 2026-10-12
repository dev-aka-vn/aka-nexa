/**
 * Minimal ambient type declarations for the `express` module.
 *
 * The project uses Express 5.x (`@nestjs/platform-express@12.1.2` depends on
 * `express@5.2.1`), which ships no type declarations of its own, and
 * `@types/express` is not installed. `skipLibCheck` covers the NestJS
 * platform's `.d.ts` files (which `import type { Express } from 'express'`),
 * but source files that import `Request`/`Response` need a declaration to
 * satisfy `tsc`.
 *
 * This is intentionally minimal: only the methods the API's controllers
 * and middleware use are declared. If other source files need more Express
 * surface, expand this file rather than installing @types/express — the
 * boundary lint rule treats `express` as an allowed external module, but
 * minimizing the ambient surface reduces the risk of a stale typing masking
 * a real API mismatch.
 */
declare module 'express' {
  /** Cookie attributes for `Response#cookie` / `Response#clearCookie`. */
  export interface CookieOptions {
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    maxAge?: number;
    domain?: string;
  }

  export interface Request {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    originalUrl: string;
    protocol: string;
    query: Record<string, string | string[] | undefined>;
    get(field: string): string | undefined;
    /**
     * The session principal the builder session middleware
     * resolves (D-101): the opaque `realUserId`, the OIDC
     * subject linkage, the role and the MFA timestamp —
     * server-side values only, never a token.
     */
    user?: SessionUser;
  }

  /** The principal the builder session middleware sets on `Request#user`. */
  export interface SessionUser {
    realUserId: string;
    oidcSub: string;
    role: string;
    mfaAt: string;
  }

  export interface Response {
    status(code: number): this;
    json(body: unknown): void;
    redirect(status: number, url: string): void;
    /** Used by the AUD-10 rate-limit branch to set `Retry-After`. */
    set(field: string, value: string): this;
    /** Used by the D-101 session cookie issuance. */
    cookie(name: string, value: string, options?: CookieOptions): this;
    /** Used by the builder logout (clear the `__Host-` session cookie). */
    clearCookie(name: string, options?: CookieOptions): this;
  }

  /** The Nest middleware continuation. */
  export type NextFunction = (err?: unknown) => void;
}
