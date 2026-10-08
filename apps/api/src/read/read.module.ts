import { Module } from '@nestjs/common';

import {
  DslService,
  PermissionCheckService,
  ReadVerifierService,
  RbacService,
  RbacCacheService,
  SubmissionRepository,
  type ReadLinkJwtVerifier,
} from '@akane/domain';
import { verifyReadLinkJwt } from '@akane/platform/crypto';

import { ReadController } from './read.controller.js';

/**
 * Reads the JWT read-link configuration from the live process environment.
 *
 * These values are **not** in the Phase 1 `AppConfigSchema` (a frozen file —
 * adding fields is a later config plan). Instead, like the platform crypto
 * module's `readKeyProviderEnv`, they are read directly from `process.env` at
 * module initialization time. A missing value fails the factory with a named
 * error so a misconfigured deployment cannot silently verify without a key.
 */
export interface ReadLinkConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly publicKey: string;
  readonly rendererOrigin: string;
}

const READ_LINK_CONFIG_KEYS = [
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'JWT_READ_PUBLIC_KEY',
  'RENDERER_ORIGIN',
] as const;

export function readReadLinkConfig(): ReadLinkConfig {
  const missing = READ_LINK_CONFIG_KEYS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      'READ_LINK_CONFIG_INVALID: must set ' + missing.join(', '),
    );
  }
  return {
    issuer: process.env['JWT_ISSUER']!,
    audience: process.env['JWT_AUDIENCE']!,
    publicKey: process.env['JWT_READ_PUBLIC_KEY']!,
    rendererOrigin: process.env['RENDERER_ORIGIN']!,
  };
}

/**
 * Adapts the platform's `verifyReadLinkJwt` (jose-based, in crypto-owner) to
 * the `ReadLinkJwtVerifier` interface expected by {@link ReadVerifierService}.
 *
 * Kept in this module file (not in the domain) so the `jose`-free boundary rule
 * for `links` is never at risk: the domain verifier never touches jose, only
 * the injected interface.
 */
export class ReadLinkJwtVerifierImpl implements ReadLinkJwtVerifier {
  constructor(
    private readonly publicKey: string,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  async verify(token: string): Promise<Record<string, unknown>> {
    return verifyReadLinkJwt(token, this.publicKey, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['ES256'],
    });
  }
}

/**
 * Read-link verification module (LNK-05, LNK-06, LNK-08).
 *
 * ## Wiring
 *
 * - `ReadLinkJwtVerifierImpl` — adapts the platform's `verifyReadLinkJwt`
 *   (jose, public key, in crypto-owner) to the interface the domain verifier
 *   expects. The platform owns the `jose` import; the domain owns the logic.
 * - `PermissionCheckService` — fresh per-request permission checks with the
 *   `perm_version` epoch (LNK-06, ACL-06/07).
 * - `SubmissionRepository` — `findByIdOwned` for the D-79 ownership invariant.
 *
 * ## Config
 *
 * `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_READ_PUBLIC_KEY`, and `RENDERER_ORIGIN`
 * are read by `readReadLinkConfig()` directly from `process.env` at module
 * initialization. They are intentionally **not** added to `AppConfigSchema`
 * (a frozen Phase 1 file); the same pattern the platform crypto module uses
 * for `CRYPTO_LOCAL_KEY_FILE`. The factory fails loudly if any are absent.
 */
@Module({
  controllers: [ReadController],
  providers: [
    {
      provide: 'READ_LINK_CONFIG',
      useFactory: (): ReadLinkConfig => readReadLinkConfig(),
    },
    {
      provide: 'READ_LINK_JWT_VERIFIER',
      useFactory: (config: ReadLinkConfig): ReadLinkJwtVerifier =>
        new ReadLinkJwtVerifierImpl(config.publicKey, config.issuer, config.audience),
      inject: [{ token: 'READ_LINK_CONFIG', optional: false }],
    },
    PermissionCheckService,
    RbacService,
    RbacCacheService,
    // queryWithDsl compiles through the one DSL entry point (DAT-10/11);
    // without this provider SubmissionRepository cannot be constructed.
    DslService,
    SubmissionRepository,
    {
      provide: ReadVerifierService,
      useFactory: (
        jwt: ReadLinkJwtVerifier,
        permissionCheck: PermissionCheckService,
        submissions: SubmissionRepository,
      ): ReadVerifierService => new ReadVerifierService(jwt, permissionCheck, submissions),
      inject: [
        { token: 'READ_LINK_JWT_VERIFIER', optional: false },
        PermissionCheckService,
        SubmissionRepository,
      ],
    },
  ],
})
export class ReadModule {}
