import { describe, it, expect } from 'vitest';

import { normalizeForm, normalizeForms, submitFormOf, type AppDefinition } from './definition.js';

function buildFixture() {
  return {
    forms: [
      {
        kind: 'submit',
        form_id: 'submit-0001',
        form_version: 1,
        schema: { fields: [] },
        triggers: {
          intents: ['submit'],
          aliases: ['/submit'],
          threshold: 0.5,
        },
      },
      {
        kind: 'list',
        form_id: 'list-0001',
        form_version: 1,
        schema: { fields: [] },
        triggers: null,
      },
    ],
  } as any;
}

describe('definition forms types', () => {
  it('parses a forms[] document mirroring the fixture', () => {
    const forms = normalizeForms(buildFixture().forms);
    expect(forms).toHaveLength(2);
    expect(forms[0]?.kind).toBe('submit');
    expect(forms[1]?.kind).toBe('list');
    const def = {
      name: 't',
      app_id: 't',
      version: 1,
      status: 'draft',
      owner_id: 'u',
      forms,
    } as unknown as AppDefinition;
    expect(def.forms?.[0]?.form_id).toMatch(/^submit-/);
    expect(def.forms?.[1]?.form_id).toMatch(/^list-/);
  });

  it('normalizes malformed elements to empty submit by default', () => {
    const forms = normalizeForms([{} as any]);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.kind).toBe('submit');
    expect(forms[0]?.form_version).toBe(1);
    expect(forms[0]?.schema).toEqual(null);
  });
});
