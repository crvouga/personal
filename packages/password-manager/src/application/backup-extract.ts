import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ManagerError } from '../domain/errors.ts';
import {
  assertPrivateLocation,
  checkPrivateDirectory,
} from '../adapters/paths.ts';
import { readBackup } from './backup.ts';
/** Deliberately selected plaintext transfer. Never an implicit verify/restore step. */
export async function extractBackup(input: {
  file: string;
  password: string;
  destination: string;
}) {
  const destination = assertPrivateLocation(input.destination);
  if (resolve(input.file) === destination)
    throw new ManagerError('unsafe-path');
  checkPrivateDirectory(dirname(destination));
  const payload = await readBackup(input);
  writeFileSync(
    destination,
    JSON.stringify({
      encrypted: false,
      folders: payload.folders ?? [],
      items: payload.vault,
    }),
    { mode: 0o600, flag: 'wx' }
  );
  return {
    status: 'extracted-sensitive-file',
    destination,
    items: payload.vault.length,
    next: 'Select Bitwarden JSON import in the deliberately isolated destination. Keep the active vault untouched; inspect imported fields and remove this plaintext transfer file afterward.',
    limitations: [
      'Attachments are metadata only.',
      'Hardware/nonportable credentials need supported exchange or re-enrollment.',
    ],
  };
}
