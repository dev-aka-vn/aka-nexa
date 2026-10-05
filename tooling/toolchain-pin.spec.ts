/**
 * Toolchain pins — the exact strings FND-01 and FND-02 rest on (D-06, WR-10).
 *
 * ## The defect this file exists to prevent
 *
 * Every pin in this repository was correct on the day it was written and nothing
 * has ever *checked* that. `tooling/deployment-shape.spec.ts` proves
 * `typescript` sits in the build-tooling set; it says nothing about which
 * version. So the following edits are all silently green today:
 *
 * - `devDependencies.typescript` → `"6.0.4"`, or → `"^6.0.3"` (the exact pin
 *   becomes a range the moment a caret is typed);
 * - `.nvmrc` → `22`;
 * - `engines.node` → `">=20"`;
 * - `package-lock.json` deleted from the index but left on disk.
 *
 * The first two are the ones that matter. The TypeScript pin is load-bearing
 * because `typescript-eslint@8.71.0` declares
 * `peerDependencies: { typescript: ">=4.8.4 <6.1.0" }` **with no
 * `peerDependenciesMeta`**, which makes it one of three independent enforcers of
 * the pin (AGENTS.md §3.2) and the only one that hard-fails `npm install`:
 * npm `latest` is 7.x, so a range is not a looser pin, it is a broken install.
 * The Node pin is load-bearing because NFR-SEC-12 makes an EOL runtime
 * undeployable, and Node 20 reached EOL on 2026-04-30.
 *
 * ## Why `install-guard` needs its own half of this file
 *
 * D-06's install-guard job deletes the lockfile and runs `npm install` to prove
 * the pin survives a lockfile-free resolve. Its comment claimed an assertion
 * rejected peer-dependency-bypass flags; no such assertion existed, so
 * `--legacy-peer-deps` could have been added later and produced a **green job
 * that proved nothing** — the bypass suppresses the `ERESOLVE`, and the
 * `ERESOLVE` is the guard (WR-10).
 *
 * The guard is fixed in two places, deliberately: a pre-install assertion step
 * in `.github/workflows/ci.yml`, and the `describe` block below, which reads that
 * same workflow file. CI catches it on push; the suite catches it for someone who
 * never opens the Actions tab. The suite does **not** re-declare the install
 * command or the detection pattern — both are read out of the workflow, because a
 * duplicated copy is exactly the "assertion that does not guard the real thing"
 * failure WR-10 was filed about.
 *
 * ## Non-vacuity
 *
 * Every scanner here asserts on its own output first (the house rule from
 * `deployment-shape.spec.ts`): the workflow parser must find both jobs, the job
 * must contain exactly one `npm install` line, and the pattern extracted from CI
 * must reject all three bypass forms *and* accept `--strict-peer-deps=true`.
 * A guard that greps an empty string reports "clean"; that is a passing test
 * with no content.
 *
 * ## One environment dependency, stated plainly
 *
 * The lockfile assertion shells out to `git ls-files --error-unmatch`. Tracking
 * is not observable from the filesystem — a lockfile that is present, correct
 * and untracked fails FND-02 in exactly the same way as no lockfile at all — so
 * git is the only honest source. This suite therefore requires a git work tree,
 * which every CI job and every developer's checkout is.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const LOCKFILE_PATH = path.join(REPO_ROOT, 'package-lock.json');
const NVMRC_PATH = path.join(REPO_ROOT, '.nvmrc');

/** The version AGENTS.md §3.4 requires be pinned as an exact string. */
const TYPESCRIPT_PIN = '6.0.3';

