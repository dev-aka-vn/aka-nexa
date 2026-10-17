/**
 * S1 template port — one Bootstrap-4-era template against the
 * 5.x Bootstrap-5 default template (the S1 core question).
 *
 * `@formio/js` 5.6.1 made Bootstrap 5 the default and moved
 * the template sets into the separate `@formio/bootstrap`
 * package (a direct dependency shipping the bootstrap3 /
 * bootstrap4 / bootstrap5 sets; the *framework name* stayed
 * `bootstrap` while its content became the bootstrap5 set —
 * see `@formio/js/lib/mjs/templates/index.js`).
 *
 * The ported template is the Bootstrap-4-era `label` template
 * (the 4.x template whose markup carries the Bootstrap 4
 * `sr-only` class). Bootstrap 5 renamed the class vocabulary
 * it uses, and this port applies exactly the renames the
 * installed `@formio/bootstrap` cssClasses mapping records:
 *
 *   Bootstrap 4   →   Bootstrap 5
 *   sr-only       →   visually-hidden
 *   form-group    →   formio-form-group   (cssClasses map)
 *
 * The port is a faithful transcription of the 4.x template's
 * markup — same element, same attribute order, same
 * conditionals — with the class vocabulary updated. It
 * registers against the active `bootstrap` framework through
 * the documented `Formio.Templates.extendTemplate` API, which
 * is how a template set is extended in 5.x.
 */

/** The subset of the FormIO label-template context the port reads. */
export interface LabelTemplateContext {
  component: {
    label?: string;
    type?: string;
    key?: string;
    tooltip?: string;
    validate?: { required?: boolean };
    [property: string]: unknown;
  };
  label: {
    hidden: boolean;
    className: string;
    labelPosition?: string;
  };
  instance: { id: string };
  readOnly?: boolean;
  t: (text: string, params?: unknown) => string;
  iconClass?: (name: string) => string;
}

const isChoiceComponent = (type: string | undefined): boolean =>
  type === 'radio' || type === 'selectboxes';

/**
 * Escape a value interpolated into a
 * double-quoted HTML attribute. The
 * tooltip is owner-authored schema
 * content: escaping the quote (and the
 * ampersand that could build an entity)
 * keeps the text inside the attribute —
 * a quote in the tooltip cannot break
 * out into the markup (T-06-01's XSS
 * posture).
 */
const escapeHtmlAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * The ported `label` template (form mode). Bootstrap 4's
 * `sr-only` is Bootstrap 5's `visually-hidden`; every other
 * line is the 4.x markup unchanged.
 */
export function portedLabelForm(ctx: LabelTemplateContext): string {
  // Bootstrap 4: `${ctx.label.hidden ? 'sr-only' : ''}`
  const hiddenClass = ctx.label.hidden ? 'visually-hidden' : '';
  const choice = isChoiceComponent(ctx.component.type);
  const isContainerWithHiddenRequired =
    ctx.component.type === 'container' &&
    ctx.label.hidden &&
    Boolean(ctx.component.validate?.required);
  const showRequired =
    Boolean(ctx.component.validate?.required) &&
    (ctx.label.hidden || choice);
  const showNumericHint =
    ctx.component.type === 'number' ||
    ctx.component.type === 'phoneNumber' ||
    ctx.component.type === 'currency';

  let markup = '<label\n  ref="label"\n  class="col-form-label ';
  markup += `${ctx.label.className} ${hiddenClass}"\n  `;
  if (!ctx.readOnly && !choice) {
    markup += `for="${ctx.instance.id}-${ctx.component.key}"\n  `;
  }
  if (choice || ctx.label.hidden) {
    markup += 'aria-hidden="true"\n  ';
  }
  markup += `id="l-${ctx.instance.id}-${ctx.component.key}"\n>\n  `;
  if (!isContainerWithHiddenRequired) {
    markup += `${ctx.t(ctx.component.label ?? '')}\n  `;
  }
  if (showRequired) {
    // Bootstrap 4: `<span class="sr-only">`
    markup += `<span class="visually-hidden">${ctx.t('required', {
      field: ctx.t(ctx.component.label ?? ''),
    })}</span>\n  `;
  }
  if (showNumericHint) {
    // Bootstrap 4: `<span class="sr-only">`
    markup += `<span class="visually-hidden">, ${ctx.t(
      'numeric only',
    )},</span>\n  `;
  }
  if (ctx.component.tooltip && !ctx.label.hidden) {
    const iconClass = ctx.iconClass?.('question-sign') ?? '';
    markup += `<i ref="tooltip" tabindex="0" class="${iconClass} text-muted" data-tooltip="${escapeHtmlAttribute(ctx.component.tooltip)}"></i>\n  `;
  }
  markup += '</label>\n';
  if (showRequired) {
    markup += '  <span class="required-star" aria-hidden="true">*</span>\n';
  }
  return markup;
}

/**
 * Registers the ported template against the active template
 * set. Idempotent: `extendTemplate` merges, so re-registration
 * (the builder mount and the preview mount both register, in
 * whichever order they mount) is harmless.
 *
 * Browser-only — `formio` is the dynamically imported
 * `@formio/js` namespace (Pattern 1).
 */
export function registerPortedBootstrap5Templates(formio: {
  Templates: {
    extendTemplate: (
      name: string,
      template: Record<string, unknown>,
    ) => void;
  };
}): void {
  formio.Templates.extendTemplate('bootstrap', {
    label: { form: portedLabelForm },
  });
}
