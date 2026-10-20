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
      // Direct delete calls against the audit collection. The delete must be
      // audit-scoped: a delete call with `audit_entries` (or an audit-named
      // collection variable) in the preceding statement. Files that merely
      // mention `audit_entries` while deleting a *different* collection (e.g.
      // the erasure service redacts audit rows but only deletes mapping rows)
      // are not offenders.
      let directDelete = false;
      if (/\.deleteMany\(|\.deleteOne\(|findOneAndDelete|bulkWrite/.test(src)) {
        const re = /\.deleteMany\(|\.deleteOne\(|findOneAndDelete|bulkWrite/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
          const start = Math.max(0, m.index - 200);
          const window = src.slice(start, m.index);
          if (/audit_entries|auditCollection|audit_collection/.test(window)) {
            directDelete = true;
            break;
          }
        }
      }
      directDelete = directDelete && !rel.endsWith('packages/domain/src/audit/audit.repository.ts');
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