const ROOT_MANIFEST = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
) as {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

// ------------------------------------------------------------------------ //
// Workflow parsing
//
// Deliberately narrow and line-based rather than a YAML library: `yaml` is only
// a transitive dependency of ESLint here, so importing it would make the suite
// depend on a package the root manifest never declares. Every shape this parser
// expects is asserted downstream, so a reformat that defeats the parser fails a
// named test instead of silently yielding zero jobs.
// ------------------------------------------------------------------------ //

interface WorkflowStep {
  readonly name: string;
  readonly uses?: string;
  readonly id?: string;
  readonly with: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
  /** The step's `run:` script with the block scalar's indentation removed. */
  readonly run: string;
}

const WORKFLOW_LINES = readFileSync(WORKFLOW_PATH, 'utf8').split('\n');

const JOB_HEADER = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const STEP_HEADER = /^ {6}- (\S+):\s*(.*)$/;
const STEP_SUBKEY = /^ {8}([A-Za-z0-9_-]+):\s*(.*)$/;
const NESTED_ENTRY = /^ {10}([A-Za-z0-9_.-]+):\s*(.*)$/;
const BLOCK_SCALAR = /^[|>][-+]?\d*$/;

/** The lines of the `jobs:` block that belong to one job id. */
function jobLines(job: string): string[] {
  const start = WORKFLOW_LINES.findIndex((line) => JOB_HEADER.exec(line)?.[1] === job);
  if (start === -1) return [];
  const out: string[] = [];
  for (let i = start + 1; i < WORKFLOW_LINES.length; i += 1) {
    // Indent 2 again means the next job; indent 0 means `jobs:` ended.
    if (/^ {0,2}\S/.test(WORKFLOW_LINES[i])) break;
    out.push(WORKFLOW_LINES[i]);
  }
  return out;
}

/** Group a job's lines into one chunk per `- …` step. */
function stepChunks(lines: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (const line of lines) {
    if (STEP_HEADER.test(line)) chunks.push([line]);
    else if (chunks.length > 0) chunks[chunks.length - 1].push(line);
  }
  return chunks;
}

/** Strip a block scalar's common indentation. */
function dedent(lines: readonly string[]): string {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => (/^ */.exec(line)?.[0].length ?? 0));
  const strip = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(strip)).join('\n');
}

function parseStep(chunk: readonly string[]): WorkflowStep {
  const header = STEP_HEADER.exec(chunk[0]);
  if (header === null) throw new Error(`unparseable workflow step: ${JSON.stringify(chunk[0])}`);
  let [, key, value] = header;
  let name = key === 'name' ? value : '';
  let uses = key === 'uses' ? value : undefined;
  let id = key === 'id' ? value : undefined;
  let run = '';
  const with_: Record<string, string> = {};
  const env: Record<string, string> = {};

  let i = 1;
  while (i < chunk.length) {
    const subkey = STEP_SUBKEY.exec(chunk[i]);
    // Blank filler and already-consumed block bodies land here.
    if (subkey === null) {
      i += 1;
      continue;
    }
    const sub = subkey as RegExpExecArray;
    key = sub[1];
    value = sub[2];
    if (key === 'name') {
      name = value;
      i += 1;
    } else if (key === 'uses') {
      uses = value;
      i += 1;
    } else if (key === 'id') {
      id = value;
      i += 1;
    } else if (key === 'run' && BLOCK_SCALAR.test(value)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < chunk.length && (chunk[j].trim() === '' || /^ {10,}/.test(chunk[j]))) {
        body.push(chunk[j]);
        j += 1;
      }
      run = dedent(body);
      i = j;
    } else if (key === 'run') {
      run = value;
      i += 1;
    } else if (key === 'with' || key === 'env') {
      const target = key === 'with' ? with_ : env;
      let j = i + 1;
      while (j < chunk.length) {
        const entry = NESTED_ENTRY.exec(chunk[j]);
        if (entry === null) break;
        target[entry[1]] = entry[2];
        j += 1;
      }
      i = j;
    } else {
      // `if:`, `continue-on-error:`, … — read past, value unused.
      i += 1;
    }
  }
  return { name, uses, id, with: with_, env, run };
}

