/**
 * Onboarding: the documented boot path, proven by booting it (UAT gap G1).
 *
 * ## The defect this file exists to prevent
 *
 * UAT test 1 booted the three processes successfully and then failed the same
 * test on the sentence that matters: *a developer can start the three processes
 * from a clean checkout using only the project's own documented instructions.*
 * There were none. Booting required reverse-engineering six environment
 * variables out of `config.schema.ts` and `redis.schema.ts`, including one that
 * names a file of exactly 32 bytes.
 *
 * A `.env.example` and a `README.md` do not fix that by existing. They fix it by
 * being **executed**: this file parses the example file, builds a child
 * environment out of it, spawns the real `api` entrypoint, and asserts against
 * the process it actually started. Every assertion below therefore fails if the
 * documentation stops matching the code, which is the only kind of documentation
 * that stays true.
 *
 * ## Why every child environment is constructed and never inherited
 *
 * `spawn(env)` with `env: { ...process.env }` would make a red test mean nothing:
 * the operator's shell, the CI runner and Vitest's own `setupFiles` would all be
 * able to decide what a boot under test sees. Every boot here builds its
 * environment from the example file plus an explicit list of substitutions. The
 * consequences are load-bearing and each one has a trap behind it:
 *
 * - **The key file is provisioned here.** `CryptoModule`'s factory constructs the
 *   provider *eagerly* and throws `LOCAL_KEY_FILE_MISSING:` when
 *   `CRYPTO_LOCAL_KEY_FILE` names an absent file. The documented value is
 *   `./.dev-local-key`, which is gitignored and therefore legitimately absent on
 *   a fresh checkout — so a spec that used the documented path verbatim would
 *   fail on setup instead of on the property under test.
 * - **`NODE_ENV` is set on every boot.** Vitest sets `NODE_ENV=test` and
 *   `setupFiles` seeds `process.env`; inheriting either would make the boot
 *   contract under test whatever the runner happened to export.
 * - **`PORT` is absent unless a boot overrides it**, so the documented default
 *   per `SERVICE_NAME` is what actually gets exercised.
 * - **`OTEL_EXPORTER_OTLP_ENDPOINT` is absent.** There is no collector in this
 *   file, and an inherited endpoint would put export failures into the signal.
 *
 * ## Why `urls.mongo` is taken verbatim
 *
 * `tooling/containers.ts` starts MongoDB with `--replSet rs0`, so the server
 * advertises its container hostname as the replica-set member and the driver
 * cannot resolve it from the host. `mongoUrl()` therefore appends
 * `?directConnection=true` and `urls.mongo` **already carries it**. Substituting
 * the harness URL means taking it as it is; stripping the parameter, or copying
 * the documented URL and "fixing" it, breaks every boot in this file.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  APP_CONFIG_KEYS,
  CORE_HEALTH_INDICATOR_KEYS,
  DEFAULT_PORT_BY_SERVICE,
} from '@akane/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startThreeContainers, type ThreeContainers } from './containers.js';

/**
 * The repository's own container specs set `300_000` on both hooks because the
 * global `hookTimeout` is 30000 and a three-container teardown can exceed it on a
 * loaded machine (01-07). A teardown that times out reports the file as failed
 * while every assertion passed, which trains a reader to ignore the failure
 * rather than look at it.
 */
const HOOK_TIMEOUT = 300_000;

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, '.env.example');
/** Absolute because a later boot moves `cwd`; the npm scripts pass the same two files relatively. */
const API_MAIN = path.join(REPO_ROOT, 'apps', 'api', 'dist', 'main.js');
const API_OTEL_LOADER = path.join(REPO_ROOT, 'apps', 'api', 'otel.mjs');

/** Every active line in the example file is a shell assignment with a non-empty value. */
const ACTIVE_LINE = /^[A-Z0-9_]+=\S+$/;
/** The same shape, applied to a comment body so a documented key counts as present. */
const ASSIGNMENT = /^([A-Z0-9_]+)=(.*)$/;

/**
 * 32 bytes of key material in a temporary directory.
 *
 * `LocalKeyProvider` requires a file of exactly that length, and the file must
 * not be the documented `./.dev-local-key` — that path is gitignored, so it is
 * absent on a fresh checkout and a spec that relied on it would fail on setup.
 */
