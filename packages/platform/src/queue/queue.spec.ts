import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BULLMQ_PREFIX } from './queue.constants.js';
import { PLATFORM_HEARTBEAT_QUEUE } from './queue.module.js';
import {
  blockingConnectionOptions,
  producerConnectionOptions,
  PRODUCER_MAX_RETRIES_PER_REQUEST,
  QUEUE_KEY_SUFFIXES,
  queueKeyNames,
  queueRootOptions,
} from './queue.provider.js';

/**
 * The queue namespace and the two connection profiles, asserted without Redis
 * (D-14, T-1-19, T-1-20, RESEARCH A7).
 *
 * Nothing here needs a live server because none of the claims are about
 * behaviour: they are about *values* that decide, once, where every live queue
 * key will live and whether a request-path producer fails fast or hangs. A live
 * cluster would exercise the same three numbers more slowly.
 *
 * What this file deliberately does **not** claim is that `queueKeyNames`
 * mirrors BullMQ. It mirrors BullMQ's documented key layout so the hash tag can
 * be checked over the whole layout here, and `queue.integration.spec.ts` asserts
 * those names against a live `Queue` so the mirror cannot drift.
 */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const QUEUE_URL = 'redis://queue.internal:6379';

describe('BullMQ root options (D-14)', () => {
  it('namespaces every queue under the {akane-q} hash tag', () => {
    const options = queueRootOptions(QUEUE_URL);

    expect(options.prefix).toBe('{akane-q}');
    // Asserted against the constant rather than a literal, so renaming
    // `BULLMQ_PREFIX` cannot leave a second literal asserting the old value.
    expect(options.prefix).toBe(BULLMQ_PREFIX);
  });

  it('produces only hash-tagged key names across the whole queue layout', () => {
    const names = queueKeyNames(PLATFORM_HEARTBEAT_QUEUE);

    // Every layout entry, not a hand-picked sample: the tag is what pins a key
    // to one cluster slot, so one missing tag is one key whose Lua script can
    // straddle a node boundary.
    expect(names).toHaveLength(QUEUE_KEY_SUFFIXES.length);
    for (const name of names) {
      expect(name).toContain('{akane-q}');
      expect(name.startsWith('{akane-q}:platform-heartbeat:')).toBe(true);
    }
  });

  it('builds key names from a caller-supplied prefix the same way', () => {
    // A prefix without a hash tag would spread the layout across cluster slots.
    // The assertion is that the *composition* is prefix-first and therefore
    // whatever prefix is configured lands in the same position Redis looks at.
    expect(queueKeyNames('q', 'bull')).toEqual([
      'bull:q:',
      'bull:q:active',
      'bull:q:wait',
      'bull:q:waiting-children',
      'bull:q:paused',
      'bull:q:id',
      'bull:q:delayed',
      'bull:q:prioritized',
      'bull:q:stalled-check',
      'bull:q:completed',
      'bull:q:failed',
      'bull:q:stalled',
      'bull:q:repeat',
      'bull:q:limiter',
      'bull:q:meta',
      'bull:q:events',
      'bull:q:pc',
      'bull:q:marker',
      'bull:q:de',
    ]);
  });

  it('points the queue at the queue deployment URL, unmodified', () => {
    expect(queueRootOptions(QUEUE_URL).connection.url).toBe(QUEUE_URL);
  });
});

describe('connection profiles (D-14, T-1-19)', () => {
  it('gives the request-path producer a finite retry budget', () => {
    const options = producerConnectionOptions(QUEUE_URL);

    expect(options.maxRetriesPerRequest).toBe(PRODUCER_MAX_RETRIES_PER_REQUEST);
    // The band is D-14's, not "whatever the default is": ioredis defaults to 20
    // retries, which on a down Redis turns a request handler into a hang long
    // before it becomes an error.
    expect(options.maxRetriesPerRequest).not.toBeNull();
    expect(options.maxRetriesPerRequest as number).toBeGreaterThanOrEqual(1);
    expect(options.maxRetriesPerRequest as number).toBeLessThanOrEqual(3);
  });

  it('gives the worker blocking connection exactly null', () => {
    // `not.toBe(0)` / `not.toBe(false)` would both pass here, and BullMQ's
    // check is truthiness-based, so only `toBeNull()` states the requirement.
    expect(blockingConnectionOptions(QUEUE_URL).maxRetriesPerRequest).toBeNull();
    expect(blockingConnectionOptions(QUEUE_URL).url).toBe(QUEUE_URL);
  });
});

describe('no second prefixing layer (D-14, T-1-20)', () => {
  it('sets no keyPrefix on either connection profile', () => {
    for (const options of [
      producerConnectionOptions(QUEUE_URL),
      blockingConnectionOptions(QUEUE_URL),
    ]) {
      expect(Object.keys(options)).not.toContain('keyPrefix');
      expect('keyPrefix' in options).toBe(false);
    }
  });

  it('sets no keyPrefix at any call site in the repository source', () => {
    // Read as text over every non-spec source file. Asserted against the
    // *source*, not against a constructed client, because ioredis normalises an
    // empty keyPrefix into `client.options` whether or not the caller set it —
    // a client-side assertion passes vacuously (01-07's lesson, applied forward).
    //
    // The pattern is a property position (`,`/`:`/`=`) after the bare word, so
    // shorthand `{ keyPrefix }`, `keyPrefix: x` and `opts.keyPrefix = x` all
    // match while a bare mention does not.
    const forbidden = /\bkeyPrefix\b\s*[:,=]/;
    const offenders = sourceFiles(REPO_ROOT)
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) => forbidden.test(stripComments(readFileSync(file, 'utf8'))));

    expect(offenders).toEqual([]);
  });
});

/**
 * Comments cannot set a property, so they are removed before the scan.
 *
 * Without this, documentation that legitimately *shows* the forbidden form —
 * `redis.provider.ts` writes it inside a docblock to explain precisely why a
 * client-side assertion is worthless — reads as a violation, and the only ways
 * out are to weaken the guard or to mangle the explanation.
 *
 * A `//` is treated as a comment only when whitespace precedes it, so a
 * `redis://` URL inside a string literal survives; that is the one line-comment
 * shape that appears as live code in this repository.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

// Every `.ts` file under each workspace's `src` directory, specs included.
function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const area of ['packages', 'apps']) {
    for (const workspace of readdirSync(join(root, area))) {
      walk(join(root, area, workspace, 'src'));
    }
  }
  return found;

  function walk(directory: string): void {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (path.endsWith('.ts')) {
        found.push(relative(root, path));
      }
    }
  }
}