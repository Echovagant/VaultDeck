export interface PreviewCapability {
  supported: boolean;
  formats: string[];
}

export type PreviewResult =
  { kind: 'pdf'; objectId: string } | { kind: 'unsupported'; reason: string };

export interface PreviewInput {
  fileId: string;
  fileName: string;
  objectId: string;
}

export interface PreviewPort {
  capabilities(): PreviewCapability;
  convert(input: PreviewInput): Promise<PreviewResult>;
}
