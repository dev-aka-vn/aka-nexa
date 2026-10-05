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
import { createServer, type Server } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  APP_CONFIG_KEYS,
  CORE_HEALTH_INDICATOR_KEYS,
  DEFAULT_PORT_BY_SERVICE,
  SERVICE_NAMES,
} from '@akane/platform';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  CACHE_MAXMEMORY_POLICY,
  MONGO_IMAGE,
  QUEUE_MAXMEMORY_POLICY,
  REDIS_IMAGE,
  mongoUrl,
  startThreeContainers,
  type ThreeContainers,
} from './containers.js';

/**
 * ## Why `yaml` is imported without being declared in `package.json`
 *
 * T-1-SC forbids a new package and a manifest change here, so the compose file
 * is read with a parser already present in the committed lockfile:
 * `yaml@2.9.1` arrives as a **production** transitive of
 * `@opentelemetry/configuration`, itself a direct root dependency via
 * `@opentelemetry/sdk-node`. `npm ci --omit=dev` installs it, and the lockfile
 * pins it with an integrity hash — which is the "already pinned" the threat row
 * allows.
 *
 * If that chain ever changes, the import fails loudly at test time rather than
 * silently parsing nothing, and `docker compose -f compose.dev.yml config
 * --quiet` stays an independent authority on whether the file is valid.
 */

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
const COMPOSE_PATH = path.join(REPO_ROOT, 'compose.dev.yml');
const README_PATH = path.join(REPO_ROOT, 'README.md');
const GITIGNORE_PATH = path.join(REPO_ROOT, '.gitignore');
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

/**
 * The documented boot environment with the three URLs pointed at the harness.
 *
 * The container URLs are taken **verbatim**, in particular `urls.mongo`, which
 * already carries `?directConnection=true` because `containers.ts` starts
 * MongoDB with `--replSet`. Stripping it, or copying the documented URL and
 * "fixing" it, breaks every boot below.
 */
function containerEnv(containers: ThreeContainers): Record<string, string> {
  return childEnv({
    ...exampleActiveEnv(),
    MONGO_URL: containers.urls.mongo,
    REDIS_CACHE_URL: containers.urls.cache,
    REDIS_QUEUE_URL: containers.urls.queue,
    CRYPTO_LOCAL_KEY_FILE: KEY_FILE,
    SERVICE_NAME: 'api',
  });
}

interface ComposeService {
  readonly image?: string;
  readonly command?: readonly string[];
  readonly ports?: readonly string[];
}

interface ComposeFile {
  readonly services: Readonly<Record<string, ComposeService>>;
}

/**
 * Parse `compose.dev.yml`. Throws on invalid YAML, which is itself the "is it
 * valid YAML" assertion.
 */
function readComposeFile(): ComposeFile {
  return parseYaml(readFileSync(COMPOSE_PATH, 'utf8')) as ComposeFile;
}

/**
 * A published port, split out of the `HOST_IP:PUBLISHED:TARGET` short form.
 *
 * Only the three-part string form is accepted. Compose also accepts a bare
 * `PUBLISHED` and a long object form, both of which can leave the host IP
 * unpinned — so a port entry that drops the loopback host fails this parse
 * rather than quietly publishing on every interface (P4).
 */
function publishedPort(entry: string): {
  readonly hostIp: string;
  readonly published: string;
  readonly target: string;
} {
  const parts = entry.split(':');
  if (parts.length !== 3) {
    throw new Error(
      `compose port "${entry}" is not HOST_IP:PUBLISHED:TARGET — an unpinned host IP publishes on every interface`,
    );
  }
  return { hostIp: parts[0] ?? '', published: parts[1] ?? '', target: parts[2] ?? '' };
}

/** The `--maxmemory-policy <value>` a service's command actually passes. */
function maxMemoryPolicy(service: ComposeService): string | undefined {
  const command = service.command ?? [];
  const index = command.indexOf('--maxmemory-policy');
  return index === -1 ? undefined : command[index + 1];
}

/** The `host:port` a service publishes, from its first published port. */
function publishedAddress(service: ComposeService): string {
  const first = (service.ports ?? [])[0];
  if (first === undefined) {
    throw new Error('compose service publishes no port');
  }
  const { hostIp, published } = publishedPort(first);
  return `${hostIp}:${published}`;
}

