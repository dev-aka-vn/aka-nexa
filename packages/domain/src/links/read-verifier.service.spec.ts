/**
 * Tracer test for ReadVerifierService (LNK-05, LNK-06, D-40, D-79, D-42).
 *
 * This spec proves the end-to-end verification path: a real ES256 JWT (signed
 * with a private key generated in this process) is verified through the real
 * `verifyReadLinkJwt` adapter from `@akane/platform/crypto` — the jose boundary.
 * The verifier delegates crypto to that adapter, then owns the claim-shape
 * parsing (frozen schema), action branching, ownership check (D-79), and the
 * fresh perm_version check (LNK-06).
 *
 * ## Boundary-safe
 *
 * This file lives in `packages/domain/src/links/` and therefore may NOT import
 * `jose` directly (R2: only `crypto-owner` + `connector-owner` categories can).
 * Instead it:
 *
 *   - uses Node's built-in `crypto` module (origin: `core`) to generate the
 *     test key pair and sign JWTs, and
 *   - imports `verifyReadLinkJwt` from `@akane/platform/crypto` — an allowed
 *     `links → platform` edge — which internally reaches jose.
 *
 * So the test exercises the real jose-based verification path without a single
 * `jose` import in this file.
 */

import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadDenyReason } from '@akane/contract';
import { verifyReadLinkJwt } from '@akane/platform';

import {
  ReadVerifierService,
  type ReadLinkJwtVerifier,
  type SavedQueryLookup,
  type SavedQueryRecord,
  type SubmissionLookup,
  type SubmissionRecord,
} from './read-verifier.service.js';
import { PermissionCheckService } from '../authz/permission-check.service.js';
import { RbacCacheService } from '../authz/rbac-cache.service.js';
import { RbacService } from '../authz/rbac.service.js';

// ─── Test crypto: ES256 key pair (Node built-in, no jose import) ────────────

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;

const ISSUER = 'https://akane.test';
const AUDIENCE = 'https://renderer.akane.test';

