import type { StoreFile } from '../../../application/ports/store.port';

export type PublicFile = Omit<StoreFile, 'objectPath'>;

export function toPublicFile(file: StoreFile): PublicFile {
  const { objectPath: _objectPath, ...rest } = file;
  return rest;
}
