import { Inject, Injectable } from '@nestjs/common';

import { REDIS_CACHE } from '@akane/platform';

import type { EditOutcome, LinkTokenStoreSeam } from './read-verifier.service.js';

export type CreateOutcome = 'already_submitted';

export type TokenOutcome = CreateOutcome | EditOutcome;

export interface RedisStructuralSeam {
  getdel(key: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
}

const EDIT_TOKEN_PREFIX = 'ak:tok:edit:';
const EDIT_OUTCOME_PREFIX = 'ak:tok:edit:outcome:';

@Injectable()
export class LinkTokenStore implements LinkTokenStoreSeam {
  constructor(@Inject(REDIS_CACHE) private readonly redis: RedisStructuralSeam) {}

  async consume(jti: string): Promise<string | null> {
    const key = `${EDIT_TOKEN_PREFIX}${jti}`;
    return this.redis.getdel(key);
  }

  async recordOutcome(jti: string, outcome: EditOutcome, ttlSeconds: number): Promise<void> {
    const key = `${EDIT_OUTCOME_PREFIX}${jti}`;
    const value = JSON.stringify({
      submission_id: outcome.submission_id,
      revision: outcome.revision,
      downstreamRef: outcome.downstreamRef ?? null,
    });
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async readOutcome(jti: string): Promise<EditOutcome | null> {
    const key = `${EDIT_OUTCOME_PREFIX}${jti}`;
    const raw = await this.redis.get(key);
    if (raw === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<EditOutcome> & { submission_id?: string; revision?: number };
      if (typeof parsed.submission_id !== 'string' || typeof parsed.revision !== 'number') {
        return null;
      }
      return {
        submission_id: parsed.submission_id,
        revision: parsed.revision,
        downstreamRef: parsed.downstreamRef ?? null,
      };
    } catch {
      return null;
    }
  }
}
