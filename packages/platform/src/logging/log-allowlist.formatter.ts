import { LOG_FIELD_ALLOWLIST_SET } from './log-allowlist.js';
import { toErrorCode } from './error-codes.js';

/**
 * `log` — the rebuild hook wired into pino's `formatters.log`.
 *
 * ## Why this is the hook, and not a destination stream
 *
 * D-15 as originally worded specified "a pino custom destination stream that
 * parses each record … immediately before `JSON.stringify`". That mechanism is
 * **not implementable**: a pino destination receives already-serialised bytes
 * (`hooks.streamWrite` is documented as receiving "the stringified JSON"), so a
 * destination can only ever filter *after* the bytes exist. RESEARCH blocker
 * B-1 records the correction — `formatters.log` is the hook whose return value
 * *is* the object that gets serialised. This is a mechanism correction, not a
 * reversal of D-15's intent: "before serialisation" and "unknown keys stripped"
 * both hold here and cannot hold at a destination.
 *
 * Verified in the installed source rather than the docs alone:
 * `node_modules/pino/lib/tools.js` `_asJson` runs `obj = formatters.log(obj)`
 * *before* the `for (const key in obj)` stringification loop, and concatenates
 * the formatter's output into the emitted line.
 *
 * ## Rebuild, do not prune
 *
 * The hook allocates a fresh object and copies only allowlisted keys. It never
 * walks the input looking for bad values, which is what makes it structurally
 * immune to the three cases the type system cannot help with:
 *
 *  1. a key computed at runtime (`record[userInput]`) — it is not on the list;
 *  2. a forbidden value nested two or three levels deep under a non-allowlisted
 *     container (`context.user.email`) — the whole container is not copied;
 *  3. an `err.cause` chain holding a downstream HTTP body — `err` is not on the
 *     list, and is additionally *replaced* by an enum-valued `error_code`.
 *
 * ## Values are primitives only
 *
 * An allowlisted key with an object value would reopen case 2 through a
 * different door: `reason: { detail: { email } }` is "allowlisted" by key and
 * would serialise the whole subtree. No field in D-16 is defined to hold a
 * composite value, so the hook drops any non-primitive allowlisted value rather
 * than trusting the caller. This is stricter than the allowlist alone and is
 * the reason the depth guarantee is total.
 */
const isLoggableValue = (value: unknown): boolean => {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      // A non-finite number would serialise as `null` in JSON, inventing a
      // value the caller never set. Drop it instead.
      return Number.isFinite(value);
    default:
      return false;
  }
};

/**
 * Rebuild one log record down to the allowlist. **Pure**: the input is only read
 * and a new object is returned, so the same input always yields the same output
 * and no caller's object is mutated.
 *
 * @param object the merged log object pino hands to `formatters.log`
 * @returns a fresh object containing only allowlisted keys with primitive values
 */
export const log = (object: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(object)) {
    if (!LOG_FIELD_ALLOWLIST_SET.has(key)) continue;

    const value = object[key];
    if (key === 'error_code') {
      // D-16 calls this field a closed enum. Normalising here is what makes
      // that true: the key is allowlisted, so a caller *could* otherwise put an
      // arbitrary string in it and the gate would pass it through.
      out.error_code = toErrorCode(value);
      continue;
    }
    if (isLoggableValue(value)) out[key] = value;
  }

  // `err` is never on the allowlist, so the copy loop above already dropped it.
  // This line exists to make the *replacement* explicit: an error becomes a
  // closed-enum `error_code`, and the object, its message, and its `cause`
  // chain stop here rather than being serialised and filtered downstream.
  if (object.err !== undefined) {
    out.error_code = toErrorCode(object.err);
  }

  return out;
};
