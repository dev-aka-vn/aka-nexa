import { describe, it, expect } from 'vitest';
import AuditExportService from './audit-export.service.js';

const makeRepo = () => ({
  findFiltered: async (filter: Record<string, unknown>) => {
    const base: Record<string, unknown>[] = [
      { _id: '1' as never, timestamp: new Date('2024-01-15T10:00:00Z'), actor_ref: 'u1', app_id: 'app1', action: 'create', target: 't1', data: { title: 'Test', optional_field: 'present' }, _rev: '1' },
      { _id: '2' as never, timestamp: new Date('2024-01-16T10:00:00Z'), actor_ref: 'u2', app_id: 'app1', action: 'update', target: 't2', data: { optional_field: 'also present' }, _rev: '2' },
      { _id: '3' as never, timestamp: new Date('2024-01-17T10:00:00Z'), actor_ref: 'u3', app_id: 'app2', action: 'delete', target: 't3', data: { title: 'No optional' }, _rev: '3' },
    ] as never;
    return base;
  },
  count: async () => 3,
} as never);

const makeService = () => new AuditExportService(makeRepo() as never);

describe('AUD-06: Audit trail exports as JSON Lines, lossless for optional fields', () => {
  it('produces valid JSON Lines with optional fields preserved', async () => {
    const service = makeService();
    const result = await service.exportJsonl({});

    // JSONL should be parseable line by line
    const lines = result.jsonl.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(3);

    // Each line should be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('data');
    }

    // Entry with optional_field should preserve it
    const hasOptional = lines.some((l) => {
      const parsed = JSON.parse(l);
      return parsed.data && typeof parsed.data.optional_field === 'string';
    });
    expect(hasOptional).toBe(true);

    // Entry without optional_field should not have the key
    const noOptional = lines.some((l) => {
      const parsed = JSON.parse(l);
      return parsed.data && !('optional_field' in parsed.data);
    });
    expect(noOptional).toBe(true);

    // Optional field values should match the repo data
    expect(result.rowCount).toBe(3);
    expect(result.data).toContain('present');
    expect(result.data).toContain('also present');
  });

  it('includes all fields including those with undefined values (stripped)', async () => {
    const service = makeService();
    const result = await service.exportJsonl({});

    const lines = result.jsonl.split('\n').filter((l) => l.length > 0);
    // The entry without optional_field should not have that key
    const noOptionalLine = lines.find((l) => {
      const parsed = JSON.parse(l);
      return parsed.data && !('optional_field' in parsed.data);
    });
    expect(noOptionalLine).toBeDefined();
  });
});