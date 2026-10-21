// Parser + reporter for Redis `INFO commandstats` output.
//
// The cost of the throttler is measured from server-reported counters, never
// from an in-process estimate. Only *deltas* between two snapshots are
// meaningful: absolute `calls` includes every command since server start.

/**
 * Parse a `commandstats` section string into per-command totals.
 *
 * Returns an object keyed by command name, each value:
 *   { calls, usec, rejectedCalls?, failedCalls? }
 *
 * An absent or malformed section yields an empty object rather than throwing,
 * because scraping the wrong Redis instance is a plausible operator error.
 */
export function parseCommandStats(section) {
  const result = {};
  if (typeof section !== 'string' || section.trim() === '') {
    return result;
  }
  const lines = section.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    // cmdstat_<name>:calls=...,usec=...,usec_per_call=...,rejected_calls=...,failed_calls=...
    const m = line.match(/^cmdstat_([^:]+):(.*)$/);
    if (!m) continue;
    const name = m[1];
    const rest = m[2];
    const fields = {};
    for (const part of rest.split(',')) {
      const kv = part.split('=');
      if (kv.length !== 2) continue;
      const k = kv[0].trim();
      const v = Number(kv[1]);
      if (!Number.isFinite(v)) continue;
      fields[k] = v;
    }
    if (!('calls' in fields) || !('usec' in fields)) continue;
    const entry = { calls: fields.calls, usec: fields.usec };
    if ('rejected_calls' in fields) entry.rejectedCalls = fields.rejected_calls;
    if ('failed_calls' in fields) entry.failedCalls = fields.failed_calls;
    result[name] = entry;
  }
  return result;
}

/**
 * Per-command deltas between two snapshots.
 */
export function deltaCommandStats(before, after) {
  const result = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const b = (before && before[key]) || { calls: 0, usec: 0 };
    const a = (after && after[key]) || { calls: 0, usec: 0 };
    result[key] = {
      calls: a.calls - b.calls,
      usec: a.usec - b.usec,
    };
    if (a.rejectedCalls !== undefined || b.rejectedCalls !== undefined) {
      result[key].rejectedCalls = (a.rejectedCalls || 0) - (b.rejectedCalls || 0);
    }
    if (a.failedCalls !== undefined || b.failedCalls !== undefined) {
      result[key].failedCalls = (a.failedCalls || 0) - (b.failedCalls || 0);
    }
  }
  return result;
}

/**
 * Report per-request cost: deltas divided by the throttled request count.
 *
 * If requestCount is 0, the ratio is omitted (no Infinity) and the count is
 * still stated so the reader can see there was no throttled traffic.
 */
export function reportCommandStats(delta, requestCount) {
  const report = {
    requestCount,
    perCommand: {},
  };
  if (requestCount > 0) {
    report.perRequestCost = {};
    for (const [cmd, d] of Object.entries(delta || {})) {
      report.perCommand[cmd] = d;
      report.perRequestCost[cmd] = {
        calls: d.calls / requestCount,
        usec: d.usec / requestCount,
      };
    }
  } else {
    for (const [cmd, d] of Object.entries(delta || {})) {
      report.perCommand[cmd] = d;
    }
  }
  return report;
}

export default { parseCommandStats, deltaCommandStats, reportCommandStats };