function parseSteps(job: string): WorkflowStep[] {
  return stepChunks(jobLines(job)).map(parseStep);
}

const BUILD_JOB = parseSteps('build');
const INSTALL_GUARD = parseSteps('install-guard');

/** Every line of every step script in a job. */
function runLines(steps: readonly WorkflowStep[]): string[] {
  return steps.flatMap((step) => step.run.split('\n')).map((line) => line.trim());
}

/** The step whose script contains the peer-dependency-bypass `grep`, if any. */
function bypassAssertionStep(): WorkflowStep | undefined {
  return INSTALL_GUARD.find((step) => step.run.includes('grep -Eq'));
}

/**
 * The exact ERE the CI assertion greps with, lifted out of the workflow.
 *
 * Read rather than duplicated so the suite cannot pass while CI checks
 * something else. `[[:…]]` POSIX classes are rejected rather than translated:
 * JavaScript compiles `[[:space:]]` into a *valid* character class over
 * `[ : s p a c e`, so a silent mistranslation would widen the pattern instead
 * of failing.
 */
const CI_BYPASS_PATTERN = (() => {
  const step = bypassAssertionStep();
  const match = step === undefined ? null : /grep -Eq\s*(?:--\s*)?'([^']+)'/.exec(step.run);
  if (match === null) {
    throw new Error(
      'the install-guard job has no grep -Eq bypass assertion — the CI guard and this suite cannot both be green',
    );
  }
  if (match[1].includes('[[:')) {
    throw new Error(`CI bypass pattern uses a POSIX class JS cannot express faithfully: ${match[1]}`);
  }
  return match[1];
})();

// ------------------------------------------------------------------------ //
// FND-01 / FND-02 — the pins themselves
// ------------------------------------------------------------------------ //

