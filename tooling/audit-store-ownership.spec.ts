import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('audit store single delete owner (D-04)', () => {
  it('only the retention service deletes audit rows', () => {
    const files = walk(ROOT).filter((f) => !f.includes('/dist/') && !f.endsWith('audit-store-ownership.spec.ts'));
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(ROOT, file);
      // Direct delete calls against the audit collection.
      const directDelete =
        /audit_entries/.test(src) &&
        /\.deleteMany\(|\.deleteOne\(|findOneAndDelete|bulkWrite/.test(src) &&
        !rel.endsWith('packages/domain/src/audit/audit.repository.ts');
      // Or a call to the repository's single delete entry point.
      const viaRepo = /\.deleteOlderThan\(/.test(src);
      if (directDelete || viaRepo) {
        offenders.push(rel);
      }
    }
    // Non-vacuity: the scan must actually find the retention service.
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders).toContain(
      'packages/domain/src/audit/audit-retention.service.ts',
    );
    // Only the retention service.
    const unexpected = offenders.filter(
      (f) => f !== 'packages/domain/src/audit/audit-retention.service.ts',
    );
    expect(unexpected).toEqual([]);
  });
});
