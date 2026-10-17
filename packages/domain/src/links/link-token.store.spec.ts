import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { REDIS_CACHE } from '@akane/platform';
import { LinkTokenStore } from './link-token.store.js';

describe('LinkTokenStore (LNK-02)', () => {
  it('recordOutcome/readOutcome round-trip with TTL >= link TTL', async () => {
    const storeSet = vi.fn().mockResolvedValue('OK');
    const storeGet = vi.fn().mockResolvedValue(
      JSON.stringify({ submission_id: 's1', revision: 2, downstreamRef: 'd1' }),
    );
    const redisSeam = {
      getdel: vi.fn(),
      get: storeGet,
      set: storeSet,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LinkTokenStore,
        { provide: REDIS_CACHE, useValue: redisSeam },
      ],
    }).compile();

    const store = moduleRef.get(LinkTokenStore);
    const outcome = { submission_id: 's1', revision: 2, downstreamRef: 'd1' };
    await store.recordOutcome('jti-123', outcome, 14400); // 4 hours default TTL

    expect(storeSet).toHaveBeenCalledWith('ak:tok:edit:outcome:jti-123', JSON.stringify(outcome), 'EX', 14400);

    const read = await store.readOutcome('jti-123');
    expect(read).toEqual(outcome);
  });

  it('recordOutcome stores TTL and readOutcome handles missing outcome', async () => {
    const storeGet = vi.fn().mockResolvedValue(null);
    const redisSeam = {
      getdel: vi.fn().mockResolvedValue(null),
      get: storeGet,
      set: vi.fn().mockResolvedValue('OK'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LinkTokenStore,
        { provide: REDIS_CACHE, useValue: redisSeam },
      ],
    }).compile();

    const store = moduleRef.get(LinkTokenStore);
    const read = await store.readOutcome('jti-missing');
    expect(read).toBeNull();
  });

  it('consume returns the record once then null (create path)', async () => {
    const getdelMock = vi.fn().mockResolvedValueOnce('token-value').mockResolvedValueOnce(null);
    const redisSeam = {
      getdel: getdelMock,
      get: vi.fn(),
      set: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LinkTokenStore,
        { provide: REDIS_CACHE, useValue: redisSeam },
      ],
    }).compile();

    const store = moduleRef.get(LinkTokenStore);
    const first = await store.consume('jti-create');
    expect(first).toBe('token-value');
    expect(getdelMock).toHaveBeenCalledWith('ak:tok:edit:jti-create');

    const second = await store.consume('jti-create');
    expect(second).toBeNull();
    expect(getdelMock).toHaveBeenCalledTimes(2);
  });
});
