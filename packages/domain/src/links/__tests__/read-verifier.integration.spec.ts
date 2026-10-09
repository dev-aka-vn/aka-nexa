/**
 * Integration tests for ReadVerifierService (LNK-05, LNK-06, D-40, D-75).
 *
 * Covers view and query flows end-to-end with real JWT verification boundary
 * via the platform crypto adapter, plus denial cases including wrong_version
 * and perm_version enforcement.
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
} from '../read-verifier.service.js';
import { PermissionCheckService } from '../../authz/permission-check.service.js';
import { RbacCacheService } from '../../authz/rbac-cache.service.js';
import { RbacService } from '../../authz/rbac.service.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }) as string;

const ISSUER = 'https://akane.test';
const AUDIENCE = 'https://renderer.akane.test';

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

class TestReadLinkJwtVerifier implements ReadLinkJwtVerifier {
  async verify(token: string): Promise<Record<string, unknown>> {
    return verifyReadLinkJwt(token, PUBLIC_KEY_PEM, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['ES256'],
    });
  }
}

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

const testSavedQuery: SavedQueryRecord = {
  query_id: 'qry_789',
  query_version: 1,
  app_id: 'leave-request',
  intents: ['list pending leave requests'],
  dsl: { filters: { op: 'eq', field: 'status', value: 'pending' } },
};

describe('ReadVerifierService (integration)', () => {
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
    vi.spyOn(permissionCheck, 'check').mockResolvedValue(true);
    verifier = new ReadVerifierService(jwt, permissionCheck, submissions, savedQueries);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('view endpoint flow', () => {
    it('valid view token returns view data', async () => {
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      const result = await verifier.verify(token);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.claims.action).toBe('view');
        expect(result.submission).toEqual(testSubmission);
      }
    });

    it('invalid/bad signature is rejected', async () => {
      const result = await verifier.verify('not.a.valid.token');
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('denied when permission check fails (LNK-06)', async () => {
      vi.mocked(permissionCheck.check).mockResolvedValue(false);
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.denied });
    });
  });

  describe('query endpoint flow', () => {
    it('valid query token succeeds with saved query (LNK-06)', async () => {
      const token = signTestJwt(
        makeClaims({
          action: 'query',
          target_id: 'qry_789',
          query_version: 1,
        }),
      );
      const result = await verifier.verify(token);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.claims.action).toBe('query');
        expect(result.savedQuery).toEqual(testSavedQuery);
      }
    });

    it('wrong_version when query_version mismatches (D-75)', async () => {
      const token = signTestJwt(
        makeClaims({
          action: 'query',
          target_id: 'qry_789',
          query_version: 99,
        }),
      );
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.wrong_version });
    });

    it('wrong_version when saved query missing (D-75)', async () => {
      const token = signTestJwt(
        makeClaims({
          action: 'query',
          target_id: 'missing_qry',
          query_version: 1,
        }),
      );
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.wrong_version });
    });

    it('perm_version enforcement in query path (LNK-06)', async () => {
      vi.mocked(permissionCheck.check).mockResolvedValue(false);
      const token = signTestJwt(
        makeClaims({
          action: 'query',
          target_id: 'qry_789',
          query_version: 1,
        }),
      );
      const result = await verifier.verify(token);

      expect(result).toEqual({ ok: false, reason: ReadDenyReason.denied });
    });
  });

  describe('deny reasons', () => {
    it('not_found for missing submission in view path', async () => {
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'nope' }));
      const result = await verifier.verify(token);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.not_found });
    });

    it('bad_signature for tampered token', async () => {
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      const badToken = token.slice(0, -10) + 'corrupted!';
      const result = await verifier.verify(badToken);
      expect(result).toEqual({ ok: false, reason: ReadDenyReason.bad_signature });
    });

    it('denied propagates correct reason', async () => {
      vi.mocked(permissionCheck.check).mockResolvedValue(false);
      const token = signTestJwt(makeClaims({ action: 'view', target_id: 'sub_456' }));
      const result = await verifier.verify(token);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(ReadDenyReason.denied);
      }
    });
  });
});
