// `bun run auth:setup` — guided, re-runnable setup that puts Fleet behind the
// shared auth relay. It automates everything except the steps that are human by
// design (Google console, the one-time operator claim, the registration form) and
// detects their completion from the live databases. See packages/auth-relay.
import { readFileSync, writeFileSync } from 'node:fs';
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
    inventoryText,
    writeInventory: (text) => writeFileSync(path, text),
    vault: readLiveVault,
    store: (urls) => openStore(relay, urls),
  });
}

main().catch((error: unknown) => {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
