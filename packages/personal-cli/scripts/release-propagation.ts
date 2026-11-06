import { registryDocument } from './release-model';
import type { RegistryDocument } from './release-model';

/** Read after publication only; retries never perform another publish. */
export async function propagatedDocument(
  version: string,
  read: () => Promise<RegistryDocument | null> = registryDocument,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  confirmed: (document: RegistryDocument) => boolean = () => true
): Promise<RegistryDocument | null> {
  let document: RegistryDocument | null = null;
  for (let attempt = 0; attempt < 34; attempt += 1) {
    if (attempt) await pause(Math.min(attempt * 2_000, 10_000));
    try {
      document = await read();
    } catch (error) {
      if (attempt === 33) throw error;
      continue;
    }
    if (publishedLatest(document, version) && confirmed(document!)) break;
  }
  return document;
}

function publishedLatest(
  document: RegistryDocument | null,
  version: string
): boolean {
  return Boolean(
    document?.versions[version] && document['dist-tags'].latest === version
  );
}