/** Sign a payload as an ES256 JWT using the Node built-in crypto module. */
function signTestJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'ES256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerB64}.${payloadB64}`;

  const signer = createSign('SHA256');
  signer.update(signingInput);
  const signature = signer.sign({
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${signature.toString('base64url')}`;
}

// ─── TestReadLinkJwtVerifier: delegates to the REAL verifyReadLinkJwt ────────

class TestReadLinkJwtVerifier implements ReadLinkJwtVerifier {
  async verify(token: string): Promise<Record<string, unknown>> {
    return verifyReadLinkJwt(token, PUBLIC_KEY_PEM, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['ES256'],
    });
  }
}

// ─── TestSubmissionLookup: in-memory, tracks calls ───────────────────────────

class TestSubmissionLookup implements SubmissionLookup {
  readonly calls: Array<{ submissionId: string; realUserId: string }> = [];
  private store = new Map<string, SubmissionRecord>();

  set(submission: SubmissionRecord): void {
    this.store.set(submission._id, submission);
  }

  async findByIdOwned(
    submissionId: string,
    realUserId: string,
  ): Promise<SubmissionRecord | null> {
    this.calls.push({ submissionId, realUserId });
    const sub = this.store.get(submissionId);
    if (sub === undefined || sub.real_user_id !== realUserId) {
      return null;
    }
    return sub;
  }
}

// ─── TestSavedQueryLookup: in-memory D-73 seam, tracks calls ────────────────

class TestSavedQueryLookup implements SavedQueryLookup {
  readonly calls: Array<{ queryId: string; appId: string }> = [];
  private store = new Map<string, SavedQueryRecord>();

  set(record: SavedQueryRecord): void {
    this.store.set(`${record.app_id}:${record.query_id}`, record);
  }

  async findSavedQuery(queryId: string, appId: string): Promise<SavedQueryRecord | null> {
    this.calls.push({ queryId, appId });
    return this.store.get(`${appId}:${queryId}`) ?? null;
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const nowSec = () => Math.floor(Date.now() / 1000);

function makeClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = nowSec();
  return {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'u_123',
    jti: 'jti_abc',
    iat: now,
    nbf: now,
    exp: now + 3600,
    action: 'view',
    app_id: 'leave-request',
    form_id: 'leave-form',
    form_version: 1,
    app_version: 1,
    perm_version: 1,
    query_version: 1,
    target_id: 'sub_456',
    ...overrides,
  };
}

const testSubmission: SubmissionRecord = {
  _id: 'sub_456',
  real_user_id: 'u_123',
  app_id: 'leave-request',
  form_id: 'leave-form',
  form_version: 1,
  data: { reason: 'vacation', days: 5 },
};

/** D-73 saved-query record matching the fixture claims (`query_version: 1`). */
const testSavedQuery: SavedQueryRecord = {
  query_id: 'qry_789',
  query_version: 1,
  app_id: 'leave-request',
  intents: ['list pending leave requests'],
  dsl: { filters: { op: 'eq', field: 'status', value: 'pending' } },
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('ReadVerifierService', () => {
  let jwt: TestReadLinkJwtVerifier;
  let submissions: TestSubmissionLookup;
  let savedQueries: TestSavedQueryLookup;
  let permissionCheck: PermissionCheckService;
  let verifier: ReadVerifierService;

  beforeEach(() => {
    jwt = new TestReadLinkJwtVerifier();
    submissions = new TestSubmissionLookup();
    submissions.set(testSubmission);
    savedQueries = new TestSavedQueryLookup();
    savedQueries.set(testSavedQuery);
    permissionCheck = new PermissionCheckService(
      new RbacService(),
      new RbacCacheService(),
    );
    // Default: permission granted
    vi.spyOn(permissionCheck, 'check').mockResolvedValue(true);
    verifier = new ReadVerifierService(jwt, permissionCheck, submissions, savedQueries);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── view action ──────────────────────────────────────────────────────

  describe('view action', () => {
    it('returns success with submission for a valid view token (LNK-05)', async () => {
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      const result = await verifier.verify(token);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.claims.action).toBe('view');
        expect(result.claims.sub).toBe('u_123');
        expect(result.claims.target_id).toBe('sub_456');
        expect(result.submission).toEqual(testSubmission);
      }
    });

    it('returns not_found when the submission does not exist', async () => {
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'nope_999' }));
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.not_found });
    });

    it('returns not_found when the submission is not owned by sub (D-79)', async () => {
      // Insert a submission owned by a DIFFERENT user
      submissions.set({
        ...testSubmission,
        _id: 'sub_other',
        real_user_id: 'u_other',
      });

      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_other' }));
      const result = await verifier.verify(token);

      // D-79: findByIdOwned ANDs _id + real_user_id; a non-owned submission
      // returns null — indistinguishable from "not found" — and the verifier
      // emits not_found, never exposing existence to another user.
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.not_found });
      expect(submissions.calls).toContainEqual({
        submissionId: 'sub_other',
        realUserId: 'u_123',
      });
    });

    it('returns bad_signature when target_id is missing for a view link', async () => {
      const claims: Record<string, unknown> = {
        ...makeClaims({ action: 'view' }),
      };
      delete claims['target_id'];
      const token = signTestJwt(claims);
      const result = await verifier.verify(token);

      // The frozen schema permits target_id as optional, but verifyView
      // requires it — a view claim without target_id is structurally invalid.
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('returns denied when the permission check fails (LNK-06)', async () => {
      vi.spyOn(permissionCheck, 'check').mockResolvedValue(false);

      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.denied });
    });

    it('passes perm_version to PermissionCheckService.check (LNK-06)', async () => {
      const token = signTestJwt(
        makeClaims({ action: 'view', target_id: 'sub_456', perm_version: 3 }),
      );
      await verifier.verify(token);

      expect(permissionCheck.check).toHaveBeenCalledWith(
        'leave-request',
        'u_123',
        'leave-request:view',
        3,
      );
    });

    it('queries findByIdOwned with target_id and sub (D-79)', async () => {
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      await verifier.verify(token);

      expect(submissions.calls).toEqual([
        { submissionId: 'sub_456', realUserId: 'u_123' },
      ]);
    });
  });

  // ── query action ─────────────────────────────────────────────────────

  describe('query action (LNK-05, LNK-06, D-73, D-75)', () => {
    it('loads the saved query and returns it with the claims on a valid query token', async () => {
      const token = signTestJwt(makeClaims({ action: 'query', target_id: 'qry_789' }));
      const result = await verifier.verify(token);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.claims.action).toBe('query');
        expect(result.submission).toBeUndefined();
        expect(result.savedQuery).toEqual(testSavedQuery);
        // the lookup is scoped by query_id AND app_id (D-73)
        expect(savedQueries.calls).toEqual([{ queryId: 'qry_789', appId: 'leave-request' }]);
        // query still performs a perm_version check (LNK-06)
        expect(permissionCheck.check).toHaveBeenCalledWith(
          'leave-request',
          'u_123',
          'query:run',
          1,
        );
      }
    });

    it('denies wrong_version when the saved query does not exist (D-75)', async () => {
      const token = signTestJwt(makeClaims({ action: 'query', target_id: 'qry_missing' }));
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.wrong_version });
    });

    it('denies wrong_version when target_id (query_id) is absent', async () => {
      const claims = { ...makeClaims({ action: 'query' }) };
      delete claims['target_id'];
      const token = signTestJwt(claims);
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.wrong_version });
    });

    it('denies wrong_version when the saved query_version is stale (D-75)', async () => {
      savedQueries.set({ ...testSavedQuery, query_version: 2 });

      const token = signTestJwt(
        makeClaims({ action: 'query', target_id: 'qry_789', query_version: 1 }),
      );
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.wrong_version });
      // the permission check is not the reason for this denial
      expect(permissionCheck.check).not.toHaveBeenCalled();
    });

    it('denies wrong_version for a query link when no lookup seam is wired (fail closed)', async () => {
      const unwired = new ReadVerifierService(jwt, permissionCheck, submissions);
      const token = signTestJwt(makeClaims({ action: 'query', target_id: 'qry_789' }));
      const result = await unwired.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.wrong_version });
    });

    it('returns denied when the permission check fails for query (LNK-06)', async () => {
      vi.spyOn(permissionCheck, 'check').mockResolvedValue(false);

      const token = signTestJwt(makeClaims({ action: 'query', target_id: 'qry_789' }));
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.denied });
    });

    it('checks the version before the permission (plan order: wrong_version wins)', async () => {
      vi.spyOn(permissionCheck, 'check').mockResolvedValue(false);
      savedQueries.set({ ...testSavedQuery, query_version: 9 });

      const token = signTestJwt(
        makeClaims({ action: 'query', target_id: 'qry_789', query_version: 1 }),
      );
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.wrong_version });
      expect(permissionCheck.check).not.toHaveBeenCalled();
    });
  });

  // ── denial reasons ────────────────────────────────────────────────────

  describe('denial reasons', () => {
    it('returns bad_signature for a forged signature', async () => {
      const claims = makeClaims({ action: 'view', target_id: 'sub_456' });
      const headerB64 = Buffer.from(
        JSON.stringify({ alg: 'ES256', typ: 'JWT' }),
      ).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
      // Valid structure but garbage signature
      const forged = `${headerB64}.${payloadB64}.${'AA'.repeat(64)}`;

      const result = await verifier.verify(forged);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('returns bad_signature for an expired token', async () => {
      const now = nowSec();
      const token = signTestJwt(
        makeClaims({
          action: 'view',
          target_id: 'sub_456',
          iat: now - 7200,
          exp: now - 1,
        }),
      );
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('returns bad_signature for a wrong issuer', async () => {
      const token = signTestJwt(makeClaims({ iss: 'https://evil.issuer' }));
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('returns bad_signature for a wrong audience', async () => {
      const token = signTestJwt(makeClaims({ aud: 'https://evil.audience' }));
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('returns bad_signature for an unknown claim field (strict schema)', async () => {
      const token = signTestJwt(makeClaims({ evil_extra: 'drop table' }));
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('returns invalid_action for an unhandled action (create)', async () => {
      const token = signTestJwt(makeClaims({ action: 'create' }));
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.invalid_action });
    });

    it('returns invalid_action for an unhandled action (edit)', async () => {
      const token = signTestJwt(makeClaims({ action: 'edit' }));
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.invalid_action });
    });

    it('returns invalid_action for an unhandled action (draft)', async () => {
      const token = signTestJwt(makeClaims({ action: 'draft', target_id: 'drf_001' }));
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.invalid_action });
    });
  });

  // ── D-42: read links never consume ────────────────────────────────────

  describe('no consumption (D-42)', () => {
    it('verifies the same token twice successfully (stateless, idempotent)', async () => {
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      const first = await verifier.verify(token);
      const second = await verifier.verify(token);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      // No Redis state: both calls hit the same verifier with the same result.
      expect(submissions.calls).toHaveLength(2);
    });
  });
});
