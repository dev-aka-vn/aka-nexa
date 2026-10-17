/**
 * LNK-06 adversarial: perm_version is actually compared on every access.
 *
 * The requirement (REQUIREMENTS.md §"Links & Token Security"):
 *   "A read link re-checks permission and compares `perm_version` on every
 *    access, and is rejected when they diverge."
 *
 * Two levels of test:
 *
 * Level 1 — delegation (the verifier passes the claim's perm_version to the
 * permission check). This SHOULD pass — it proves the verifier wires the right
 * value through.
 *
 * Level 2 — enforcement (the real PermissionCheckService + RbacService actually
 * compares perm_version against a "live" epoch and rejects on divergence).
 * This is the adversarial part: if the underlying RBAC stub ignores
 * perm_version, the requirement is not actually met.
 */
import { describe, expect, it, vi } from 'vitest';

import { ReadDenyReason } from '@akane/contract';
import { PermissionCheckService } from '../../authz/permission-check.service.js';
import { RbacCacheService } from '../../authz/rbac-cache.service.js';
import { RbacService } from '../../authz/rbac.service.js';
import {
  ReadVerifierService,
  type ReadLinkJwtVerifier,
  type SavedQueryLookup,
  type SavedQueryRecord,
  type SubmissionLookup,
  type SubmissionRecord,
} from '../read-verifier.service.js';

// ─── Stub JWT verifier (delegates to test-controlled payload) ──────────────

function makeJwt(payload: Record<string, unknown>): ReadLinkJwtVerifier {
  return { verify: async () => payload };
}

// ─── Stubs for dependencies ─────────────────────────────────────────────────

function makeSubmission(): SubmissionRecord {
  return {
    _id: 'sub_1',
    real_user_id: 'u_1',
    app_id: 'app_1',
    form_id: 'f_1',
    form_version: 1,
    data: {},
  };
}

const NOW = Math.floor(Date.now() / 1000);
const VIEW_CLAIMS = {
  iss: 'akane',
  aud: 'read',
  jti: 'jti-1',
  iat: NOW,
  nbf: NOW,
  exp: NOW + 300,
  action: 'view',
  app_id: 'app_1',
  form_id: 'f_1',
  form_version: 1,
  app_version: 1,
  perm_version: 1,
  query_version: 1,
  sub: 'u_1',
  target_id: 'sub_1',
};

// ─── Level 1: does the verifier pass the claim's perm_version? ──────────────

describe('LNK-06: verifier delegates perm_version from claim to permission check', () => {
  it('passes claims.perm_version to PermissionCheckService.check on view', async () => {
    const seen: Array<{
      app_id: string;
      real_user_id: string;
      permission: string;
      perm_version: number;
    }> = [];

    const rbac = new RbacService();
    const cache = new RbacCacheService();
    vi.spyOn(rbac, 'hasPermission').mockImplementation(async (app, user, perm, pv) => {
      seen.push({ app_id: app, real_user_id: user, permission: perm, perm_version: pv });
      return true;
    });
    vi.spyOn(rbac, 'getPermissions').mockResolvedValue(['app_1:view']);

    const verifier = new ReadVerifierService(
      makeJwt({ ...VIEW_CLAIMS, perm_version: 7 }),
      new PermissionCheckService(rbac, cache),
      { async findByIdOwned() { return makeSubmission(); } },
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].perm_version).toBe(7); // the claim's perm_version, not 0 or default
  });

  it('passes claims.perm_version to PermissionCheckService.check on query', async () => {
    const seen: Array<{
      app_id: string;
      real_user_id: string;
      permission: string;
      perm_version: number;
    }> = [];

    const rbac = new RbacService();
    const cache = new RbacCacheService();
    vi.spyOn(rbac, 'hasPermission').mockImplementation(async (app, user, perm, pv) => {
      seen.push({ app_id: app, real_user_id: user, permission: perm, perm_version: pv });
      return true;
    });
    vi.spyOn(rbac, 'getPermissions').mockResolvedValue(['app_1:query:run']);

    const savedQuery: SavedQueryRecord = {
      query_id: 'q_1',
      query_version: 1,
      dsl: {},
      intents: [],
      app_id: 'app_1',
    };

    const verifier = new ReadVerifierService(
      makeJwt({ ...VIEW_CLAIMS, action: 'query', target_id: 'q_1', perm_version: 3 }),
      new PermissionCheckService(rbac, cache),
      { async findByIdOwned() { return null; } },
      {
        async findSavedQuery(_id, _app) {
          return savedQuery;
        },
      },
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].perm_version).toBe(3);
  });
});

// ─── Level 2: does the real PermissionCheckService actually compare perm_version? ─

