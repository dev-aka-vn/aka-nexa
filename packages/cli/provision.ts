import { runConnectorLoader } from './connector.js';
import type {
  ConnectorCredentialsRepository,
  ConnectorRegistry,
} from '@akane/domain';

export async function provision(
  args: string[] = process.argv.slice(2),
  registry?: ConnectorRegistry,
  credsRepo?: ConnectorCredentialsRepository,
): Promise<void> {
  await runConnectorLoader(args, registry, credsRepo);
}
