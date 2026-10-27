// Guided setup for the shared authentication relay only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authSetup } from './auth-setup/flow';
import { terminal } from './auth-setup/io';
import type { Inventory } from './auth-setup/model';
import { openStore } from './auth-setup/store';
import { Abort } from './vault-inputs/flow';
import { readLiveVault } from './vault-inputs/live';

const path = join(
  import.meta.dirname,
  '../packages/infra/tofu/modules/inventory/inventory.tf.json'
);

async function main() {
  if (!process.stdin.isTTY)
    throw new Abort('Run this in an interactive terminal.');
  const inventoryText = readFileSync(path, 'utf8');
  const inventory = JSON.parse(inventoryText).locals.inventory as Inventory;
  const relay = inventory.auth_relay.instances['production']!;
  await authSetup({
    io: terminal,
    inventory,
    vault: readLiveVault,
    store: (url) => openStore(relay, url),
  });
}

main().catch((error: unknown) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
