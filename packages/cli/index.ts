#!/usr/bin/env node
import { runConnectorLoader } from './connector.js';
import { runEraseActor } from './erase-actor.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === 'erase-actor' || command === 'erase') {
    const rest = args.slice(1);
    await runEraseActor(rest);
  } else if (command === 'connector' || command === 'upsert') {
    const rest = args.slice(1);
    await runConnectorLoader(rest);
  } else {
    await runConnectorLoader(args);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
