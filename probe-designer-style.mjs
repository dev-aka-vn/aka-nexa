/**
 * Empirical probe: does the rendered FormIO surface have the CSS its
 * Bootstrap-5 template class vocabulary requires?
 *
 * Loads the no-auth spike route (same @formio/js builder + template set
 * the designer uses), waits for the builder canvas, then measures:
 *   - whether Bootstrap's token layer is present at all (--bs-primary)
 *   - which Bootstrap class names the canvas actually emits
 *   - the computed style of the emitted .row / .col-* / .form-control
 * If .row computes to display:block (not flex) and .form-control has no
 * border/padding, the class vocabulary has no stylesheet behind it.
 */
import { chromium } from '@playwright/test';

const URL = 'http://127.0.0.1:5173/#/spike';

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
});

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.formio-builder-form', { timeout: 120000 });

const result = await page.evaluate(() => {
  const bsPrimary = getComputedStyle(document.documentElement)
    .getPropertyValue('--bs-primary')
    .trim();

  // Every stylesheet rule that could style the canvas.
  const definedSelectors = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin (the Google font sheet)
    }
    for (const rule of Array.from(rules)) {
      if (rule.selectorText) definedSelectors.push(rule.selectorText);
    }
  }
  const stylesheetOrigin = Array.from(document.styleSheets).map((s) => {
    try {
      return s.href ?? '(inline <style>)';
    } catch {
      return '(cross-origin)';
    }
  });

  const host =
    document.querySelector('.formio-builder-host') ?? document.body;

  const classes = new Set();
  host.querySelectorAll('*').forEach((el) =>
    el.classList.forEach((c) => classes.add(c)),
  );
  const bsish = [
    ...classes,
  ]
    .filter((c) =>
      /^(row|col-|col$|form-control|form-select|form-group|form-check|card|btn|input-group|nav|tab|d-|mb-|mt-|text-|visually-hidden|formio-form-group)/.test(
        c,
      ),
    )
    .sort();

  const measure = (sel) => {
    const el = host.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      display: s.display,
      flexWrap: s.flexWrap,
      padding: s.padding,
      borderTop: `${s.borderTopWidth} ${s.borderTopStyle}`,
      width: s.width,
      marginBottom: s.marginBottom,
      borderRadius: s.borderTopLeftRadius,
    };
  };

  const hasRuleFor = (needle) =>
    definedSelectors.some((sel) => sel.includes(needle));

  return {
    bsPrimary: bsPrimary === '' ? '(EMPTY — Bootstrap token layer absent)' : bsPrimary,
    stylesheetOrigin,
    emittedBootstrapClasses: bsish,
    ruleExists: {
      '.row': hasRuleFor('.row'),
      '.col-md-6': hasRuleFor('.col-md-6'),
      '.form-control': hasRuleFor('.form-control'),
      '.card': hasRuleFor('.card'),
      '.btn': hasRuleFor('.btn'),
      '.formio-form-group': hasRuleFor('.formio-form-group'),
    },
    computed: {
      row: measure('.row'),
      col: measure('[class*="col-"]'),
      formControl: measure('.form-control'),
      card: measure('.card'),
    },
    builderFormVisible: !!host.querySelector('.formio-builder-form'),
    componentCount: host.querySelectorAll('.formio-component').length,
  };
});

console.log(JSON.stringify(result, null, 2));
console.log('\nconsole errors (first 5):');
console.log(consoleErrors.slice(0, 5).join('\n') || '(none)');

await browser.close();