describe('LNK-06: real PermissionCheckService compares perm_version (UNMOCKED RBAC)', () => {
  it('perm_version is used as a cache key so a diverged version triggers a fresh check', async () => {
    // Use the REAL RbacService (no mock) — its hasPermission is the stub that
    // always returns true, but the cache SHOULD distinguish by perm_version.
    const rbac = new RbacService();
    const cache = new RbacCacheService();
    const service = new PermissionCheckService(rbac, cache);

    // Prime the cache with perm_version=1
    const r1 = await service.check('app_1', 'u_1', 'app_1:view', 1);
    expect(r1).toBe(true);

    // A different perm_version should trigger a cache miss and a fresh call.
    // We spy on hasPermission to confirm it was called with the new version.
    const hasPermSpy = vi.spyOn(rbac, 'hasPermission');
    const r2 = await service.check('app_1', 'u_1', 'app_1:view', 2);

    // The real RbacService.hasPermission always returns true (stub), so both
    // calls return true. The ASSERTION that matters: did it actually receive
    // perm_version=2? If the cache didn't key on perm_version, this would be
    // a cache hit returning the same result without a fresh call.
    expect(r2).toBe(true);
    expect(hasPermSpy).toHaveBeenCalled();
    const lastCall = hasPermSpy.mock.calls[hasPermSpy.mock.calls.length - 1];
    expect(lastCall[3]).toBe(2); // perm_version was passed through
  });

  it('RbacService.hasPermission ignores perm_version — always returns true (GAP)', async () => {
    // This test proves the GAP: the RbacService stub does NOT compare
    // perm_version against any live value. It has no concept of a "current"
    // perm_version epoch to compare against. The parameter is named
    // `_perm_version` (underscore = intentionally unused).
    //
    // If this test fails, it means someone fixed RbacService to actually
    // use perm_version. If it passes, the requirement LNK-06 is NOT
    // actually enforced at the RBAC layer — the verifier passes the value
    // but nobody compares it.
    const rbac = new RbacService();

    const v1 = await rbac.hasPermission('app_1', 'u_1', 'app_1:view', 1);
    const v2 = await rbac.hasPermission('app_1', 'u_1', 'app_1:view', 999);

    // Both return true — perm_version is NOT compared.
    expect(v1).toBe(true);
    expect(v2).toBe(true);

    // If RbacService ever implements perm_version comparison, this assertion
    // would break: a diverged version should be rejected.
    // For now, it documents the gap.
  });
});

// ─── Level 3: end-to-end proof that the verifier denies on stale perm_version ─

describe('LNK-06: verifier rejects when permission check returns false', () => {
  it('view link denied when permissionCheck.check returns false (perm_version diverged)', async () => {
    // This is the existing behavior: when check() returns false,
    // the verifier denies with 'denied' reason.
    // This proves the verifier WOULD reject — but only IF the check actually
    // returns false, which depends on the RBAC layer comparing perm_version.
    const rbac = new RbacService();
    vi.spyOn(rbac, 'hasPermission').mockResolvedValue(false);

    const verifier = new ReadVerifierService(
      makeJwt(VIEW_CLAIMS),
      new PermissionCheckService(rbac, new RbacCacheService()),
      { async findByIdOwned() { return makeSubmission(); } },
    );

    const result = await verifier.verify('token');
    expect(result).toEqual({ ok: false, reason: ReadDenyReason.denied });
  });

  it('A permission change that bumps perm_version does NOT self-invalidate (GAP)', async () => {
    // This test simulates the real-world scenario: a user's permission is
    // revoked (perm_version bumps from 1 to 2). The JWT still carries
    // perm_version=1. With a CORRECT implementation, the fresh check should
    // return false → denied.
    //
    // With the current stub RbacService, hasPermission always returns true,
    // so the link is NOT invalidated even though perm_version diverged.
    //
    // We use the REAL RbacService (not mocked) to prove the gap.
    const { privateKey, publicKey } = await import('node:crypto').then(
      (crypto) => {
        const pair = crypto.generateKeyPairSync('ec', {
          namedCurve: 'prime256v1',
        });
        return pair;
      },
    );
    // This test documents: without mocking, the check always passes.
    // The verifier passes perm_version=1 from the claim.
    // The real RbacService.hasPermission("app_1","u_1","app_1:view",1) → true
    // Even though a permission change would have bumped the live perm_version to 2.
    // The gap is: nobody compares claim.perm_version vs live perm_version.

    // Since we can't easily set up a "live perm_version" in the stub,
    // we prove the gap by showing RbacService always returns true
    // regardless of the perm_version argument:
    const rbac = new RbacService();
    const result1 = await rbac.hasPermission('app_1', 'u_1', 'app_1:view', 1);
    const result2 = await rbac.hasPermission('app_1', 'u_1', 'app_1:view', 2);
    expect(result1).toBe(true);
    expect(result2).toBe(true);
    // If perm_version actually caused invalidation, result2 would be false.
  });
});
