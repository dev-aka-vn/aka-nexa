import { describe, expect, it } from 'vitest';

import type { PublishedApp } from './published-app-loader.js';
import { PublishedAppLoader, appIdOfToolId } from './published-app-loader.js';

describe('PublishedAppLoader', () => {
  it('projects triggered forms as tools with form-scoped ids', async () => {
    const catalog: PublishedApp[] = [
      {
        id: 'app',
        description: 'desc',
        parameters: [],
        intents: ['do thing'],
        aliases: ['do thing'],
        threshold: 0.8,
        status: 'published',
        forms: [
          {
            form_id: 'submit',
            kind: 'submit',
            action: 'create',
            intents: ['do thing'],
            aliases: ['do thing'],
            threshold: 0.8,
            description: 'desc',
            form_version: 1,
          },
          {
            form_id: 'list',
            kind: 'list',
            action: 'query',
            intents: ['list things'],
            aliases: ['list things'],
            threshold: 0.8,
            description: 'desc',
            form_version: 2,
          },
        ],
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => true);
    const authorized = await loader.listAuthorized('u1');
    expect(authorized.map((a) => a.tool.id)).toEqual(['app:submit', 'app:list']);
  });

  it('triggers: null yields no tool (no entry)', async () => {
    const catalog: PublishedApp[] = [
      {
        id: 'app',
        description: 'desc',
        parameters: [],
        intents: [],
        aliases: [],
        threshold: 0.8,
        status: 'published',
        forms: [],
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => true);
    const authorized = await loader.listAuthorized('u1');
    expect(authorized).toHaveLength(0);
  });

  it('excluded user yields zero tools despite triggered forms (S8)', async () => {
    const catalog: PublishedApp[] = [
      {
        id: 'app',
        description: 'desc',
        parameters: [],
        intents: ['do thing'],
        aliases: ['do thing'],
        threshold: 0.8,
        status: 'published',
        forms: [
          {
            form_id: 'submit',
            kind: 'submit',
            action: 'create',
            intents: ['do thing'],
            aliases: ['do thing'],
            threshold: 0.8,
            description: 'desc',
            form_version: 1,
          },
        ],
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => false);
    const authorized = await loader.listAuthorized('u1');
    expect(authorized).toHaveLength(0);
  });

  it('deprecated/draft apps are skipped', async () => {
    const catalog: PublishedApp[] = [
      {
        id: 'app',
        description: 'desc',
        parameters: [],
        intents: [],
        aliases: [],
        threshold: 0.8,
        status: 'draft',
        forms: [],
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => true);
    const authorized = await loader.listAuthorized('u1');
    expect(authorized).toHaveLength(0);
  });

  it('four-kind action mapping is projected', async () => {
    const catalog: PublishedApp[] = [
      {
        id: 'app',
        description: 'desc',
        parameters: [],
        intents: [],
        aliases: [],
        threshold: 0.8,
        status: 'published',
        forms: (['submit', 'list', 'show', 'edit'] as const).map((kind) => ({
          form_id: kind,
          kind,
          action:
            kind === 'submit'
              ? 'create'
              : kind === 'list'
                ? 'query'
                : kind === 'show'
                  ? 'view'
                  : 'edit',
          intents: ['x'],
          aliases: ['x'],
          threshold: 0.8,
          description: 'desc',
          form_version: 1,
        })),
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => true);
    const authorized = await loader.listAuthorized('u1');
    const actions = authorized.map((a) => a.form.action);
    expect(actions).toEqual(['create', 'query', 'view', 'edit']);
  });

  it('appIdOfToolId round-trips', () => {
    expect(appIdOfToolId('leave-request:submit')).toBe('leave-request');
    expect(appIdOfToolId('a:b:c'.split(':')[0] + ':x')).toBe('a');
  });
});

// also ensure authorized.form is set
describe('PublishedAppLoader form', () => {
  it('AuthorizedApp.form is the matched form', async () => {
    const catalog: PublishedApp[] = [
      {
        id: 'app',
        description: 'desc',
        parameters: [],
        intents: ['do thing'],
        aliases: ['do thing'],
        threshold: 0.8,
        status: 'published',
        forms: [
          {
            form_id: 'submit',
            kind: 'submit',
            action: 'create',
            intents: ['do thing'],
            aliases: ['do thing'],
            threshold: 0.8,
            description: 'desc',
            form_version: 3,
          },
        ],
      },
    ];
    const loader = new PublishedAppLoader(catalog, async () => true);
    const authorized = await loader.listAuthorized('u1');
    expect(authorized[0]!.form.form_version).toBe(3);
  });
});