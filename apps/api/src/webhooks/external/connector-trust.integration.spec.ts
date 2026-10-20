import { describe, it, expect, vi } from 'vitest';
import { ConnectorTrustController } from './connector-trust.controller.js';

describe('connector trust controller', () => {
  it('requires global-admin role', async () => {
    const trustRepo = { get: vi.fn(), upsert: vi.fn(), list: vi.fn() } as any;
    const audit = { append: vi.fn() } as any;
    const controller = new ConnectorTrustController(trustRepo, audit);

    const req = { user: { realUserId: 'u1', role: 'user' } } as any;
    await expect(controller.list(req)).rejects.toBeTruthy();
  });

  it('POST then GET lists record with note', async () => {
    const records: any[] = [];
    const trustRepo = {
      get: vi.fn(async (id: string) => records.find((r) => r.connectorId === id) ?? null),
      upsert: vi.fn(async (id: string, input: any) => {
        const rec = { connectorId: id, ...input, updatedAt: new Date() };
        const idx = records.findIndex((r) => r.connectorId === id);
        if (idx >= 0) records[idx] = rec; else records.push(rec);
        return rec;
      }),
      list: vi.fn(async () => [...records]),
    } as any;
    const audit = { append: vi.fn() } as any;
    const controller = new ConnectorTrustController(trustRepo, audit);

    const adminReq = { user: { realUserId: 'admin-1', role: 'global-admin' } } as any;
    const { record } = await controller.upsertParam('conn-1', { mechanism: 'ip-allowlist', note: 'ingress allowlist' }, adminReq);
    expect(record.note).toBe('ingress allowlist');

    const listed = await controller.list(adminReq);
    expect(listed.records).toHaveLength(1);
    expect(listed.records[0].note).toBe('ingress allowlist');

    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'connector.trust_upserted' }));
  });

  it('refuses a record without a note', async () => {
    const trustRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
      list: vi.fn(),
    } as any;
    const audit = { append: vi.fn() } as any;
    const controller = new ConnectorTrustController(trustRepo, audit);
    const adminReq = { user: { realUserId: 'admin-1', role: 'global-admin' } } as any;
    await expect(controller.upsertParam('conn-1', { mechanism: 'ip-allowlist', note: '' }, adminReq)).rejects.toBeTruthy();
  });
});