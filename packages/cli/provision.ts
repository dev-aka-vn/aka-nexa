import { runConnectorLoader } from './connector.js';

export async function provision(
  args: string[] = process.argv.slice(2),
  registry?: any,
  credsRepo?: any,
): Promise<void> {
  await runConnectorLoader(args, registry, credsRepo);
}
