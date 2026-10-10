#!/usr/bin/env node
import { runConnectorLoader } from './connector.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === 'connector' || command === 'upsert') {
    const rest = args.slice(1);
    await runConnectorLoader(rest);
  } else {
    // Default behavior
    await runConnectorLoader(args);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