const KEY_DIR = mkdtempSync(path.join(os.tmpdir(), 'akane-onboarding-'));
const KEY_FILE = path.join(KEY_DIR, 'dev-local-key');
writeFileSync(KEY_FILE, randomBytes(32));

afterAll(() => {
  rmSync(KEY_DIR, { recursive: true, force: true });
});

interface EnvExample {
  /** Key → value for every line that is an actual assignment. */
  readonly active: ReadonlyMap<string, string>;
  /** Every key the file names, active or commented. */
  readonly documented: ReadonlySet<string>;
  readonly raw: string;
}

/**
 * Parse `.env.example`.
 *
 * A commented key counts as **documented** but not **active**, which is the
 * distinction the whole file turns on: `SERVICE_NAME` is present so a reader can
 * discover it, and inactive so a reader who forgets it gets a named
 * `CONFIG_INVALID: SERVICE_NAME` rather than a default.
 */
function parseEnvExample(): EnvExample {
  const raw = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  const active = new Map<string, string>();
  const documented = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const commented = /^\s*#/.test(line);
    // `trim()` matters: the example file indents its commented examples
    // (`#   SERVICE_NAME=api`), and an untrimmed body leaves whitespace in front
    // of the key, so the assignment pattern matches nothing.
    const body = (commented ? line.replace(/^\s*#+/, '') : line).trim();
    const match = ASSIGNMENT.exec(body);
    if (match === null) continue;
    const key = match[1] ?? '';
    const value = match[2] ?? '';
    documented.add(key);
    if (!commented) active.set(key, value);
  }

  return { active, documented, raw };
}

const ENV_EXAMPLE = parseEnvExample();

/**
 * A child environment with nothing inherited.
 *
 * `PATH` and `HOME` are named rather than spread because some transitive
 * dependency may read one of them; everything else the operator's shell carries —
 * `NODE_ENV`, `PORT`, `MONGO_URL`, `CRYPTO_LOCAL_KEY_ALLOWED` — is absent by
 * construction, which is what makes a red assertion about a boot trustworthy.
 */
function childEnv(overrides: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env['HOME'] ?? os.homedir(),
    ...overrides,
  };
}

/** `.env.example`'s active lines as a plain object — the documented boot environment. */
function exampleActiveEnv(): Record<string, string> {
  return Object.fromEntries(ENV_EXAMPLE.active);
}

interface BootedApi {
  /** stdout and stderr, interleaved as they arrived. */
  readonly output: () => string;
  readonly hasExited: () => boolean;
  readonly exitCode: () => number | null;
  readonly exited: Promise<number | null>;
  stop(): Promise<void>;
}

/**
 * Spawn the real `api` entrypoint — the same two files `npm run start:api` runs,
 * with an explicitly constructed environment.
 *
 * Nothing here is mocked. A schema assertion proves the validator agrees with
 * itself; only this proves the process a developer would actually start does the
 * thing the README says it does.
 */
function startApi(
  env: Record<string, string>,
  options: { readonly cwd?: string } = {},
): BootedApi {
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', API_OTEL_LOADER, API_MAIN],
    {
      cwd: options.cwd ?? REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  const collect = (stream: Readable | null): void => {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      output += chunk;
    });
  };
  collect(child.stdout);
  collect(child.stderr);

  let settled = false;
  let code: number | null = null;
  const exited = new Promise<number | null>((resolve) => {
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      code = value;
      resolve(value);
    };
    // `error` fires when the process cannot be spawned at all; resolving rather
    // than rejecting keeps every caller's teardown path uniform.
    child.on('error', () => finish(null));
    child.on('close', (value) => finish(value));
  });

  return {
    output: () => output,
    hasExited: () => settled,
    exitCode: () => code,
    exited,
    async stop(): Promise<void> {
      if (settled) return;
      // SIGTERM first because that is the graceful path the platform implements
      // (`enableShutdownHooks` + an OTel flush); SIGKILL only if it ignores that.
      child.kill('SIGTERM');
      const escalation = setTimeout(() => child.kill('SIGKILL'), 15_000);
      escalation.unref();
      await exited;
      clearTimeout(escalation);
    },
  };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  attempts: number,
  intervalMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Boot an api process and wait until it answers `/health/live`, or fail loudly. */
