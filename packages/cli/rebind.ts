import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppRepository, AuditRepository } from '@akane/domain';

export interface AppSeed {
  readonly app_id: string;
  readonly connector_ref: string;
  readonly [key: string]: unknown;
}

const DEFAULT_SEED_PATH = resolve(process.cwd(), 'config/apps/app.json');

export async function loadAppSeed(seedPath: string = DEFAULT_SEED_PATH): Promise<AppSeed> {
  if (!existsSync(seedPath)) {
    throw new Error(`App seed file not found: ${seedPath}`);
  }
  const raw = readFileSync(seedPath, 'utf8');
  const seed = JSON.parse(raw) as AppSeed;
  if (!seed.app_id || !seed.connector_ref) {
    throw new Error('App seed is missing required fields');
  }
  return seed;
}

export async function rebindConnectorRef(
  seed: AppSeed,
  appRepo: AppRepository,
  auditRepo: AuditRepository,
): Promise<{ changed: boolean }> {
  const existing = await appRepo.findByAppId(seed.app_id);
  const oldRef = existing?.connector_ref;
  const newRef = seed.connector_ref;

  if (oldRef === newRef) {
    return { changed: false };
  }

  // Write AUD-01 before applying change
  await auditRepo.append({
    timestamp: new Date(),
    actor: 'cli:rebind',
    action: 'app_connector_ref_change',
    target: seed.app_id,
    previous_state: oldRef || 'none',
    new_state: newRef,
  });

  await appRepo.updateConnectorRef(seed.app_id, newRef);
  return { changed: true };
}

export async function runRebind(
  args: string[] = process.argv.slice(2),
  deps?: {
    appRepo: AppRepository;
    auditRepo: AuditRepository;
  },
): Promise<void> {
  if (!deps) {
    throw new Error('Dependencies required');
  }
  const seedPath = args[0] ? resolve(args[0]) : DEFAULT_SEED_PATH;
  const seed = await loadAppSeed(seedPath);
  await rebindConnectorRef(seed, deps.appRepo, deps.auditRepo);
}
