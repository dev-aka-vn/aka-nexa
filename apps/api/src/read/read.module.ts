import { Module } from '@nestjs/common';

import {
  DslService,
  PermissionCheckService,
  ReadVerifierService,
  ReadDenyService,
  RbacService,
  RbacCacheService,
  SeedSavedQueryLookup,
  SignatureFailureLimiter,
  SubmissionRepository,
  SubmissionRevisionsRepository,
  LinkTokenStore,
  DataRouterService,
  type ReadLinkJwtVerifier,
} from '@akane/domain';
import { MongoModule, redisCacheProvider, verifyReadLinkJwt } from '@akane/platform';

import { ReadController } from './read.controller.js';
import {
  registerReadDenyMetrics,
  registerSignatureBlockMetrics,
} from '../common/metrics/read-deny.metrics.js';

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
  readonly previousPublicKey?: string | null;
  readonly rendererOrigin: string;
}

/**
 * The keys {@link readReadLinkConfig} requires.
 *
 * Exported so the required set has one source: README.md's "Read-link
 * verification" section documents exactly these, and a deployment that sets a
 * different four fails the `missing` check below by name.
 *
 * These are **required** at boot. `JWT_READ_PUBLIC_KEY_PREVIOUS` is deliberately
 * absent: the rotation window is optional (LNK-12), and a key that is
 * present-but-empty would fail the `!process.env[k]` check below rather than
 * mean "no previous key".
 */
export const READ_LINK_CONFIG_KEYS = [
  'JWT_ISSUER',
  'JWT_AUDIENCE',
  'JWT_READ_PUBLIC_KEY',
  'RENDERER_ORIGIN',
] as const;

/**
 * Expand the two characters `\` `n` back into a newline.
 *
 * `.env.example` is a single-line-per-assignment shell file, and a shell does
 * not expand `\n` inside an unquoted assignment — it takes the two characters
 * literally. A PEM is multi-line, so it is written escaped in the example and
 * expanded here, once, on the value the verifier actually parses. Without this
 * `createPublicKey` reads a one-line string that begins `-----BEGIN` and fails
 * at boot with an OpenSSL decode error rather than a named config error.
 */
function expandPem(value: string): string {
  return value.replace(/\\n/g, '\n');
}

export function readReadLinkConfig(): ReadLinkConfig {
  const missing = READ_LINK_CONFIG_KEYS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      'READ_LINK_CONFIG_INVALID: must set ' + missing.join(', '),
    );
  }
  const previous = process.env['JWT_READ_PUBLIC_KEY_PREVIOUS'];
  return {
    issuer: process.env['JWT_ISSUER']!,
    audience: process.env['JWT_AUDIENCE']!,
    publicKey: expandPem(process.env['JWT_READ_PUBLIC_KEY']!),
    previousPublicKey:
      previous === undefined || previous === '' ? null : expandPem(previous),
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
    private readonly previousPublicKey?: string | null,
  ) {}

  async verify(token: string): Promise<Record<string, unknown>> {
    return verifyReadLinkJwt(token, this.publicKey, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['ES256'],
      previousPublicKey: this.previousPublicKey,
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
 * (a frozen Phase 1 file — adding fields is a later config plan), so
 * `APP_CONFIG_KEYS` does not list them, and they are documented in README.md
 * under "Read-link verification" rather than in `.env.example`: that file is a
 * shell contract whose active lines are `KEY=value` with no whitespace in the
 * value, and a PEM is multi-line (its header even contains a space), so the
 * public key cannot be one. The factory fails loudly with
 * `READ_LINK_CONFIG_INVALID:` if any are absent, so a misconfigured deployment
 * cannot verify without a key.
 */
@Module({
  imports: [MongoModule],
  controllers: [ReadController],
  providers: [
    redisCacheProvider,
    {
      provide: 'READ_LINK_CONFIG',
      useFactory: (): ReadLinkConfig => readReadLinkConfig(),
    },
    {
      provide: 'READ_LINK_JWT_VERIFIER',
      useFactory: (config: ReadLinkConfig): ReadLinkJwtVerifier =>
        new ReadLinkJwtVerifierImpl(
          config.publicKey,
          config.issuer,
          config.audience,
          config.previousPublicKey,
        ),
      inject: [{ token: 'READ_LINK_CONFIG', optional: false }],
    },
    PermissionCheckService,
    RbacService,
    RbacCacheService,
    // queryWithDsl compiles through the one DSL entry point (DAT-10/11);
    // without this provider SubmissionRepository cannot be constructed.
    DslService,
    SubmissionRepository,
    SubmissionRevisionsRepository,
    LinkTokenStore,
    DataRouterService,
    SignatureFailureLimiter,
    {
      provide: 'READ_SIGNATURE_BLOCKS',
      useFactory: () => registerSignatureBlockMetrics(),
    },
    {
      provide: ReadDenyService,
      useFactory: (): ReadDenyService => {
        const recorder = registerReadDenyMetrics();
        return new ReadDenyService(recorder);
      },
    },
    {
      // The D-73 saved-query store (G-11). Declared as a factory rather than a
      // class token: the class takes an *optional* `records` parameter, and
      // letting Nest reflect that would make it try to inject an Array.
      provide: SeedSavedQueryLookup,
      useFactory: (): SeedSavedQueryLookup => new SeedSavedQueryLookup(),
    },
    {
      provide: ReadVerifierService,
      useFactory: (
        jwt: ReadLinkJwtVerifier,
        permissionCheck: PermissionCheckService,
        submissions: SubmissionRepository,
        savedQueries: SeedSavedQueryLookup,
        denyService: ReadDenyService,
        revisions: SubmissionRevisionsRepository,
        tokenStore: LinkTokenStore,
      ): ReadVerifierService =>
        new ReadVerifierService(
          jwt,
          permissionCheck,
          submissions,
          savedQueries,
          denyService,
          revisions,
          tokenStore,
        ),
      inject: [
        { token: 'READ_LINK_JWT_VERIFIER', optional: false },
        PermissionCheckService,
        SubmissionRepository,
        SeedSavedQueryLookup,
        ReadDenyService,
        SubmissionRevisionsRepository,
        LinkTokenStore,
      ],
    },
  ],
})
export class ReadModule {}
