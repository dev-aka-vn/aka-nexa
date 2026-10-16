/**
 * Scoped-Bootstrap drift guard (G-06-6 / G-06-8 shared mechanism).
 *
 * The generator (`tooling/formio-scope-css.mjs`) is unlinted `tooling/` ESM
 * and the artefact it produces is the real contract, so this spec SHELLS OUT
 * to `node tooling/formio-scope-css.mjs --check` — it never imports the
 * generator. A changed Bootstrap source cannot silently change what ships:
 * the build fails instead (T-06-35), and a scope escape cannot leak
 * document-root or page-level selectors outside the scope root (T-06-36).
 *
 * The artefact facts below are asserted by PARSING the generated file's
 * selector lists in code, not by shell text-matching gates: a counted
 * line-match over the unfiltered file would be self-invalidating because
 * the generated header comment would satisfy or defeat it.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');
const GENERATOR = path.join(TOOL_DIR, 'formio-scope-css.mjs');
const DESIGNER_CSS = path.join(
  REPO_ROOT,
  'apps',
  'app-builder',
  'src',
  'form-designer',
  'formio-scope.css',
);
const RENDERER_CSS = path.join(
  REPO_ROOT,
  'apps',
  'renderer',
  'src',
  'read',
  'formio-scope.css',
);
const BOOTSTRAP_PKG = path.join(
  REPO_ROOT,
  'node_modules',
  'bootstrap',
  'package.json',
);

const SCOPE = '.formio-scope';

/** Shell out to the generator; returns the exit status (never throws). */
function runGenerator(args: readonly string[]): number {
  try {
    execFileSync(process.execPath, [GENERATOR, ...args], {
      stdio: 'pipe',
    });
    return 0;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    expect(
      typeof status,
      'the generator must exit with a numeric status, not a signal',
    ).toBe('number');
    return status as number;
  }
}

interface ParsedRule {
  /** The raw selector list (empty for at-rule containers). */
  readonly selector: string;
  /** The comma-parts of the selector list. */
  readonly parts: string[];
  /** True for @media/@supports containers (recurse for leaves). */
  readonly container: boolean;
  /** The at-rule name in lowercase (`media`, `keyframes`, ...). */
  readonly atName: string;
  /** The raw body text (declarations or nested rules). */
  readonly body: string;
}

