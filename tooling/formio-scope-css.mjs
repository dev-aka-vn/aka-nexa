/**
 * Scoped Bootstrap stylesheet generator (G-06-6 / G-06-8 shared mechanism).
 *
 * The FormIO 5.6.1 template set emits Bootstrap 5 class names (row, col-md-*,
 * form-control, ...) but ships no Bootstrap stylesheet, so the designer canvas
 * and the signer renderer both render unstyled HTML. A raw global
 * `import 'bootstrap/dist/css/bootstrap.min.css'` is excluded: it would
 * restyle the whole admin console and collide with the app's own `.btn` /
 * `.card` (AGENTS.md rule 1). This script is the one shareable mechanism —
 * a mechanical selector-prefix transform over the pinned Bootstrap source
 * that makes the rule set reachable ONLY beneath the `formio-scope` root.
 *
 * Shape (the `tooling/boundaries.config.mjs` precedent): dependency-free
 * plain-ESM Node, `node:` builtins only. Unlinted `tooling/` ESM outside
 * every tsconfig `include`. Reads the already-installed transitive Bootstrap
 * stylesheet — this performs NO install (T-06-SC).
 *
 * Transform rules, applied in order, per qualified rule:
 *  1. Split the selector on top-level commas and prefix each part with the
 *     scope root plus a descendant combinator, so a bare Bootstrap class rule
 *     is reachable only beneath the scope root.
 *  2. A comma-part that IS the document-root pseudo-class (`:root`) is
 *     REPLACED by the scope root itself (not prefixed), so the token block
 *     declaring the theme variables (`--bs-primary`, ...) lands ON the scope
 *     root and is readable from its own computed style.
 *  3. Drop any comma-part whose first token is the document element (`html`)
 *     or the body element (`body`): those rules position the page, and the
 *     app shell owns the page (T-06-36).
 *  4. Recurse into the conditional group at-rules (`@media`, `@supports`,
 *     ...) so nested selectors are transformed too.
 *  5. Pass `@font-face` and `@keyframes` (including vendor-prefixed
 *     keyframes) through UNCHANGED — a prefixed keyframe step (`from`, `to`,
 *     `0%`) would make the animation unreachable.
 *  6. Drop the character-set at-rule (`@charset`): it is only valid as the
 *     first line, and the generated header occupies that position.
 *  7. The universal-selector box-sizing rule (`*, ::after, ::before`) is kept
 *     and transformed like any other — it is load-bearing for the grid.
 *
 * The output is deterministic (same input bytes -> same output bytes), so the
 * `--check` mode regenerates in memory and exits non-zero when the on-disk
 * artifact differs: that is the drift guard the vitest spec shells out to
 * (T-06-35).
 *
 * Usage:
 *   node tooling/formio-scope-css.mjs          # regenerate the artifact(s)
 *   node tooling/formio-scope-css.mjs --check  # exit 0 iff on-disk matches
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TOOL_DIR, '..');

const BOOTSTRAP_CSS = path.join(
  REPO_ROOT,
  'node_modules',
  'bootstrap',
  'dist',
  'css',
  'bootstrap.min.css',
);
const BOOTSTRAP_PKG = path.join(
  REPO_ROOT,
  'node_modules',
  'bootstrap',
  'package.json',
);

/** The single scope root class. On the FormIO mount containers only. */
const SCOPE_CLASS = 'formio-scope';

/** The consumers this generator writes from the one source read. */
const OUTPUTS = [
  path.join(
    REPO_ROOT,
    'apps',
    'app-builder',
    'src',
    'form-designer',
    'formio-scope.css',
  ),
];

/**
 * Group at-rules whose bodies are rule lists: nested selectors are
 * transformed by recursing into the body.
 */
const RECURSIVE_AT_RULES = new Set([
  'media',
  'supports',
  'container',
  'layer',
  'starting-style',
]);

/**
 * Find `ch` at top level (outside strings and comments). Returns -1 when
 * absent. The Bootstrap source is minified but carries quoted `content`
 * values and license comments, so a raw indexOf would misfire.
 */
function indexOfTopLevel(src, from, ch) {
  let instr = null;
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
    if (c === ch) {
      return i;
    }
  }
  return -1;
}

/**
 * `openAt` points at `{`. Returns the index of the matching `}`.
 * Strings, escapes and comments cannot unbalance the scan.
 */
function findBlockEnd(src, openAt) {
  let depth = 0;
  let instr = null;
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
  throw new Error('formio-scope-css: unbalanced braces in Bootstrap source');
}

/** Strip `/* ... *\/` comments (license banners between rules). */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Split a selector list on top-level commas only. Functional pseudo-classes
 * (`:not(...)`, `:is(...)`, ...) may carry commas inside parentheses, and
 * attribute selectors inside brackets — splitting there would corrupt the
 * selector.
 */
