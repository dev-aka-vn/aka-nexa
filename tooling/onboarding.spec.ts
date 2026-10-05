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
 *   provider *eagerly*, so the key file has to exist before a boot reaches
 *   anything this file asserts. Two distinct failures live behind that sentence,
 *   and the difference is not cosmetic: the **variable** being unset or empty
 *   raises the named `LOCAL_KEY_FILE_MISSING:`, while the **file** being absent
 *   raises a raw `ENOENT` out of an uncaught `readFileSync` — see the `KEY_DIR`
 *   comment below and the `documented error tokens … derived from the code that
 *   emits them` block, which asserts the split against the caught errors rather
 *   than against this prose. The documented value is `./.dev-local-key`, which
 *   is gitignored and therefore legitimately absent on a fresh checkout — so a
 *   spec that used the documented path verbatim would fail on setup instead of on
 *   the property under test.
 * - **`NODE_ENV` is set on every boot.** Vitest sets `NODE_ENV=test` and
 *   `setupFiles` seeds `process.env`; inheriting either would make the boot
 *   contract under test whatever the runner happened to export.
 * - **`PORT` is set explicitly on every boot**, to a port this file acquired from
 *   the kernel and proved free by re-binding it immediately before the spawn.
 *   `01-11` left it absent so the documented default per `SERVICE_NAME` would be
 *   what ran — which coupled the whole file's result to whether the host's api
 *   default port happened to be free, and on a machine where it is not, four of
 *   twenty-seven tests failed with `EADDRINUSE` (G3). The derived default is still
 *   pinned, in `config.schema.spec.ts:73-89` and in this file's README
 *   service/port pairing assertion; what is given up here is a *live bind* of it,
 *   and the trade is deliberate. A second, cheaper loss went with it: the
 *   responder on a port could be a developer's already-running api, so the poll
 *   now re-checks that the child is still alive after a healthy body, and a
 *   stopped boot must leave its port bindable again.
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
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  APP_CONFIG_KEYS,
  CORE_HEALTH_INDICATOR_KEYS,
  DEFAULT_PORT_BY_SERVICE,
  LocalKeyProvider,
  REDIS_INSTANCES_NOT_DISTINCT,
  SERVICE_NAMES,
  assertKeyProviderAllowed,
  createKeyProvider,
  formatConfigError,
  validateConfig,
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
 * ANSI SGR escapes. Nest's logger colourises its output, and the sequences
 * contain no whitespace — so any `\S+` match across a colourised log swallows
 * them and yields a string no document could ever contain.
 */
