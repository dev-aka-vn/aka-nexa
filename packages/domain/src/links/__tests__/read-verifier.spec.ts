/**
 * LNK-05/LNK-06: read-link verifier tests (D-40, D-79, D-75).
 *
 * Tests end-to-end behavior of ReadVerifierService:
 * - LNK-05: valid token verifies with public key; bad signature denied
 * - LNK-06: perm_version mismatch causes deny; correct perm_version passes
 * - D-79: view link for submission not owned by sub denied
 * - Query: wrong_version denied when mismatch (D-75)
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

function makeJwt(valid = true, payload: Record<string, unknown> = {}): ReadLinkJwtVerifier {
  return {
    async verify(token: string) {
      if (!valid) throw new Error('bad signature');
      return payload;
    },
  };
}

function makePermissionCheck(allowed = true) {
  const rbac = new RbacService();
  const cache = new RbacCacheService();
  vi.spyOn(rbac, 'hasPermission').mockImplementation(async () => allowed);
  vi.spyOn(rbac, 'getPermissions').mockImplementation(async () => allowed ? ['perm'] : []);
  return {
    service: new PermissionCheckService(rbac, cache),
    rbac,
    cache,
  };
}


function makeSubmissions(submission: SubmissionRecord | null = null): SubmissionLookup {
  return {
    async findByIdOwned(_id, _sub) {
      return submission;
    },
  };
}

function makeSavedQueries(query: SavedQueryRecord | null = null): SavedQueryLookup {
  return {
    async findSavedQuery(_id, _app) {
      return query;
    },
  };
}

const NOW = Math.floor(Date.now() / 1000);
const BASE = {
  iss: 'akane',
  aud: 'read',
  jti: 'jti-1',
  iat: NOW,
  nbf: NOW,
  exp: NOW + 300,
  app_id: 'app_1',
  form_id: 'f_1',
  form_version: 1,
  app_version: 1,
  perm_version: 1,
  query_version: 1,
};

const VIEW_CLAIMS = {
  ...BASE,
  sub: 'u_1',
  action: 'view',
  target_id: 'sub_1',
};

const SUBMISSION: SubmissionRecord = {
  _id: 'sub_1',
  real_user_id: 'u_1',
  app_id: 'app_1',
  form_id: 'f_1',
  form_version: 1,
  data: {},
};

const QUERY_CLAIMS = {
  ...BASE,
  sub: 'u_1',
  action: 'query',
  target_id: 'q_1',
  query_version: 1,
};

const SAVED_QUERY: SavedQueryRecord = {
  query_id: 'q_1',
  query_version: 1,
  dsl: { filters: { op: 'eq', field: 'status', value: 'open' } },
  intents: [],
  app_id: 'app_1',
};

describe('ReadVerifierService (LNK-05, LNK-06)', () => {
  it('LNK-05: valid token verifies with public key', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(true, VIEW_CLAIMS),
      perm.service,
      makeSubmissions(SUBMISSION),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe('u_1');
      expect(result.submission).toBeDefined();
    }
  });

  it('LNK-05: bad signature denied', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(false),
      perm.service,
      makeSubmissions(SUBMISSION),
    );

    const result = await verifier.verify('bad-token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(ReadDenyReason.bad_signature);
    }
  });

  it('LNK-06: perm_version mismatch causes deny', async () => {
    const perm = makePermissionCheck(false);
    const verifier = new ReadVerifierService(
      makeJwt(true, { ...VIEW_CLAIMS, perm_version: 5 }),
      perm.service,
      makeSubmissions(SUBMISSION),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(ReadDenyReason.denied);
    }
  });

  it('LNK-06: correct perm_version passes', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(true, { ...VIEW_CLAIMS, perm_version: 2 }),
      perm.service,
      makeSubmissions(SUBMISSION),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(true);
  });

  it('D-79: view link for submission not owned by sub denied (not_found when not owned)', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(true, VIEW_CLAIMS),
      perm.service,
      makeSubmissions(null),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(ReadDenyReason.not_found);
    }
  });

  it('D-79: submission exists but not owned by sub returns not_found', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(true, { ...VIEW_CLAIMS, sub: 'u_2' }),
      perm.service,
      makeSubmissions(null),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(ReadDenyReason.not_found);
    }
  });

  it('Query: wrong_version denied when mismatch (D-75)', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(true, { ...QUERY_CLAIMS, query_version: 2 }),
      perm.service,
      makeSubmissions(null),
      makeSavedQueries(SAVED_QUERY),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(ReadDenyReason.wrong_version);
    }
  });

  it('Query: valid saved query with matching version passes', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(true, QUERY_CLAIMS),
      perm.service,
      makeSubmissions(null),
      makeSavedQueries(SAVED_QUERY),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.savedQuery).toBeDefined();
    }
  });

  it('Query: missing saved query returns wrong_version', async () => {
    const perm = makePermissionCheck(true);
    const verifier = new ReadVerifierService(
      makeJwt(true, QUERY_CLAIMS),
      perm.service,
      makeSubmissions(null),
      makeSavedQueries(null),
    );

    const result = await verifier.verify('token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(ReadDenyReason.wrong_version);
    }
  });
});