function splitSelectorList(selector) {
  const parts = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let instr = null;
  let current = '';
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (instr !== null) {
      current += c;
      if (c === '\\' && i + 1 < selector.length) {
        current += selector[i + 1];
        i += 1;
      } else if (c === instr) {
        instr = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      instr = c;
      current += c;
      continue;
    }
    if (c === '(') {
      parenDepth += 1;
    } else if (c === ')') {
      parenDepth -= 1;
    } else if (c === '[') {
      bracketDepth += 1;
    } else if (c === ']') {
      bracketDepth -= 1;
    }
    if (c === ',' && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

/** True when `token` is an element name that is NOT html/body-anchored. */
function isPageElement(token) {
  return /^(html|body)(?![A-Za-z0-9_-])/i.test(token);
}

/** True when the selector part opens with the document-root pseudo-class. */
function isDocumentRoot(token) {
  return /^:root(?![A-Za-z0-9_-])/i.test(token);
}

/**
 * Transform one comma-part of a selector list. Returns the scoped selector,
 * or null when the part must be dropped (page-level html/body rule).
 */
function transformSelectorPart(part) {
  const trimmed = part.trim();
  if (trimmed === '') {
    return null;
  }
  if (isPageElement(trimmed)) {
    return null;
  }
  if (isDocumentRoot(trimmed)) {
    // The token block lands ON the scope root: replace, do not prefix.
    return `.${SCOPE_CLASS}${trimmed.slice(':root'.length)}`;
  }
  return `.${SCOPE_CLASS} ${trimmed}`;
}

/**
 * Transform a rule-list slice (a stylesheet body or a group at-rule body)
 * into scoped rules. Returns the transformed text.
 */
function transformRuleList(src) {
  const out = [];
  let i = 0;
  const skipGap = () => {
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
    if (src[i] === '@') {
      const semi = indexOfTopLevel(src, i, ';');
      const brace = indexOfTopLevel(src, i, '{');
      if (brace !== -1 && (semi === -1 || brace < semi)) {
        const head = src.slice(i, brace);
        const end = findBlockEnd(src, brace);
        const nameMatch = /^@([A-Za-z-]+)/.exec(head);
        const name = nameMatch ? nameMatch[1].toLowerCase() : '';
        if (RECURSIVE_AT_RULES.has(name)) {
          const inner = transformRuleList(src.slice(brace + 1, end));
          out.push(`${head}{${inner}}`);
        } else {
          // @font-face, @keyframes (and vendor variants), and anything else:
          // verbatim. Keyframe step selectors stay unprefixed so the
          // animation remains reachable.
          out.push(src.slice(i, end + 1));
        }
        i = end + 1;
      } else if (semi !== -1) {
        const head = src.slice(i, semi);
        // @charset is only valid as the first line, which the generated
        // header occupies — drop it.
        if (!/^@charset\b/i.test(head)) {
          out.push(`${head};`);
        }
        i = semi + 1;
      } else {
        throw new Error('formio-scope-css: unterminated at-rule in source');
      }
    } else {
      const brace = indexOfTopLevel(src, i, '{');
      if (brace === -1) {
        throw new Error('formio-scope-css: expected rule block in source');
      }
      const rawHead = stripComments(src.slice(i, brace));
      const end = findBlockEnd(src, brace);
      const body = src.slice(brace, end + 1);
      const scoped = splitSelectorList(rawHead)
        .map(transformSelectorPart)
        .filter((s) => s !== null);
      // A rule whose every part was page-level disappears entirely.
      if (scoped.length > 0) {
        out.push(`${scoped.join(',')}${body}`);
      }
      i = end + 1;
    }
  }
  return out.join('\n');
}

/** Read the pinned source, transform it, and return the full artifact text. */
function generate() {
  const source = readFileSync(BOOTSTRAP_CSS, 'utf8');
  const pkg = JSON.parse(readFileSync(BOOTSTRAP_PKG, 'utf8'));
  const version = pkg.version;
  const header =
    `/* Generated from bootstrap@${version} ` +
    `(node_modules/bootstrap/dist/css/bootstrap.min.css) ` +
    `by tooling/formio-scope-css.mjs - do not edit by hand. ` +
    `Regenerate: node tooling/formio-scope-css.mjs */`;
  return `${header}\n${transformRuleList(source)}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const text = generate();
  let failed = false;
  for (const output of OUTPUTS) {
    let current = null;
    try {
      current = readFileSync(output, 'utf8');
    } catch {
      current = null;
    }
    if (check) {
      if (current === text) {
        process.stdout.write(`ok   ${output}\n`);
      } else {
        process.stderr.write(
          `drift ${output} — regenerate with: node tooling/formio-scope-css.mjs\n`,
        );
        failed = true;
      }
    } else {
      writeFileSync(output, text, 'utf8');
      process.stdout.write(`wrote ${output} (${text.length} bytes)\n`);
    }
  }
  if (failed) {
    process.exitCode = 1;
  }
}

main();
