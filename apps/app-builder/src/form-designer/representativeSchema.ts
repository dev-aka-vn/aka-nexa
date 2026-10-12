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
 */

export interface RepresentativeSchema {
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