/** `*` and `?` globs, nothing more. Only used against this repository's patterns. */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (const character of glob) {
    if (character === '*') source += '.*';
    else if (character === '?') source += '.';
    else source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/**
 * Whether a path is ignored by `.gitignore`, applying git's last-match-wins rule.
 *
 * A deliberately small subset of git's glob grammar. Being a general
 * implementation is not the point; deriving the "is the local key file
 * committable" answer from the file rather than asserting it about the file is.
 */
function isIgnored(candidate: string): boolean {
  const patterns = readFileSync(GITIGNORE_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  let ignored = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const body = (negated ? pattern.slice(1) : pattern).replace(/\/$/, '');
    // A pattern containing an interior `/` is anchored to the .gitignore's
    // directory; otherwise it matches at any depth, i.e. against the basename.
    const anchored = body.slice(0, -1).includes('/');
    const glob = anchored ? body.replace(/^\//, '') : (body.split('/').pop() ?? body);
    const subject = anchored ? candidate : (candidate.split('/').pop() ?? candidate);
    if (globToRegExp(glob).test(subject)) ignored = !negated;
  }
  return ignored;
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

  it('boots against the harness Mongo URL, which carries the parameter the documented one must not (P6)', () => {
    // The other half of the P6 asymmetry, against the value the boots below
    // actually use rather than a literal restated here. `containers.ts` starts
    // MongoDB with `--replSet`, so `mongoUrl()` compensates. The static compose
    // block asserts the documented URL carries no such parameter; together the
    // two stop the workaround from being "harmonised" into either side.
    const harnessUrl = new URL(containers.urls.mongo);
    expect(harnessUrl.searchParams.get('directConnection')).toBe('true');
  });

  it('boots an api process and reports every core dependency up', async () => {
    // No PORT in the constructed environment, so the derived default for `api`
    // is what runs — exactly as the README instructs. Read from the schema
    // rather than written as a literal so the spec tracks the port table.
    const api = await boot(containerEnv(containers), DEFAULT_PORT_BY_SERVICE.api);

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

  it('ignores a .env file in the working directory — config comes from the environment', async () => {
    // The README states that no `.env` file is read. Asserting the sentence
    // would only assert the prose; this boots a real process with a decoy
    // `.env` in its `cwd` pointing at a port nothing is listening on, and
    // requires readiness to still report `mongo: up`. If anyone ever adds a
    // `.env` loader to `ConfigModule`, this goes red and the README has to
    // change with it.
    const decoyDir = mkdtempSync(path.join(os.tmpdir(), 'akane-decoy-'));
    writeFileSync(
      path.join(decoyDir, '.env'),
      'MONGO_URL=mongodb://127.0.0.1:1/nowhere-listening\n',
    );

    const api = await boot(containerEnv(containers), DEFAULT_PORT_BY_SERVICE.api, {
      cwd: decoyDir,
    });

    const ready = await readReady(DEFAULT_PORT_BY_SERVICE.api);
    expect(ready, '/health/ready must answer with a decoy .env in cwd').toBeDefined();
    expect(dependencyStatuses(ready ?? { body: {} }).mongo).toBe('up');

    await api.stop();
    rmSync(decoyDir, { recursive: true, force: true });
  }, 300_000);
});

describe('compose.dev.yml — the local Mongo + two-Redis topology', () => {
  it('parses as YAML and defines exactly the three services the platform needs', () => {
    const compose = readComposeFile();
    expect(Object.keys(compose.services).sort()).toEqual(
      ['mongo', 'redis-cache', 'redis-queue'].sort(),
    );
  });

  it('pins the same images the test harness runs against', () => {
    // Asserted against the exported constants rather than string literals: that
    // is what stops the documented topology drifting from the topology the rest
    // of the suite runs against, the same two-source agreement idiom
    // `toolchain-pin.spec.ts` uses for `.nvmrc` and `engines.node`.
    const { services } = readComposeFile();
    expect(services['mongo']?.image).toBe(MONGO_IMAGE);
    expect(services['redis-cache']?.image).toBe(REDIS_IMAGE);
    expect(services['redis-queue']?.image).toBe(REDIS_IMAGE);
  });

  it('gives the cache tier an evicting policy and the queue tier noeviction (T-1-29)', () => {
    // `maxmemory-policy` is instance-wide, so a single Redis — or two roles on one
    // instance — would silently evict in-flight job state, which is the D-12
    // defect this phase exists to prevent reappearing in the documented
    // topology.
    const { services } = readComposeFile();
    const cache = maxMemoryPolicy(services['redis-cache'] ?? {});
    const queue = maxMemoryPolicy(services['redis-queue'] ?? {});

    expect(cache).toBe(CACHE_MAXMEMORY_POLICY);
    expect(queue).toBe(QUEUE_MAXMEMORY_POLICY);
    expect(cache).not.toBe(queue);
  });

  it('publishes the two Redis deployments to different host ports', () => {
    // The host port differs while the container port does not, and that
    // difference is exactly what `refineRedisInstancesDistinct` compares.
    const { services } = readComposeFile();
    const cache = publishedPort((services['redis-cache']?.ports ?? [])[0] ?? '');
    const queue = publishedPort((services['redis-queue']?.ports ?? [])[0] ?? '');

    expect(cache.published).not.toBe(queue.published);
    expect(cache.target).toBe(queue.target);
    // And the two URLs the boot schema would build from these ports must pass
    // its own distinctness rule, rather than the plan asserting a topology the
    // validator would reject.
    const cacheUrl = new URL(ENV_EXAMPLE.active.get('REDIS_CACHE_URL') ?? '');
    const queueUrl = new URL(ENV_EXAMPLE.active.get('REDIS_QUEUE_URL') ?? '');
    expect(cacheUrl.host).not.toBe(queueUrl.host);
  });

  it('binds every published port to 127.0.0.1 and nothing else (P4, T-1-28)', () => {
    const { services } = readComposeFile();
    const bindings = Object.entries(services).flatMap(([name, service]) =>
      (service.ports ?? []).map((entry) => ({
        name,
        ...publishedPort(entry),
      })),
    );
    expect(bindings.length, 'compose file publishes no ports at all').toBeGreaterThan(0);
    for (const binding of bindings) {
      expect(binding.hostIp, `${binding.name} must publish on loopback only`).toBe('127.0.0.1');
    }
    // The literal form, because "no 0.0.0.0 anywhere" is the property and the
    // structured check above only sees the entries it managed to parse.
    expect(readFileSync(COMPOSE_PATH, 'utf8')).not.toContain('0.0.0.0');
  });

  it('publishes exactly the addresses .env.example points at, so nothing needs editing', () => {
    const { services } = readComposeFile();
    const pairs = [
      ['MONGO_URL', services['mongo']],
      ['REDIS_CACHE_URL', services['redis-cache']],
      ['REDIS_QUEUE_URL', services['redis-queue']],
    ] as const;

    for (const [key, service] of pairs) {
      const url = new URL(ENV_EXAMPLE.active.get(key) ?? '');
      expect(url.host, `${key} must match the compose published host:port`).toBe(
        publishedAddress(service ?? {}),
      );
    }
  });

  it('runs MongoDB without --replSet, so the documented MONGO_URL needs no workaround (P6)', () => {
    // The asymmetry is deliberate and asserted in both directions: the
    // documented URL must NOT carry `directConnection`, because compose's Mongo
    // is not a replica set — and the harness URL this very spec boots against
    // must, because `containers.ts` starts one. "Harmonising" either side
    // couples the file to a testcontainers quirk or breaks every boot here.
    const { services } = readComposeFile();
    const mongoCommand = (services['mongo']?.command ?? []).join(' ');
    expect(mongoCommand, 'compose mongo must not start a replica set').not.toContain('--replSet');

    const documented = new URL(ENV_EXAMPLE.active.get('MONGO_URL') ?? '');
    expect(
      documented.searchParams.has('directConnection'),
      'the documented MONGO_URL must not carry the harness workaround',
    ).toBe(false);
    expect(documented.search).toBe('');
  });
});

describe('README.md — token agreement with code-derived values', () => {
  const readme = readFileSync(README_PATH, 'utf8');

  it('names the run script for every service the schema admits', () => {
    for (const name of SERVICE_NAMES) {
      expect(readme, `the README must name the run script for ${name}`).toContain(
        `start:${name}`,
      );
    }
  });

  it('pairs every service name with its default port', () => {
    // Same line, not just both strings somewhere in the file: a README that
    // printed 3000 in one table and `api` in another would satisfy a substring
    // check while telling a reader the wrong port. A port change in
    // `config.schema.ts` therefore turns this red.
    const lines = readme.split(/\r?\n/);
    for (const [name, port] of Object.entries(DEFAULT_PORT_BY_SERVICE)) {
      const match = lines.filter(
        (line) => line.includes(name) && line.includes(String(port)),
      );
      expect(match.length, `no README line pairs ${name} with its default port ${port}`).toBeGreaterThan(0);
    }
  });

  it('names both trap remedies by the token they have in the world', () => {
    // Real tokens, not phrases invented to match this test. `EADDRINUSE` is what
    // Node prints; `directConnection=true` is the MongoDB connection-string
    // parameter that fixes the trap.
    expect(readme, 'the port-collision remedy needs its error token').toContain('EADDRINUSE');
    expect(readme, 'the Mongo remedy needs its parameter name').toContain('directConnection=true');
  });
});

describe('.gitignore — the local key file is not committable (T-1-26)', () => {
  it('matches .dev-local-key, and does not match everything', () => {
    // Non-vacuity first: a matcher that ignored every path would satisfy the
    // first assertion while proving nothing.
    expect(isIgnored('README.md'), 'README.md is tracked; the matcher must say so').toBe(false);
    expect(isIgnored('.env.example'), '.env.example is committed; the matcher must say so').toBe(false);

    expect(
      isIgnored('.dev-local-key'),
      'the documented key file must be ignored or the recipe can commit a plaintext key',
    ).toBe(true);
  });
});

/** A port nothing is listening on right now. */
async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

describe('Trap A — port collision, and the "successfully started" lie', () => {
  let containers: ThreeContainers;
  let squatter: Server | undefined;
  const booted: BootedApi[] = [];

  beforeAll(async () => {
    containers = await startThreeContainers();
    const listener = createServer();
    squatter = listener;
    // Bind the api default port and hold it. The port is read from
    // `DEFAULT_PORT_BY_SERVICE` rather than written as a literal, so the test
    // tracks the schema instead of drifting from it.
    await new Promise<void>((resolve) => {
      listener.once('error', () => resolve());
      listener.listen(DEFAULT_PORT_BY_SERVICE.api, '127.0.0.1', () => resolve());
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (squatter === undefined || !squatter.listening) {
        resolve();
        return;
      }
      squatter.close(() => resolve());
    });
    for (const api of booted) {
      await api.stop();
    }
    await containers?.stop();
  }, HOOK_TIMEOUT);

  it('dies with a bare EADDRINUSE *after* logging that it started successfully', async () => {
    // No PORT in the environment, so the process resolves its derived default —
    // which the listener above now owns. Because the child environment is
    // constructed, an exported `PORT` in the operator's shell cannot make this
    // boot pass by accident.
    const api = startApi(containerEnv(containers));
    const code = await api.exited;

    expect(code, 'a process that cannot bind must not exit zero').not.toBe(0);
    expect(api.output()).toContain('EADDRINUSE');
    // The reason this trap is documented at all: the last line a reader sees
    // before the bare error claims success.
    expect(api.output()).toContain('Nest application successfully started');
  }, 300_000);

  it('boots on an overridden PORT, which is the documented remedy', async () => {
    const port = await freePort();
    const api = await bootUntilLive(
      { ...containerEnv(containers), PORT: String(port) },
      port,
    );
    booted.push(api);

    const live = await (await fetch(`http://127.0.0.1:${port}/health/live`)).json();
    expect(live, 'the PORT override must actually work').toEqual({ status: 'ok' });
  }, 300_000);
});

describe('Trap B — a replica-set MongoDB reported as `mongo: down`', () => {
  let containers: ThreeContainers;
  const booted: BootedApi[] = [];

  beforeAll(async () => {
    containers = await startThreeContainers();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const api of booted) {
      await api.stop();
    }
    await containers?.stop();
  }, HOOK_TIMEOUT);

  it('reports mongo up with the URL the project\'s own helper builds', async () => {
    // `mongoUrl()` rather than the literal, so the fix is the project's helper
    // and not a hand-assembled URL that could drift from it.
    const api = await bootUntilLive(
      { ...containerEnv(containers), MONGO_URL: mongoUrl(containers.mongo) },
      DEFAULT_PORT_BY_SERVICE.api,
    );
    booted.push(api);

    const ready = await readReady(DEFAULT_PORT_BY_SERVICE.api);
    expect(dependencyStatuses(ready ?? { body: {} }).mongo).toBe('up');
    await api.stop();
  }, 300_000);

  it('reports mongo down from that same URL with the directConnection parameter deleted', async () => {
    // The two arms differ in exactly one query parameter, and that is possible
    // because of a fact about the shared harness: `startThreeContainers()` runs
    // MongoDB with `--replSet rs0`, so `urls.mongo` already carries the fix. No
    // second MongoDB container is needed — the one the harness starts *is* the
    // `--replSet` server the trap is about.
    const withoutFix = new URL(containers.urls.mongo);
    withoutFix.searchParams.delete('directConnection');
    const withFix = new URL(containers.urls.mongo);
    expect(
      withFix.searchParams.get('directConnection'),
      'precondition: the harness URL must carry the parameter',
    ).toBe('true');
    expect(withoutFix.toString(), 'the two arms must differ only in that parameter').not.toBe(
      withFix.toString(),
    );

    const api = await bootUntilLive(
      { ...containerEnv(containers), MONGO_URL: withoutFix.toString() },
      DEFAULT_PORT_BY_SERVICE.api,
    );
    booted.push(api);

    // Asserted on the observable outcome — mongo not reported up — rather than
    // on an HTTP status, because which failure surfaces first (a 503 from the
    // readiness handler, or a process exit) depends on how
    // `MongoService`'s `serverSelectionTimeoutMS`/`connectTimeoutMS` pairing
    // resolves. Pinning a status would test a timeout constant, not the trap.
    const reportedDown = await waitFor(
      async () => {
        const ready = await readReady(DEFAULT_PORT_BY_SERVICE.api);
        return ready !== undefined && dependencyStatuses(ready).mongo !== 'up';
      },
      60,
      1_000,
    );
    expect(reportedDown, 'readiness must report mongo as not up').toBe(true);
    await api.stop();
  }, 300_000);
});