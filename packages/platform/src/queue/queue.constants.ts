/**
 * BullMQ key prefix (D-14).
 *
 * The `{...}` hash tag forces every BullMQ key into one Redis Cluster slot, so
 * queue commands that touch several keys stay co-located. Accepted knowingly:
 * queue throughput therefore does not shard, and that slot is a documented
 * throughput and memory ceiling. Never pair this with ioredis `keyPrefix` —
 * BullMQ's Lua scripts embed literal key names that `keyPrefix` does not
 * rewrite, producing two prefixing layers that disagree about where keys live.
 */
export const BULLMQ_PREFIX = '{akane-q}';