const ANSI_COLOUR = /\u001B\[[0-9;]*m/g;

/**
 * 32 bytes of key material in a temporary directory.
 *
 * `LocalKeyProvider` requires a file of exactly that length, and the file must
 * not be the documented `./.dev-local-key` — that path is gitignored, so it is
 * absent on a fresh checkout and a spec that relied on it would fail on setup
 * instead of on the property under test.
 *
 * What that setup failure would be, precisely: with the path *set* and the file
 * missing, the constructor raises a raw `ENOENT` from its uncaught
 * `readFileSync`. `LOCAL_KEY_FILE_MISSING:` is the other case — the variable
 * being unset — and is not what an absent file produces. The original comment
 * here claimed the second about the first, which is the premise
 * `01-11-REVIEW.md` recorded as WR-02.
 *
 * This comment is prose and gets no assertion, deliberately. A docblock cannot
 * be asserted without matching its phrasing, and a test that matches phrasing
 * fails on a good edit while passing on a bad one. The split it describes is
 * asserted properly in the `documented error tokens … derived from the code that
 * emits them` block below, against the errors the emitters actually throw.
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
        if (response.status !== 200 || body.status !== 'ok') return false;
        // Re-checked *after* the response, not only before the fetch. The
        // pre-fetch check catches a child that is already dead but not one that
        // is mid-boot while something else answers the port — and that is exactly
        // the window in which a developer's already-running api satisfied three
        // assertions (WR-06). A healthy body whose child has since exited cannot
        // have come from that child, so it came from somewhere else and must not
        // be accepted.
        return !api.hasExited();
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
  const booted: Array<{ readonly api: BootedApi; readonly port: number }> = [];

  const boot = async (
    env: Record<string, string>,
    port: number,
    options: { readonly cwd?: string } = {},
  ): Promise<BootedApi> => {
    const api = await bootUntilLive(env, port, options);
    booted.push({ api, port });
    return api;
  };

  beforeAll(async () => {
    containers = await startThreeContainers();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const { api, port } of booted) {
      await stopAndRequireRelease(api, port);
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
    // A port this spec acquired and proved free, passed explicitly. Nothing here
    // depends on the host's api default port being available, so the file's
    // result is the same on a machine where 3000 is held by an unrelated
    // container and on one where it is not (G3).
    const port = await acquireFreePort();
    const api = await boot({ ...containerEnv(containers), PORT: String(port) }, port);

    const live = await (await fetch(`http://127.0.0.1:${port}/health/live`)).json();
    expect(live, '/health/live must answer a fixed ok literal').toEqual({ status: 'ok' });

    const ready = await readReady(port);
    expect(ready, '/health/ready must answer').toBeDefined();
    expect(ready?.status).toBe(200);
    // All three, each named — the shape D-10 requires of a ready process.
    const statuses = dependencyStatuses(ready ?? { body: {} });
    expect(Object.keys(statuses)).toEqual([...CORE_HEALTH_INDICATOR_KEYS]);
    expect(statuses).toEqual(
      Object.fromEntries([...CORE_HEALTH_INDICATOR_KEYS].map((key) => [key, 'up'])),
    );

    await stopAndRequireRelease(api, port);
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

    // Its own acquired port, like every other boot here. The decoy `.env` is the
    // variable under test; the port is not, and must not become one.
    const port = await acquireFreePort();
    const api = await boot({ ...containerEnv(containers), PORT: String(port) }, port, {
      cwd: decoyDir,
    });

    const ready = await readReady(port);
    expect(ready, '/health/ready must answer with a decoy .env in cwd').toBeDefined();
    expect(dependencyStatuses(ready ?? { body: {} }).mongo).toBe('up');

    await stopAndRequireRelease(api, port);
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

/**
 * Every token `.env.example` and `README.md` state is derived here by calling
 * the code that emits it (UAT gap G2, `01-11-REVIEW.md` WR-01/WR-02/WR-03/WR-04).
 *
 * ## The defect this block exists to prevent
 *
 * `01-11` wrote the token table from the *intent* of each guard rather than from
 * the string it produces, and three of its rows were about strings the system
 * never prints:
 *
 * - `CONFIG_INVALID: REDIS_INSTANCES_NOT_DISTINCT` is missing the `<root>`
 *   segment `formatConfigError` renders for an object-level issue, so the
 *   documented D-12 refusal — the guard this phase exists to keep load-bearing —
 *   was not greppable. A reader grepping for it found nothing.
 * - `LOCAL_KEY_FILE_MISSING:` was documented for an absent key *file*, which is
 *   a raw `ENOENT` from a `readFileSync` with no `try`/`catch`. The token fires
 *   only when the *variable* is unset or empty.
 * - `README.md` claimed `npm ci` fails on a non-24 Node. There is no
 *   `engine-strict` here and no `.npmrc` anywhere in the repository, so npm
 *   warns.
 *
 * ## Why nothing here is a hand-written token
 *
 * Each case calls the emitter and requires the **caught** string — or a property
 * read off the **caught error** — to appear in the document. A token typed into
 * an `expect(…).toContain(…)` as a literal is a second copy of the emitter, free
 * to drift from it, and a drifting second copy is precisely what this block
 * exists to remove. So the expected rendering is produced by calling
 * `formatConfigError` itself rather than by typing `<root>` out, and the wrong
 * D-12 form is derived from the right one by deletion rather than restated.
 *
 * The single named exception is `EBADENGINE`: npm prints it, nothing in this
 * repository does, so there is no in-repo emitter to derive it from and naming
 * it literally is required rather than forbidden. Its derivation obligation
 * transfers to the repository-side condition that makes it the *correct* token
 * to expect — the same case walks this repository for `.npmrc` files and fails
 * if one sets `engine-strict`. That is also why the README sentence is scoped to
 * this repository: npm also reads `$HOME/.npmrc` and the global-prefix `npmrc`,
 * neither of which this scan can see, and the README says so.
 *
 * ## Container-free and api-free on purpose
 *
 * No `startThreeContainers`, no api spawn, and nothing that binds a port another
 * test cares about. That is what keeps the `-t 'derived from the code that emits
 * them'` filter in the seconds range, and it is what lets these cases decide the
 * documentation on a machine where the api default port is occupied.
 */
describe('documented error tokens and guard triggers — derived from the code that emits them', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const envExample = readFileSync(ENV_EXAMPLE_PATH, 'utf8');

  /**
   * A complete, otherwise-valid boot configuration, built from the example file
   * rather than restated — so "otherwise valid" cannot rot into a second copy of
   * the schema's required keys.
   *
   * `.strict()` means `CRYPTO_LOCAL_KEY_FILE` must **not** appear: it is a path,
   * deliberately not a schema field, and passing it would make the schema refuse
   * with `unrecognized_keys` before any rule under test ran.
   */
  function bootConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    for (const key of APP_CONFIG_KEYS) {
      const value = ENV_EXAMPLE.active.get(key);
      if (value !== undefined) config[key] = value;
    }
    // `SERVICE_NAME` is documented but deliberately inactive in the example file
    // (T-1-31), so the one required key the file does not supply is added here.
    return { ...config, SERVICE_NAME: 'api' };
  }

  it('documents the D-12 refusal in exactly the form validateConfig throws', () => {
    // Non-vacuity first: the collapsed Redis pair is the *only* thing wrong with
    // this config, so the token caught below belongs to the D-12 rule and to
    // nothing else. Without this the assertion could pass on a refusal about a
    // missing key and still appear to have pinned D-12.
    const valid = bootConfig();
    expect(() => validateConfig(valid), 'the baseline config must be accepted').not.toThrow();

    let refusal = '';
    try {
      validateConfig({ ...valid, REDIS_QUEUE_URL: valid['REDIS_CACHE_URL'] });
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal, 'one Redis URL for both tiers must be refused').not.toBe('');

    // The expected rendering, produced by the formatter the boot itself uses —
    // an object-level issue has an empty path, so `formatConfigError` substitutes
    // `<root>` and substitutes the issue `message` for the Zod `code`. Calling it
    // pins the *relationship*; typing the string out would restate it, and this
    // assertion is what reports a changed rendering as a rendering change rather
    // than as a confusing "document is missing a token" several steps later.
    const expected = formatConfigError({
      path: [],
      code: 'custom',
      message: REDIS_INSTANCES_NOT_DISTINCT,
    });
    expect(refusal).toBe(expected);

    // The greppable form is the emitted string, so both documents must contain
    // it verbatim — a drift in either the emitter or the prose goes red here.
    expect(envExample, '.env.example must carry the greppable D-12 refusal').toContain(refusal);
    expect(readme, 'README.md must carry the greppable D-12 refusal').toContain(refusal);

    // And the form `01-11` documented must appear in neither file. Derived by
    // deleting the path segment rather than typed, and gated on its not being a
    // substring of the correct form — without that precondition this negative
    // assertion would be trivially true and would prove nothing.
    const ungreppable = expected.replace('<root> ', '');
    expect(
      expected.includes(ungreppable),
      'precondition: the wrong form must not be a substring of the right one, or this check is vacuous',
    ).toBe(false);
    expect(envExample, '.env.example still carries the un-greppable D-12 form').not.toContain(ungreppable);
    expect(readme, 'README.md still carries the un-greppable D-12 form').not.toContain(ungreppable);
  });

  it('documents LOCAL_KEY_FILE_MISSING for the unset variable, not for an absent file', () => {
    // `resolveLocalKeyFilePath` falls back to `process.env` when the config field
    // is absent, so a developer who exports the variable would silently satisfy
    // this call. Deleting it for the duration keeps the assertion independent of
    // whatever the operator's shell happens to carry, and `finally` puts it back.
    const saved = process.env['CRYPTO_LOCAL_KEY_FILE'];
    delete process.env['CRYPTO_LOCAL_KEY_FILE'];
    let refusal = '';
    try {
      // `NODE_ENV: 'test'` passes the crypto guard, so the *variable* is the
      // only thing that can refuse — which is what makes this the variable's
      // token rather than the guard's.
      createKeyProvider({ NODE_ENV: 'test', CRYPTO_KEY_PROVIDER: 'local' });
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    } finally {
      if (saved !== undefined) process.env['CRYPTO_LOCAL_KEY_FILE'] = saved;
    }
    expect(refusal, 'an unset key-file variable must be refused').not.toBe('');

    // Read off the thrown message rather than typed: the token is the part up to
    // and including the first colon, and everything after it is prose about the
    // requirement, which is allowed to change without a documentation fix.
    const token = `${refusal.split(':')[0] ?? ''}:`;
    expect(token, 'the refusal must name a token').not.toBe(':');
    expect(envExample, '.env.example must document the unset-variable token').toContain(token);
    expect(readme, 'README.md must document the unset-variable token').toContain(token);
  });

  it('documents an absent key file as the raw ENOENT it is, read off the error object', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'akane-absent-key-'));
    try {
      let thrown: unknown;
      try {
        // `nodeEnv: 'test'` again so the guard passes and the *file* is the only
        // thing that can fail.
        new LocalKeyProvider({ keyFilePath: path.join(dir, 'not-provisioned'), nodeEnv: 'test' });
      } catch (error) {
        thrown = error;
      }

      expect(thrown, 'constructing on an absent path must fail').toBeInstanceOf(Error);
      // Precondition pin, in the idiom `redis.schema.spec.ts:68` already uses.
      // `ENOENT` is a filesystem error code rather than a token this repository
      // emits, so it is read off the error below rather than derived.
      const code = (thrown as NodeJS.ErrnoException).code;
      expect(code, 'the absent-file failure must be a filesystem ENOENT').toBe('ENOENT');

      // The code, not the message: the message embeds the path, which is not
      // stable, and the code is the part a reader greps for.
      expect(envExample, '.env.example must document the absent-file failure').toContain(code ?? '');
      expect(readme, 'README.md must document the absent-file failure').toContain(code ?? '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the documented key-file remedy and requires LocalKeyProvider to accept the result', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'akane-remedy-key-'));
    try {
      const keyFile = path.join(dir, 'dev-local-key');
      // The documented recipe, verbatim, executed rather than quoted. Fixed argv
      // with the path passed as a positional parameter, so the path never reaches
      // the shell as text and nothing is assembled from it.
      execFileSync('/bin/sh', ['-c', 'head -c 32 /dev/urandom > "$1"', 'akane-remedy', keyFile], {
        timeout: 10_000,
      });

      // The requirement the documents state, read off the file the recipe made.
      expect(readFileSync(keyFile).length).toBe(32);

      const provider = new LocalKeyProvider({ keyFilePath: keyFile, nodeEnv: 'test' });
      return expect(provider.keyId()).resolves.toMatch(/^local-[0-9a-f]{16}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the README names engines.node exactly as the manifest declares it', () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };
    const declared = manifest.engines?.node;

    expect(declared, 'the manifest must declare engines.node').toBeDefined();
    // Not a duplicate of `toolchain-pin.spec.ts`: that spec asserts the manifest
    // agrees with `.nvmrc` and never reads the README. This asserts the
    // *documentation* agrees with the manifest, which is the only link that can
    // break when someone edits the prose.
    expect(readme, 'the README must quote engines.node so the two cannot drift in prose').toContain(
      declared ?? '',
    );
  });

  it('the README carries npm’s own warning token, and no repository .npmrc makes it a refusal', () => {
    // `EBADENGINE` is printed by npm, not by anything in this repository, so
    // there is no in-repo emitter to derive it from — naming it literally is what
    // gives the README sentence a handle at all. Without the token the sentence
    // has nothing to stand on: the scan below cannot distinguish "npm warns"
    // from "npm refuses", so restoring `01-11`'s "fails" claim would go green.
    expect(readme, 'the install claim needs npm’s own warning code').toContain('EBADENGINE');

    // The derivation obligation for that exception, on the repository side:
    // nothing in this repository may configure the enforcement the README
    // declines to claim. Adding an `engine-strict=true` `.npmrc` turns this red,
    // which is the direction that matters.
    const enforcing = npmrcFiles(REPO_ROOT).filter((file) =>
      /^engine-strict\s*=\s*true\s*$/im.test(readFileSync(file, 'utf8')),
    );
    expect(
      enforcing,
      `a repository .npmrc sets engine-strict, so npm would refuse rather than warn: ${enforcing.join(', ')}`,
    ).toEqual([]);
  });

  it('documents the guard switch, quoted out of assertKeyProviderAllowed’s own message', () => {
    let refusal = '';
    try {
      // `staging` is none of development, test or production, and that allow-list
      // is a closed set — so this is the message that names the environments a
      // local key is permitted in, and the one an operator actually hits.
      assertKeyProviderAllowed({ NODE_ENV: 'staging', CRYPTO_KEY_PROVIDER: 'local' });
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    expect(refusal, 'an unnamed environment must be refused').not.toBe('');

    // `NODE_ENV=development or test` is `assertKeyProviderAllowed`'s own wording,
    // lifted out of the thrown message rather than typed — WR-04 found that
    // nothing documented this switch at all, and a hand-written copy in the test
    // would have been a fourth place to drift. `\w` rather than `\S` because the
    // message continues with `, or …`: a greedy `\S+` would swallow that comma
    // and the derived token would then be a string no document can be expected to
    // contain.
    const guardSwitch = /NODE_ENV=\w+ or \w+/.exec(refusal)?.[0] ?? '';
    expect(guardSwitch, 'the refusal must name the environments a local key needs').not.toBe('');
    expect(envExample, '.env.example must name the guard switch').toContain(guardSwitch);
    expect(readme, 'README.md must name the guard switch').toContain(guardSwitch);
  });

  it('pins the two CRYPTO_KEY_PROVIDER_REQUIRED messages as distinct', () => {
    const refusalFor = (config: { NODE_ENV: string; CRYPTO_KEY_PROVIDER: string }): string => {
      try {
        assertKeyProviderAllowed(config);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      return '';
    };

    const production = refusalFor({ NODE_ENV: 'production', CRYPTO_KEY_PROVIDER: 'local' });
    const elsewhere = refusalFor({ NODE_ENV: 'staging', CRYPTO_KEY_PROVIDER: 'local' });

    expect(production, 'a production boot on a local key must be refused').not.toBe('');
    expect(elsewhere, 'an unnamed environment on a local key must be refused').not.toBe('');
    // WR-04's confusion, exactly: one token, two sentences, and the documentation
    // that collapsed them into a single row had to pick one and call it the
    // meaning. They must not be allowed back together.
    expect(production, 'the production refusal and the switch refusal must differ').not.toBe(elsewhere);

    const token = `${production.split(':')[0] ?? ''}:`;
    expect(token, 'the refusal must name a token').not.toBe(':');
    expect(envExample, '.env.example must name the crypto refusal token').toContain(token);
    expect(readme, 'README.md must name the crypto refusal token').toContain(token);
  });

  it('reproduces the sourcing hazard: sourcing .env.example rewrites an exported NODE_ENV', () => {
    // The warning both documents carry, observed rather than asserted. This is
    // conditional, and the condition is stated here on purpose: the assertion
    // holds **because `NODE_ENV` is an active line** in the example file, so the
    // documented recipe assigns it. If a later change makes the file stop
    // carrying one, the legitimate responses are to remove this case with that
    // decision recorded, or to invert it into an assertion that sourcing no
    // longer rewrites the variable. Weakening it until it passes is not one of
    // them — that is how the warning outlives the behaviour it describes.
    //
    // There is deliberately no negative grep for `development` anywhere: this
    // assertion is the whole check.
    const printed = execFileSync(
      '/bin/sh',
      ['-c', 'export NODE_ENV=production\nset -a; . ./.env.example; set +a\nprintf %s "$NODE_ENV"\n'],
      { cwd: REPO_ROOT, env: childEnv({}), encoding: 'utf8', timeout: 10_000 },
    );

    expect(
      printed.trim(),
      'the documented sourcing recipe must be observed to disarm the crypto guard',
    ).toBe('development');
  });
});

