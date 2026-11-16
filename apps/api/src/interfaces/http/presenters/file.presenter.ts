import type { StoreFile } from '../../../application/ports/store.port';

export type PublicFile = Omit<StoreFile, 'objectPath'> & { hasContent: boolean };

export function toPublicFile(file: StoreFile): PublicFile {
  const { objectPath, ...rest } = file;
  return { ...rest, hasContent: objectPath.length > 0 };
}
