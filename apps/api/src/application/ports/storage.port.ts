export interface StoredObject {
  objectId: string;
  sha256: string;
  sizeBytes: number;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface PutObjectInput {
  content: AsyncIterable<Uint8Array>;
  sha256: string;
  sizeBytes: number;
}

export interface StoragePort {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  statObject(objectId: string): Promise<StoredObject | null>;
  openRead(objectId: string, range?: ByteRange): Promise<AsyncIterable<Uint8Array>>;
  deleteObject(objectId: string): Promise<void>;
  freeBytes(): Promise<number>;
}