/**
 * Every `.npmrc` in the repository outside `node_modules`.
 *
 * A bounded walk rather than `readdirSync(dir, { recursive: true })`, which would
 * descend all of `node_modules` on every run of a case that has to stay in the
 * seconds range. The skipped directory names cannot hold a repository `.npmrc`:
 * a dependency that vendored one into its own tree is not this repository's
 * configuration, and npm does not read it either.
 */
function npmrcFiles(root: string): string[] {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === '.npmrc') found.push(full);
    }
  };
  walk(root);
  return found;
}

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

/** A port the kernel assigns on a `:0` bind, read off it and released. */
async function kernelAssignedPort(): Promise<number> {
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

/**
 * Bind `port` on loopback and release it immediately. `false` if something
 * already holds it — which is a fact about the host, not an error to throw from.
 */
async function bindAndRelease(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/**
 * A human-readable description of whatever is holding `port`.
 *
 * `docker ps` filtered to the published port is tried first, because on a
 * developer machine that is the common case: a container's published port is
 * held by a root-owned `docker-proxy`, and both `ss -ltnp` and `lsof` decline to
 * name it for a non-root caller — they return **nothing at all** rather than an
 * error. A fallback to either would therefore report "nothing holds it" and send
 * a reader looking in the wrong place, which is worse than admitting ignorance.
 * So when nothing can be found, the answer is that this account cannot identify
 * it (P11). Inventing a name is not among the options.
 *
 * Fixed argv, no shell string, explicit timeout, and nothing assembled from
 * environment or file content. The result is interpolated only into a failure
 * message: never logged on a passing run, never returned to a caller that stores
 * it.
 */
function describeOccupant(port: number): string {
  try {
    const containers = execFileSync(
      'docker',
      ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}'],
      { encoding: 'utf8', timeout: 5_000 },
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (containers.length > 0) {
      return `held by container ${containers.join(', ')} (published port ${port})`;
    }
  } catch {
    // Docker absent or its daemon unreachable. Fall through to the honest answer
    // rather than reporting that the query found nothing, which it did not do.
  }
  return (
    `not identifiable from this account — a container-published port is held by a root-owned ` +
    `docker-proxy this user cannot enumerate, and ${port} may equally be held by a plain ` +
    `process you own`
  );
}

/**
 * A port nothing is listening on, **proved free at the moment it is returned**.
 *
 * The proof is a re-bind, not an assumption. The kernel hands out a port from
 * `:0`, and between releasing it and spawning the child something else can take
 * it — on a developer machine, plausibly a container. A bare `EADDRINUSE` from a
 * boot that has already started is a far worse diagnostic than a named port with
 * its holder, so the precondition lives here, immediately before the spawn rather
 * than buried inside it.
 *
 * Nothing in this file asks the kernel for a *specific* port. That is the whole
 * of G3: the api default port is a derived default the host may or may not have
 * free, and a test whose precondition is a property of the machine is a
 * false-red generator. On this host that port is held by an unrelated container,
 * and this file's result must be the same either way.
 */
async function acquireFreePort(): Promise<number> {
  const port = await kernelAssignedPort();
  if (await bindAndRelease(port)) return port;

  throw new Error(
    `acquired port ${port} was taken before the child was spawned — ${describeOccupant(port)}. ` +
      `Documented remedy: PORT=3100 SERVICE_NAME=api npm run start:api`,
  );
}

/**
 * Stop a booted api and require its port to become bindable again.
 *
 * A port still held after the process under test has exited was held by something
 * else — which means every health response this boot's assertions accepted came
 * from a foreign process, and the correct outcome is a red test, not a green one.
 * That is WR-06 stated as a check rather than a worry, and it is the same hazard
 * `.env.example` warns its reader about, removed from the spec's own behaviour.
 *
 * The bounded window exists because the child's HTTP server closes asynchronously
 * relative to its `close` event, so a single immediate re-bind would report a
 * correctly-torn-down boot as an impostor.
 *
 * Residual, recorded rather than overstated: this proves the holder at the moment
 * of teardown, so a foreign holder that released in the same instant is not
 * excluded. No window-based check closes that, and this one does not claim to.
 */
async function stopAndRequireRelease(api: BootedApi, port: number): Promise<void> {
  await api.stop();

  const released = await waitFor(async () => bindAndRelease(port), 20, 500);
  if (!released) {
    throw new Error(
      `the api process exited but port ${port} is still held — ${describeOccupant(port)}. ` +
        `A healthy response asserted on this port came from a process this spec did not start.`,
    );
  }
}

/**
 * Trap A's port squatter, bound once for the whole file.
 *
 * **Not** per-describe, and **not** tolerantly. `01-11`'s squatter resolved on its
 * own `error` event, asserted nothing about `listening`, and its teardown accepted
 * a squatter that never bound — so a developer with a leftover process on the api
 * port got a green trap that proved nothing at all (WR-05). This one rejects on
 * error, asserts `listening`, and has no branch that tolerates a failure.
 *
 * The port is **acquired, never the api default**. Binding 3000 here would make
 * the whole file's outcome depend on whether the host's api default port is free,
 * which is the defect this file's port handling exists to remove.
 */
let squatter: Server | undefined;
let squatterPort: number | undefined;

beforeAll(async () => {
  const port = await acquireFreePort();
  const listener = createServer();

  await new Promise<void>((resolve, reject) => {
    // `reject`, not `resolve`: a squatter that cannot bind must fail the file.
    listener.once('error', reject);
    listener.listen(port, '127.0.0.1', () => resolve());
  });

  expect(listener.listening, `the port squatter must be listening on ${port}`).toBe(true);
  squatter = listener;
  squatterPort = port;
}, HOOK_TIMEOUT);

afterAll(async () => {
  const listener = squatter;
  squatter = undefined;
  squatterPort = undefined;
  if (listener === undefined) return;
  await new Promise<void>((resolve) => {
    listener.close(() => resolve());
  });
});

describe('Trap A — port collision, and the "successfully started" lie', () => {
  let containers: ThreeContainers;
  const booted: Array<{ readonly api: BootedApi; readonly port: number }> = [];

  beforeAll(async () => {
    containers = await startThreeContainers();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const { api, port } of booted) {
      await stopAndRequireRelease(api, port);
    }
    await containers?.stop();
  }, HOOK_TIMEOUT);

  it('dies with a bare EADDRINUSE *after* logging that it started successfully', async () => {
    // The squatter's own port, passed explicitly. Both the collision and the
    // remedy below use that one freshly acquired squatter, so this trap measures
    // the bind race and nothing about the host's api default port.
    const port = squatterPort;
    expect(port, 'precondition: the file-level squatter must hold a port').toBeDefined();

    const api = startApi({ ...containerEnv(containers), PORT: String(port) });
    const code = await api.exited;

    expect(code, 'a process that cannot bind must not exit zero').not.toBe(0);
    expect(api.output()).toContain('EADDRINUSE');
    // The reason this trap is documented at all: the last line a reader sees
    // before the bare error claims success.
    expect(api.output()).toContain('Nest application successfully started');

    // The README's rendered address, derived from what Node actually printed.
    // `app.listen(port)` is called with no host, so Node binds the IPv6 wildcard
    // and prints `:::3000` — a README showing `0.0.0.0:3000` describes a string
    // that appears in nobody's log, which is the same "a document states a
    // property nothing verifies" defect G2 was opened for, sitting in one of the
    // three files in scope. Deriving it means a change in Node's formatting turns
    // this red instead of quietly leaving the README describing the wrong thing;
    // a hand-written `:::3000` would have passed no matter what Node printed.
    //
    // Nest's logger colourises what it prints, and the escapes contain no
    // whitespace, so a bare `\S+` would swallow them and derive an address no
    // document can contain. Stripped before matching rather than after, so the
    // match itself sees only the characters Nest wrote around.
    const plain = api.output().replace(ANSI_COLOUR, '');
    const captured = /listen EADDRINUSE: address already in use (\S+)/.exec(plain);
    expect(captured, 'the collision must render the address Node actually bound against').not.toBeNull();
    const rendered = (captured?.[1] ?? '').replace(/:\d+$/, `:${DEFAULT_PORT_BY_SERVICE.api}`);
    expect(rendered, 'the captured address must carry a port').not.toBe('');
    expect(
      readFileSync(README_PATH, 'utf8'),
      'the README must render the address Node prints, not one it chose',
    ).toContain(rendered);
  }, 300_000);

  it('boots on an overridden PORT, which is the documented remedy', async () => {
    // A second acquired port, free — not the squatter's, which is held on purpose.
    const port = await acquireFreePort();
    const api = await bootUntilLive({ ...containerEnv(containers), PORT: String(port) }, port);
    booted.push({ api, port });

    const live = await (await fetch(`http://127.0.0.1:${port}/health/live`)).json();
    expect(live, 'the PORT override must actually work').toEqual({ status: 'ok' });

    await stopAndRequireRelease(api, port);
  }, 300_000);
});

describe('Trap B — a replica-set MongoDB reported as `mongo: down`', () => {
  let containers: ThreeContainers;
  const booted: Array<{ readonly api: BootedApi; readonly port: number }> = [];

  beforeAll(async () => {
    containers = await startThreeContainers();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    for (const { api, port } of booted) {
      await stopAndRequireRelease(api, port);
    }
    await containers?.stop();
  }, HOOK_TIMEOUT);

  it('reports mongo up with the URL the project\'s own helper builds', async () => {
    // `mongoUrl()` rather than the literal, so the fix is the project's helper
    // and not a hand-assembled URL that could drift from it. Its own acquired
    // port, like every other boot here.
    const port = await acquireFreePort();
    const api = await bootUntilLive(
      { ...containerEnv(containers), MONGO_URL: mongoUrl(containers.mongo), PORT: String(port) },
      port,
    );
    booted.push({ api, port });

    const ready = await readReady(port);
    expect(dependencyStatuses(ready ?? { body: {} }).mongo).toBe('up');
    await stopAndRequireRelease(api, port);
  }, 300_000);

  it('reports mongo down from that same URL with the directConnection parameter deleted', async () => {
    // The two arms differ in exactly one query parameter, and that is possible
    // because of a fact about the shared harness: `startThreeContainers()` runs
    // MongoDB with `--replSet rs0`, so `urls.mongo` already carries the fix. No
    // second MongoDB container is needed — the one the harness starts *is* the
    // `--replSet` server the trap is about. Each arm takes its **own** acquired
    // port, so the two are not distinguished by anything but the URL.
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

    const port = await acquireFreePort();
    const api = await bootUntilLive(
      { ...containerEnv(containers), MONGO_URL: withoutFix.toString(), PORT: String(port) },
      port,
    );
    booted.push({ api, port });

    // Asserted on the observable outcome — mongo not reported up — rather than
    // on an HTTP status, because which failure surfaces first (a 503 from the
    // readiness handler, or a process exit) depends on how
    // `MongoService`'s `serverSelectionTimeoutMS`/`connectTimeoutMS` pairing
    // resolves. Pinning a status would test a timeout constant, not the trap.
    const reportedDown = await waitFor(
      async () => {
        const ready = await readReady(port);
        return ready !== undefined && dependencyStatuses(ready).mongo !== 'up';
      },
      60,
      1_000,
    );
    expect(reportedDown, 'readiness must report mongo as not up').toBe(true);
    await stopAndRequireRelease(api, port);
  }, 300_000);
});