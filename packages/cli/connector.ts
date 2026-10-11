import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ConnectorCredentialsRepository,
  ConnectorRegistry,
  RedmineAdapter,
  RestCore,
  parseConnectorLimit,
} from '@akane/domain';

export interface ConnectorSeed {
  readonly connector_ref: string;
  readonly connector_id: string;
  readonly name: string;
  readonly base_url: string;
  readonly credential_ref: string;
  readonly timeout_ms?: number;
  readonly retries?: number;
  readonly rate_limit?: Record<string, unknown>;
  readonly mapping?: Record<string, unknown>;
  readonly taxonomy?: Record<string, unknown>;
}

const DEFAULT_SEED_PATH = resolve(process.cwd(), 'config/connectors/redmine.dev.json');

export async function loadConnectorSeed(seedPath: string = DEFAULT_SEED_PATH): Promise<ConnectorSeed> {
  if (!existsSync(seedPath)) {
    throw new Error(`Connector seed file not found: ${seedPath}`);
  }
  const raw = readFileSync(seedPath, 'utf8');
  const seed = JSON.parse(raw) as ConnectorSeed;
  if (!seed.connector_ref || !seed.base_url || !seed.credential_ref) {
    throw new Error('Connector seed is missing required fields');
  }
  return seed;
}

export async function upsertConnector(
  seed: ConnectorSeed,
  registry: ConnectorRegistry,
  credsRepo: ConnectorCredentialsRepository,
): Promise<{ changed: boolean }> {
  // For idempotence, we need to detect if anything changed.
  // Since registry stores adapter instances, comparing by config is tricky.
  // We'll track by storing a signature; alternatively, for this use case,
  // if re-running with identical file, consider no-op if we haven't changed.
  // But the spec says "a re-run with an unchanged file is a no-op" - so
  // we need to persist state? Or maybe just compare based on what we know.
  // Let us store metadata in registry or track externally.
  // Simpler approach: compute a hash of the seed and store it.
  const seedHash = Buffer.from(JSON.stringify(seed)).toString('base64');
  const stateKey = `__seed_hash_${seed.connector_ref}`;
  const stateStore = registry as unknown as Record<string, unknown>;
  const previousHash = stateStore[stateKey];
  if (previousHash === seedHash) {
    return { changed: false };
  }

  // Resolve credential
  const cred = await credsRepo.get(seed.credential_ref);
  if (!cred) {
    // If credential doesn't exist, we need to handle it.
    // For dev, maybe we can create a dummy or expect it to exist.
    // But the task says "resolve the credential via the injected repo"
    // Let us just try to get it - if null, that's an error case.
    throw new Error(`Credential not found: ${seed.credential_ref}`);
  }

  // Build adapter
  const rest = new RestCore(
    {
      baseUrl: seed.base_url,
      timeoutMs: seed.timeout_ms ?? 30000,
      retries: seed.retries ?? 3,
    },
    {
      headerName: cred.headerName,
      decryptedValue: cred.decryptedValue,
    },
  );
  const adapter = new RedmineAdapter(rest, {
    correlationCustomFieldId: seed.mapping?.['correlation_custom_field_id'] as string | undefined,
    realUserProfile: (seed.mapping?.['defaults'] as Record<string, unknown> | undefined) ?? {},
  });
  registry.register({
    connectorRef: seed.connector_ref,
    adapter,
    credentialRef: seed.credential_ref,
    // CON-05: the seed's `rate_limit` becomes the entry's budget. Absent or
    // invalid → the registry applies the conservative default at resolve time.
    limit: parseConnectorLimit(seed.rate_limit),
  });
  stateStore[stateKey] = seedHash;
  return { changed: true };
}

export async function runConnectorLoader(
  args: string[] = process.argv.slice(2),
  registry?: ConnectorRegistry,
  credsRepo?: ConnectorCredentialsRepository,
): Promise<void> {
  // This is the main entry point for CLI usage
  const seedPath = args[0] ? resolve(args[0]) : DEFAULT_SEED_PATH;
  const seed = await loadConnectorSeed(seedPath);
  if (!registry || !credsRepo) {
    throw new Error('Registry and credentials repo are required');
  }
  await upsertConnector(seed, registry, credsRepo);
}
