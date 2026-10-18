import { describe, it, expect } from 'vitest';

import {
  AppFormElementSchema,
  type AppDefinition,
} from './definition.js';

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
        kind: 'review',
        form_id: 'review-0001',
        form_version: 1,
        schema: { fields: [] },
        triggers: null,
      },
    ],
  } as any;
}

describe('definition forms types', () => {
  it('parses a forms[] document mirroring the fixture', () => {
    const forms = buildFixture().forms;
    const parsed = AppFormElementSchema.array().parse(forms);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.kind).toBe('submit');
    expect(parsed[1]?.kind).toBe('review');
    const def = {
      name: 't',
      app_id: 't',
      version: 1,
      status: 'draft',
      owner_id: 'u',
      forms,
    } as unknown as AppDefinition;
    expect(def.forms?.[0]?.form_id).toMatch(/^submit-/);
    expect(def.forms?.[1]?.form_id).toMatch(/^review-/);
  });
});