describe('toolchain pins are exact, not merely present (FND-01, FND-02)', () => {
  it('devDependencies.typescript is the exact string "6.0.3" — no caret, no tilde, no range', () => {
    const declared = ROOT_MANIFEST.devDependencies?.typescript;
    expect(declared, 'typescript must be declared in root devDependencies').toBeDefined();
    // Exact-equality is the whole point: "^6.0.3" or "6.0.4" both fail here.
    expect(declared).toBe(TYPESCRIPT_PIN);
    expect(declared, 'a range would let npm resolve 7.x, which typescript-eslint rejects outright').not.toMatch(
      /[\^~><*]|\|\|/,
    );
  });

  /**
   * The lockfile is the third record of the same pin, and it is the one `npm ci`
   * honours. A manifest narrowed to `"6.0.3"` while the lock resolved
   * `6.0.4` reproduces exactly the drift this file exists to catch, in the one
   * place a plain string comparison on the manifest cannot see.
   */
  it('the lockfile records the same pin, in the root entry and in the resolved entry', () => {
    const lock = JSON.parse(readFileSync(LOCKFILE_PATH, 'utf8')) as {
      packages?: Record<string, { devDependencies?: Record<string, string>; version?: string }>;
    };
    const root = lock.packages?.[''];
    expect(root, 'lockfile root entry ("" key)').toBeDefined();
    expect(root?.devDependencies?.typescript, 'lockfile root devDependencies.typescript').toBe(TYPESCRIPT_PIN);
    expect(
      lock.packages?.['node_modules/typescript']?.version,
      'the version npm actually resolved and installed',
    ).toBe(TYPESCRIPT_PIN);
  });

  /**
   * The installed compiler, not the declaration.
   *
   * This is the same check the CI `install-guard` job performs after its
   * lockfile-free install, so a green job means "TS 6.0.3 was installed" rather
   * than "`tsc` emitted three files". Reading the root copy is the one `tsc -b`
   * resolves.
   */
  it('the installed TypeScript compiler is the pinned version', () => {
    const installed = path.join(REPO_ROOT, 'node_modules', 'typescript', 'package.json');
    expect(existsSync(installed), 'node_modules/typescript must be installed for this suite to mean anything').toBe(
      true,
    );
    const manifest = JSON.parse(readFileSync(installed, 'utf8')) as { version?: string };
    expect(manifest.version).toBe(TYPESCRIPT_PIN);
  });

  it('.nvmrc names exactly Node 24', () => {
    expect(existsSync(NVMRC_PATH), '.nvmrc must exist — AGENTS.md §3.4 pins Node here').toBe(true);
    expect(readFileSync(NVMRC_PATH, 'utf8').trim()).toBe('24');
  });

  it('engines.node admits Node 24 and nothing outside the 24 line', () => {
    expect(ROOT_MANIFEST.engines?.node).toBe('>=24 <25');
  });

  /**
   * Drift detector, not a restatement of the two assertions above.
   *
   * Both literals can be individually correct while the pair is not: bump
   * `.nvmrc` to `25` and the floor silently becomes 22; bump `engines.node` to
   * `">=25 <26"` and a developer on 24 is refused. The shape is parsed rather
   * than string-matched so this fails on a *relation*, and it fails loudly if
   * `engines.node` is ever rewritten into a form this reader does not
   * understand — a reader that cannot parse cannot agree.
   */
  it('.nvmrc and engines.node name the same Node line', () => {
    const nvmrc = readFileSync(NVMRC_PATH, 'utf8').trim();
    const engines = ROOT_MANIFEST.engines?.node ?? '';

    const major = Number.parseInt(nvmrc, 10);
    expect(Number.isInteger(major), `.nvmrc must be a bare major version, got "${nvmrc}"`).toBe(true);
    expect(String(major), `.nvmrc (${nvmrc}) must be a bare major — a minor or range is a second pin to drift`).toBe(
      nvmrc,
    );

    const range = /^>=(\d+)\s+<(\d+)$/.exec(engines);
    expect(range, `engines.node is no longer the \`>=N <M\` shape this assertion reads: "${engines}"`).not.toBeNull();
    const lower = Number((range as RegExpExecArray)[1]);
    const upper = Number((range as RegExpExecArray)[2]);
    expect(lower, 'engines.node lower bound must be the Node LTS floor').toBeLessThan(upper);
    expect(major, `.nvmrc (${nvmrc}) must equal the engines.node floor`).toBe(lower);
  });

  /**
   * FND-02's actual failure mode is an *untracked* lockfile.
   *
   * `existsSync` alone cannot see it: a developer who deleted the file from the
   * index, or who built inside a `node_modules`-only copy, has a byte-perfect
   * lockfile on disk and no reproducibility guarantee at all. `git ls-files
   * --error-unmatch` exits non-zero for an untracked path, which is the only
   * observation available from inside the suite.
   */
  it('the lockfile is committed, not merely present on disk', () => {
    expect(existsSync(LOCKFILE_PATH), 'package-lock.json must exist').toBe(true);
    const listed = spawnSync('git', ['ls-files', '--error-unmatch', '--', 'package-lock.json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(listed.error, 'git must be runnable — tracking is not observable from the filesystem').toBeUndefined();
    expect(
      listed.status,
      `package-lock.json is not tracked by git: ${String(listed.stderr).trim()}`,
    ).toBe(0);
    expect(listed.stdout.trim().split('\n')).toEqual(['package-lock.json']);
  });
});

// ------------------------------------------------------------------------ //
// FND-01 — the CI matrix must not drift from the floor
// ------------------------------------------------------------------------ //

describe('the CI matrix consumes the Node floor rather than restating it', () => {
  /**
   * Non-vacuity: the parser has to find the two jobs the gap names.
   *
   * An empty parse makes every assertion in this block pass, which is the same
   * vacuous-pass shape `deployment-shape.spec.ts` calls out for its scanner.
   */
  it('the workflow parser finds both jobs and their steps', () => {
    expect(BUILD_JOB.length, 'the build job must have steps').toBeGreaterThanOrEqual(4);
    expect(INSTALL_GUARD.length, 'the install-guard job must have steps').toBeGreaterThanOrEqual(6);
    const executed = INSTALL_GUARD.filter((step) => step.run !== '');
    expect(executed.length, 'install-guard must have steps that actually run something').toBeGreaterThanOrEqual(5);
    for (const step of executed) {
      expect(step.name, 'every executed step must be named — an unnamed step is invisible when it fails').not.toBe('');
    }
  });

  /**
   * AGENTS.md §3.4 requires Node pinned in `.nvmrc`, the Dockerfile **and** the
   * CI matrix. The Dockerfile does not exist yet, so the matrix is the half
   * assertable here — and a matrix hardcoding `node-version: 24.x` is a pin that
   * silently stops agreeing with `.nvmrc` the first time the floor moves.
   */
  it('both jobs resolve Node from .nvmrc and hardcode nothing', () => {
    for (const [jobName, steps] of [
      ['build', BUILD_JOB],
      ['install-guard', INSTALL_GUARD],
    ] as const) {
      const setupNode = steps.filter((step) => (step.uses ?? '').startsWith('actions/setup-node'));
      expect(setupNode, `${jobName} must set Node up`).toHaveLength(1);
      expect(setupNode[0].with['node-version-file'], `${jobName} must read the Node floor from .nvmrc`).toBe(
        '.nvmrc',
      );
      expect(
        setupNode[0].with,
        `${jobName} hardcodes node-version — it can drift from .nvmrc (AGENTS.md §3.4)`,
      ).not.toHaveProperty('node-version');
    }
  });
});

// ------------------------------------------------------------------------ //
// FND-01 / D-06 / WR-10 — the install guard must still be a guard
// ------------------------------------------------------------------------ //

describe('the install-guard job cannot be bypassed into meaninglessness (D-06, WR-10)', () => {
  /**
   * Non-vacuity: exactly one install command, so "no bypass flag anywhere" has a
   * subject. Zero would make the next assertion pass for free.
   */
  it('the job declares exactly one lockfile-free npm install', () => {
    const installLines = runLines(INSTALL_GUARD).filter((line) => /\bnpm\s+install\b/.test(line));
    expect(installLines, 'install-guard must actually install').toHaveLength(1);
    expect(installLines[0]).toContain('--no-audit');
  });

  /**
   * The half WR-10 said did not exist, now checked on every `npm test`.
   *
   * `--legacy-peer-deps`, `--force` and `--strict-peer-deps=false` each suppress
   * npm's peer-dependency resolution. That resolution *is* the guard: it is what
   * turns a lockfile-free resolve of TypeScript 7.x into a hard `ERESOLVE`
   * (AGENTS.md §3.2). With it suppressed the job installs whatever it likes,
   * compiles, and goes green — the phase's central claim, unproved.
   */
  it('no install command in the job carries a peer-dependency-bypass flag', () => {
    const installLines = runLines(INSTALL_GUARD).filter((line) => /\bnpm\s+install\b/.test(line));
    for (const flag of ['--legacy-peer-deps', '--force', '--strict-peer-deps=false']) {
      for (const line of installLines) {
        expect(line, `${flag} in the install-guard install turns the guard into a no-op`).not.toContain(flag);
      }
    }
  });

  /**
   * The install step runs the *declared* command, so the assertion above and the
   * install that actually happens cannot be two different strings.
   */
  it('the install step executes the declared command rather than a second literal', () => {
    const executor = INSTALL_GUARD.find((step) => step.run.includes('$INSTALL_CMD') && !step.run.includes('grep -Eq'));
    expect(executor, 'the install step must execute the declared $INSTALL_CMD').toBeDefined();
    expect(executor?.run, 'the install step must delete the lockfile before installing').toContain('rm -f package-lock.json');
    expect(executor?.run, 'the install step must not carry its own literal npm install').not.toMatch(
      /\bnpm\s+install\b/,
    );
    expect(executor?.env['INSTALL_CMD'], 'the executor must read the declared command').toContain('steps.guard.outputs');
  });

  /**
   * The CI pattern, read out of the workflow, is behaviourally correct.
   *
   * Three positive cases (each bypass form must be caught) and two negative ones
   * (`--strict-peer-deps=true` is not a bypass; the real command is clean). The
   * negatives matter as much as the positives: an over-broad pattern fails the
   * guard job on the install it is supposed to be protecting.
   */
  it('the pattern CI greps with rejects every bypass form and no legitimate one', () => {
    const pattern = new RegExp(CI_BYPASS_PATTERN);
    for (const bypass of [
      'npm install --legacy-peer-deps',
      'npm install --no-audit --legacy-peer-deps --no-fund',
      'npm install --force',
      'npm install --no-audit --force --no-fund',
      'npm install --strict-peer-deps=false',
    ]) {
      expect(pattern.test(bypass), `${bypass} must be rejected by the CI bypass pattern`).toBe(true);
    }
    for (const legitimate of [
      'npm install --no-audit --no-fund',
      'npm install --strict-peer-deps=true',
      'npm install --forbid-scripts=false',
    ]) {
      expect(pattern.test(legitimate), `${legitimate} must not be rejected`).toBe(false);
    }
  });

  /**
   * Structural assertions on the guard's own wiring.
   *
   * These read the CI YAML rather than behaviour, and that is the honest scope:
   * what is being proved is that the control WR-10 found *missing* now exists,
   * and that it can fail. Three things have to hold — the step exists, it can
   * exit non-zero, and it refuses to run against an empty command (an empty
   * string matches no bypass pattern, so without that branch the grep would
   * cheerfully report "clean" if the output wiring ever broke).
   */
  it('the job contains a real assertion step that can fail and refuses an empty command', () => {
    const step = bypassAssertionStep();
    expect(step, 'install-guard must contain a bypass-flag assertion step').toBeDefined();
    expect(step?.run, 'the assertion must be able to fail the job').toMatch(/\bexit 1\b/);
    expect(step?.run, 'the assertion must guard its own vacuity').toMatch(/-z "\$INSTALL_CMD"/);
    expect(step?.name, 'a guard with no name will not be noticed when it fails').not.toBe('');
  });

  /**
   * Ordering, because "assert after installing" is the same hole as "do not
   * assert": the install has already been performed by then, so the job would
   * report failure on a run that already consumed the bypassed result.
   */
  it('the assertion runs before the install it inspects', () => {
    const assertAt = INSTALL_GUARD.findIndex((step) => step.run.includes('grep -Eq'));
    const installAt = INSTALL_GUARD.findIndex(
      (step) => step.run.includes('rm -f package-lock.json') && step.run.includes('$INSTALL_CMD'),
    );
    expect(assertAt, 'the assertion step must exist').toBeGreaterThanOrEqual(0);
    expect(installAt, 'the install step must exist').toBeGreaterThanOrEqual(0);
    expect(assertAt, 'the bypass assertion must precede the install').toBeLessThan(installAt);
  });

  /**
   * The guard also asserts what it is for: the toolchain a lockfile-free
   * install resolves. Without this step the job proves only that `tsc` emitted
   * three files, which a 7.x that happens to compile would also satisfy.
   */
  it('the job asserts the resolved TypeScript version, not just the build artifacts', () => {
    const step = INSTALL_GUARD.find((candidate) => candidate.run.includes('node_modules/typescript/package.json'));
    expect(step, 'install-guard must assert the resolved TypeScript version (FND-01)').toBeDefined();
    expect(step?.run).toContain(TYPESCRIPT_PIN);
    expect(step?.run, 'the version assertion must be able to fail the job').toMatch(/process\.exit\(1\)/);
  });
});