async function bootUntilLive(
  env: Record<string, string>,
  port: number,
  options: { readonly cwd?: string } = {},
): Promise<BootedApi> {
  const api = startApi(env, options);
  // 120 × 500 ms. Generous on purpose: this file starts three containers and
  // boots several real processes, so the machine is not idle when a boot runs,
  // and loading Nest + the instrumented drivers on a loaded host has been
  // measured at ~18 s against ~0.3 s on an idle one. A budget tuned to the idle
  // number reports a slow machine as a broken entrypoint.
  const alive = await waitFor(
    async () => {
      if (api.hasExited()) return false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health/live`);
        const body = (await response.json()) as { status?: string };
        return response.status === 200 && body.status === 'ok';
      } catch {
        return false;
      }
    },
    120,
    500,
  );
  if (!alive) {
    const output = api.output();
    const code = api.exitCode();
    await api.stop();
    throw new Error(
      `the api process never answered /health/live on port ${port} (exit code ${code}):\n${output}`,
    );
  }
  return api;
}

/** `GET /health/ready`, or `undefined` if the process could not be reached. */
async function readReady(
  port: number,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> } | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body };
  } catch {
    return undefined;
  }
}

/** The `info`/`error` map terminus returns, narrowed to per-dependency statuses. */
function dependencyStatuses(
  ready: { readonly body: Record<string, unknown> },
): Record<string, string | undefined> {
  const source = (ready.body['info'] as Record<string, unknown> | undefined) ?? {};
  const statuses: Record<string, string | undefined> = {};
  for (const key of [...CORE_HEALTH_INDICATOR_KEYS]) {
    const entry = source[key] as { status?: string } | undefined;
    statuses[key] = entry?.status;
  }
  return statuses;
}

describe('.env.example — the boot contract, asserted against the schema', () => {
  it('names every key APP_CONFIG_KEYS declares, plus CRYPTO_LOCAL_KEY_FILE', () => {
    const missing = [...APP_CONFIG_KEYS, 'CRYPTO_LOCAL_KEY_FILE'].filter(
      (key) => !ENV_EXAMPLE.documented.has(key),
    );
    expect(missing, 'a boot key is not written down in .env.example').toEqual([]);
  });

  it('enumerates the schema keys and nothing invented alongside them', () => {
    // Key-set parity in both directions. Forward-only would let a key be
    // deleted from the schema and left behind in the example file, where a
    // reader would set a variable no boot reads.
    const declared = new Set<string>([...APP_CONFIG_KEYS, 'CRYPTO_LOCAL_KEY_FILE']);
    const invented = [...ENV_EXAMPLE.documented].filter((key) => !declared.has(key));
    expect(invented, '.env.example documents a variable no boot contract declares').toEqual([]);
  });

  it('makes every active line a shell assignment with a non-empty value', () => {
    const activeLines = ENV_EXAMPLE.raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0 && !/^\s*#/.test(line));
    expect(activeLines.length).toBeGreaterThan(0);
    expect(
      activeLines.filter((line) => !ACTIVE_LINE.test(line)),
      'an active line is not `KEY=value` with no spaces — `. ./.env.example` would break',
    ).toEqual([]);
    for (const [, value] of ENV_EXAMPLE.active) {
      expect(value.trim(), 'an active key has an empty value').not.toBe('');
    }
  });

  it('documents SERVICE_NAME without activating it, so the file fails closed', () => {
    // T-1-31. `SERVICE_NAME` is what derives the default port, so defaulting it
    // would let a second process silently contend for the api's port 3000 and
    // read the wrong process's health endpoint. Leaving it commented means the
    // mistake surfaces as a named boot error instead.
    expect(ENV_EXAMPLE.documented.has('SERVICE_NAME')).toBe(true);
    expect(ENV_EXAMPLE.active.has('SERVICE_NAME')).toBe(false);
  });

  it('keeps NODE_ENV active, never a comment (T-1-27)', () => {
    // `NODE_ENV` has no default precisely so a production container that never
    // declared its environment cannot inherit developer behaviour. A commented
    // NODE_ENV here would put that guard one keystroke away from being off.
    expect(ENV_EXAMPLE.active.get('NODE_ENV')).toBe('development');
  });

  it('carries the key file path and never key material (P1, T-1-25)', () => {
    expect(ENV_EXAMPLE.active.get('CRYPTO_LOCAL_KEY_FILE')).toBe('./.dev-local-key');
    // 32 raw bytes is the requirement, so a leak looks like hex, base64 or a
    // long opaque literal. Any active value of that shape is a secret in a
    // committed file.
    const KEY_MATERIAL = /^([0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{44})$/;
    const leaking = [...ENV_EXAMPLE.active].filter(([, value]) => KEY_MATERIAL.test(value));
    expect(leaking, '.env.example must hold a path, never a key value').toEqual([]);
  });

  it('never names CRYPTO_LOCAL_KEY_ALLOWED (P2, T-1-30)', () => {
    // It is a deliberate operator override of a fail-closed guard. An
    // onboarding file is exactly where it would get adopted by someone who does
    // not know what it disables. Scoped to this file on purpose: a README that
    // explains *why* the override is dangerous must still be able to say so.
    expect(ENV_EXAMPLE.raw).not.toContain('CRYPTO_LOCAL_KEY_ALLOWED');
  });
});

describe('.env.example — booting a real api process', () => {
  let containers: ThreeContainers;
  const booted: BootedApi[] = [];

  const boot = async (
    env: Record<string, string>,
    port: number,
    options: { readonly cwd?: string } = {},
  ): Promise<BootedApi> => {
    const api = await bootUntilLive(env, port, options);
    booted.push(api);
    return api;
  };

  beforeAll(async () => {
    containers = await startThreeContainers();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const api of booted) {
      await api.stop();
    }
    await containers?.stop();
  }, HOOK_TIMEOUT);

  it('boots an api process and reports every core dependency up', async () => {
    const env = childEnv({
      ...exampleActiveEnv(),
      // The three URLs become the harness's, taken verbatim — `urls.mongo`
      // already carries `directConnection=true` and must not be stripped.
      MONGO_URL: containers.urls.mongo,
      REDIS_CACHE_URL: containers.urls.cache,
      REDIS_QUEUE_URL: containers.urls.queue,
      CRYPTO_LOCAL_KEY_FILE: KEY_FILE,
      SERVICE_NAME: 'api',
    });

    // No PORT in the constructed environment, so the derived default for `api`
    // is what runs — exactly as the README instructs. Read from the schema
    // rather than written as a literal so the spec tracks the port table.
    const api = await boot(env, DEFAULT_PORT_BY_SERVICE.api);

    const live = await (
      await fetch(`http://127.0.0.1:${DEFAULT_PORT_BY_SERVICE.api}/health/live`)
    ).json();
    expect(live, '/health/live must answer a fixed ok literal').toEqual({ status: 'ok' });

    const ready = await readReady(DEFAULT_PORT_BY_SERVICE.api);
    expect(ready, '/health/ready must answer').toBeDefined();
    expect(ready?.status).toBe(200);
    // All three, each named — the shape D-10 requires of a ready process.
    const statuses = dependencyStatuses(ready ?? { body: {} });
    expect(Object.keys(statuses)).toEqual([...CORE_HEALTH_INDICATOR_KEYS]);
    expect(statuses).toEqual(
      Object.fromEntries([...CORE_HEALTH_INDICATOR_KEYS].map((key) => [key, 'up'])),
    );

    await api.stop();
  }, 300_000);

  it('refuses the same file unmodified with a named CONFIG_INVALID: SERVICE_NAME', async () => {
    // T-1-31 end to end. Nothing is removed from the environment to set this up:
    // the shipped file simply does not activate `SERVICE_NAME`, so booting it as
    // written is already missing exactly that one key.
    const env = childEnv(exampleActiveEnv());

    const api = startApi(env);
    const code = await api.exited;

    expect(code, 'the boot must fail — this is the fail-closed path').not.toBe(0);
    expect(api.output()).toContain('CONFIG_INVALID: SERVICE_NAME');
  }, 300_000);

  it('refuses a production boot on a local key before reading the key file (T-1-27)', async () => {
    const env = childEnv({
      ...exampleActiveEnv(),
      NODE_ENV: 'production',
      CRYPTO_LOCAL_KEY_FILE: KEY_FILE,
      SERVICE_NAME: 'api',
    });

    const api = startApi(env);
    const code = await api.exited;

    expect(code).not.toBe(0);
    // The guard runs before the provider is constructed, so a production
    // process never loads a key it was about to be refused for holding.
    expect(api.output()).toContain('CRYPTO_KEY_PROVIDER_REQUIRED:');
    expect(api.output()).not.toContain('LOCAL_KEY_FILE_MISSING');
  }, 300_000);
});