/** Index of the `{`-matched `}`; -1 when unbalanced. Strings/comments safe. */
function blockEnd(src: string, openAt: number): number {
  let depth = 0;
  let instr: string | null = null;
  for (let i = openAt; i < src.length; i += 1) {
    const c = src[i];
    if (instr !== null) {
      if (c === '\\') {
        i += 1;
      } else if (c === instr) {
        instr = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      instr = c;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Top-level `{` index, skipping strings and comments. */
function blockStart(src: string, from: number): number {
  let instr: string | null = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (instr !== null) {
      if (c === '\\') {
        i += 1;
      } else if (c === instr) {
        instr = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      instr = c;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === '{') {
      return i;
    }
  }
  return -1;
}

/**
 * Parse one rule-list level into qualified rules and at-rule containers.
 * At-rules without bodies (there are none besides the dropped character-set
 * rule) are skipped by the caller contract — the generator drops `@charset`.
 */
function parseLevel(src: string): ParsedRule[] {
  const rules: ParsedRule[] = [];
  let i = 0;
  const skipGap = (): void => {
    while (i < src.length) {
      if (src[i] === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? src.length : end + 2;
      } else if (/\s/.test(src[i])) {
        i += 1;
      } else {
        break;
      }
    }
  };
  while (i < src.length) {
    skipGap();
    if (i >= src.length) {
      break;
    }
    const brace = blockStart(src, i);
    expect(brace, 'the artefact contains a headless block — the parser is broken').toBeGreaterThanOrEqual(0);
    const end = blockEnd(src, brace);
    expect(end, 'the artefact contains an unbalanced block — the parser is broken').toBeGreaterThanOrEqual(0);
    const head = src.slice(i, brace).trim();
    const body = src.slice(brace + 1, end);
    if (head.startsWith('@')) {
      const name = (/^@([A-Za-z-]+)/.exec(head)?.[1] ?? '').toLowerCase();
      rules.push({
        selector: '',
        parts: [],
        container: name === 'media' || name === 'supports',
        atName: name,
        body,
      });
    } else {
      const parts = head
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '');
      rules.push({ selector: head, parts, container: false, atName: '', body });
    }
    i = end + 1;
  }
  return rules;
}

interface ArtefactShape {
  /** Every qualified rule, descending into @media/@supports containers. */
  readonly leaves: ParsedRule[];
  /** Every at-rule container at any level. */
  readonly atRules: ParsedRule[];
}

/** Parse the artefact, recursing into conditional group at-rules. */
function parseArtefact(css: string): ArtefactShape {
  const leaves: ParsedRule[] = [];
  const atRules: ParsedRule[] = [];
  const visit = (level: ParsedRule[]): void => {
    for (const rule of level) {
      if (rule.atName !== '') {
        atRules.push(rule);
        if (rule.container) {
          visit(parseLevel(rule.body));
        }
      } else {
        leaves.push(rule);
      }
    }
  };
  // Skip the generated header comment (line 1) — it is not CSS.
  const body = css.slice(css.indexOf('\n') + 1);
  visit(parseLevel(body));
  return { leaves, atRules };
}

function readDesigner(): string {
  return readFileSync(DESIGNER_CSS, 'utf8');
}

describe('formio-scope-css drift guard — one generator, two byte-identical artefacts', () => {
  it('the artefacts exist and are non-empty (non-vacuity, runs first)', () => {
    const designer = readDesigner();
    const renderer = readFileSync(RENDERER_CSS, 'utf8');
    expect(designer.length).toBeGreaterThan(100_000);
    expect(renderer.length).toBeGreaterThan(100_000);
    const shape = parseArtefact(designer);
    expect(
      shape.leaves.length,
      'the parser found no qualified rules — it is broken, and every assertion below would pass vacuously',
    ).toBeGreaterThan(500);
  });

  it('--check exits zero on a clean tree and non-zero on a perturbed copy', () => {
    expect(runGenerator(['--check'])).toBe(0);

    // Perturb a COPY via the generator's output-path seam and point
    // --check at it: the drift direction must be a non-zero exit.
    const dir = mkdtempSync(path.join(tmpdir(), 'formio-scope-'));
    const copy = path.join(dir, 'formio-scope.css');
    copyFileSync(DESIGNER_CSS, copy);
    writeFileSync(copy, readFileSync(copy, 'utf8') + ' ', 'utf8');
    expect(runGenerator(['--check', '--out', copy])).not.toBe(0);
  });

  it('the two artefacts are byte-identical (the shared-mechanism contract)', () => {
    const designer = readDesigner();
    const renderer = readFileSync(RENDERER_CSS, 'utf8');
    expect(renderer).toBe(designer);
  });

  it('the first line names the Bootstrap source version and the generator, and no character-set at-rule survives', () => {
    const css = readDesigner();
    const firstLine = css.slice(0, css.indexOf('\n'));
    const version: string = JSON.parse(readFileSync(BOOTSTRAP_PKG, 'utf8'))
      .version as string;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(firstLine).toContain(`bootstrap@${version}`);
    expect(firstLine).toContain('tooling/formio-scope-css.mjs');
    expect(css).not.toMatch(/@charset/i);
  });

  it('the theme token block is declared on the scope root, and no document-root or page-level selector survives', () => {
    const { leaves, atRules } = parseArtefact(readDesigner());

    // The token block lands ON the scope root: `.formio-scope{--bs-...}`.
    const tokenRule = leaves.find((rule) =>
      rule.parts.some((part) => part === SCOPE),
    );
    expect(tokenRule, 'no rule declares on the bare scope root — the token block did not land').toBeDefined();
    expect(tokenRule?.body).toContain('--bs-primary');

    // No comma-part is the bare document-root pseudo-class ...
    const bareRoots = leaves.flatMap((rule) =>
      rule.parts.filter((part) => part === ':root'),
    );
    expect(bareRoots).toEqual([]);

    // ... nor rooted at the document or body element ...
    const pageRooted = leaves.flatMap((rule) =>
      rule.parts.filter((part) => /^(html|body)(?![A-Za-z0-9_-])/i.test(part)),
    );
    expect(pageRooted).toEqual([]);

    // ... and the source `:root` token selectors are gone entirely
    // (replaced, not merely prefixed).
    const rootPrefixed = leaves.flatMap((rule) =>
      rule.parts.filter((part) => part.includes(':root')),
    );
    expect(rootPrefixed).toEqual([]);

    // @font-face / @keyframes pass through; @charset is dropped, so the
    // only at-rules are media and keyframes.
    const names = new Set(atRules.map((rule) => rule.atName));
    expect([...names].sort()).toEqual(['keyframes', 'media']);
  });

  it('the grid rules are scoped and the keyframes steps are unprefixed', () => {
    const { leaves, atRules } = parseArtefact(readDesigner());

    // A scope-rooted row rule exists ...
    const rowRule = leaves.find((rule) =>
      rule.parts.some((part) => part === `${SCOPE} .row`),
    );
    expect(rowRule, 'no `.formio-scope .row` rule — the grid is unreachable').toBeDefined();
    expect(rowRule?.body).toContain('display:flex');

    // ... and a scope-rooted column rule exists ...
    const colRule = leaves.find((rule) =>
      rule.parts.some((part) => part === `${SCOPE} .col-md-2`),
    );
    expect(colRule, 'no `.formio-scope .col-md-2` rule — the columns are unreachable').toBeDefined();

    // ... while the keyframes at-rule exists with unprefixed steps: a
    // prefixed step would make the animation unreachable.
    const keyframes = atRules.filter((rule) => rule.atName === 'keyframes');
    expect(keyframes.length).toBeGreaterThan(0);
    for (const frame of keyframes) {
      const steps = parseLevel(frame.body);
      for (const step of steps) {
        expect(
          step.parts.some((part) => part.startsWith(SCOPE)),
          `a keyframes step got scope-prefixed (${step.selector}) — the animation is unreachable`,
        ).toBe(false);
      }
    }
  });

  it('the form-control rule is present and scoped, never bare', () => {
    const { leaves } = parseArtefact(readDesigner());
    const controlRules = leaves.filter((rule) =>
      rule.parts.some((part) => part.includes('.form-control')),
    );
    expect(
      controlRules.length,
      'no .form-control rule at all — controls render unstyled',
    ).toBeGreaterThan(0);
    for (const rule of controlRules) {
      for (const part of rule.parts) {
        if (part.includes('.form-control')) {
          expect(
            part.startsWith(`${SCOPE} `) || part === SCOPE,
            `a bare .form-control selector survives (${part}) — it would style app chrome`,
          ).toBe(true);
        }
      }
    }
  });
});
