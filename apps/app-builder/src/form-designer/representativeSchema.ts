/**
 * The representative schema the S1 spike mounts in both
 * form-engine surfaces: the FormIO **builder** (FormioBuilderField)
 * and the **preview** pane (Formio.createForm).
 *
 * The component set is chosen to exercise exactly the surfaces
 * the spike must verify:
 *
 *  - `fullName`  — a required text field (drag-and-drop target
 *                  for the builder add/change assertion).
 *  - `quantity`  — a number field with a min/max validation
 *                  pair (FRM-05 boundary: valid at the bound,
 *                  invalid one step outside; the 5.x
 *                  `component.errors` array shape is asserted
 *                  against it).
 *  - `contacts`  — an EditGrid (the 5.x `validateRow` array
 *                  return shape is asserted against it).
 *  - `internalNote` — a required field with a hidden label: the
 *                  ported Bootstrap-4-era label template renders
 *                  the 5.x `visually-hidden` class here (was
 *                  `sr-only` in Bootstrap 4), which is how the
 *                  template-port assertion observes the port.
 *  - `nameColumns` — a two-column layout pair (widths 2 and 10,
 *                  each holding one text field): the layout pair
 *                  is what proves the grid stylesheet is present.
 *                  Without the scoped Bootstrap sheet the row
 *                  computes `display: block` and both columns
 *                  span the full canvas; with it the row is a
 *                  wrapping flex container and the columns are
 *                  2/12 and 10/12 of it. The spike spec reads
 *                  counts relatively (`before + 1`) so a fifth
 *                  component changes no existing spike assertion.
 */

export interface RepresentativeSchema extends Record<string, unknown> {
  display: string;
  components: Array<Record<string, unknown>>;
}

export const REPRESENTATIVE_SCHEMA: RepresentativeSchema = {
  display: 'form',
  components: [
    {
      type: 'textfield',
      key: 'fullName',
      label: 'Full name',
      placeholder: 'Jane Doe',
      validate: { required: true },
    },
    {
      type: 'number',
      key: 'quantity',
      label: 'Quantity',
      validate: { min: 5, max: 10 },
    },
    {
      type: 'editgrid',
      key: 'contacts',
      label: 'Contacts',
      components: [
        {
          type: 'textfield',
          key: 'contactName',
          label: 'Name',
          validate: { required: true },
        },
        {
          type: 'email',
          key: 'contactEmail',
          label: 'Email',
        },
      ],
    },
    {
      type: 'textfield',
      key: 'internalNote',
      label: 'Internal note',
      hideLabel: true,
      validate: { required: true },
    },
    {
      type: 'columns',
      key: 'nameColumns',
      columns: [
        {
          width: 2,
          components: [
            {
              type: 'textfield',
              key: 'layoutFirst',
              label: 'Layout first',
              input: true,
            },
          ],
        },
        {
          width: 10,
          components: [
            {
              type: 'textfield',
              key: 'layoutLast',
              label: 'Layout last',
              input: true,
            },
          ],
        },
      ],
    },
  ],
};

/**
 * A one-row submission for the preview pane, so the EditGrid
 * has a live row for the `validateRow` assertion.
 */
export const REPRESENTATIVE_SUBMISSION = {
  data: {
    contacts: [
      {
        contactName: 'Jane Doe',
        contactEmail: 'jane.doe@example.com',
      },
    ],
  },
};
