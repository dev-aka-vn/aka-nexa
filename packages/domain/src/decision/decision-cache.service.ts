import { createHash } from 'node:crypto';

import type { Redis as IORedis } from 'ioredis';

/**
 * RTE-09 decision cache.
 *
 * Key shape (frozen):
 *   jev:decision:<real_user_id>:<conversation_id>:<perm_epoch>:<pub_threshold_version>:<sha256(material)>
 * where material is `<canonicalSameThreadText>|<sortedToolIds.join(',')>|<locale>`.
 *
 * Cross-context isolation is structural: a different user, thread, permission
 * epoch, publication/threshold version, locale, or same-thread context hashes
 * to a different key and can never reuse an entry. TTL is configurable so an
 * operator can bound a stale epoch's lifetime even if invalidation is missed.
 *
 * The cached payload is an *input to the gate*, never an authority: on every
 * hit the orchestrator still re-filters tools through fresh RBAC, re-runs the
 * permission gate, and re-validates against the frozen schema before issuing a
 * link (Pitfall 1). Neither the plaintext nor the raw hash is ever logged
 * (D-57).
 */
export interface DecisionCacheKeyInput {
  readonly realUserId: string;
  readonly conversationId: string;
  readonly permEpoch: string | number;
  readonly pubThresholdVersion: string | number;
  readonly canonicalText: string;
  readonly toolIds: readonly string[];
  readonly locale: string;
}

export class DecisionCacheService {
  constructor(
    private readonly redis: IORedis,
    private readonly ttlSeconds: number,
  ) {}

  keyFor(input: DecisionCacheKeyInput): string {
    const sorted = [...input.toolIds].sort().join(',');
    const material = `${input.canonicalText}|${sorted}|${input.locale}`;
    const hash = createHash('sha256').update(material, 'utf8').digest('hex');
    return (
      `jev:decision:${input.realUserId}:${input.conversationId}:` +
      `${input.permEpoch}:${input.pubThresholdVersion}:${hash}`
    );
  }

  get(input: DecisionCacheKeyInput): Promise<string | null> {
    return this.redis.get(this.keyFor(input));
  }

  async set(input: DecisionCacheKeyInput, decisionJson: string): Promise<void> {
    await this.redis.set(this.keyFor(input), decisionJson, 'EX', this.ttlSeconds);
  }

  /** Epoch bump → old keys are unreachable by construction; this is the belt. */
  async invalidate(input: DecisionCacheKeyInput): Promise<void> {
    await this.redis.del(this.keyFor(input));
  }
}

/**
 * The canonical same-thread context: the original request followed by every
 * clarification reply so far, in order. Never just the latest reply — a
 * single-turn entry must never satisfy a multi-turn follow-up.
 */
export function canonicalSameThreadText(
  question: string,
  clarificationReplies: readonly string[] = [],
): string {
  return [question.trim(), ...clarificationReplies.map((reply) => reply.trim())].join('\n');
}
