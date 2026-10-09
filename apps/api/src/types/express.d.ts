/**
 * Minimal ambient type declarations for the `express` module.
 *
 * The project uses Express 5.x (`@nestjs/platform-express@12.1.2` depends on
 * `express@5.2.1`), which ships no type declarations of its own, and
 * `@types/express` is not installed. `skipLibCheck` covers the NestJS
 * platform's `.d.ts` files (which `import type { Express } from 'express'`),
 * but source files that import `Response` need a declaration to satisfy
 * `tsc`.
 *
 * This is intentionally minimal: only the three methods the read-link
 * controller uses are declared. If other source files need more Express
 * surface, expand this file rather than installing @types/express — the
 * boundary lint rule treats `express` as an allowed external module, but
 * minimizing the ambient surface reduces the risk of a stale typing masking
 * a real API mismatch.
 */
declare module 'express' {
  export interface Response {
    status(code: number): this;
    json(body: unknown): void;
    redirect(status: number, url: string): void;
  }
}
