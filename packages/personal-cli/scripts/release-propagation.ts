import { registryDocument } from './release-model';
import type { RegistryDocument } from './release-model';

/** Read after publication only; retries never perform another publish. */
export async function propagatedDocument(
  version: string,
  read: () => Promise<RegistryDocument | null> = registryDocument,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<RegistryDocument | null> {
  let document: RegistryDocument | null = null;
  for (let attempt = 0; attempt < 13; attempt += 1) {
    if (attempt) await pause(Math.min(attempt * 2_000, 10_000));
    try {
      document = await read();
    } catch (error) {
      if (attempt === 12) throw error;
      continue;
    }
    if (document?.versions[version] && document['dist-tags'].latest === version)
      break;
  }
  return document;
}
