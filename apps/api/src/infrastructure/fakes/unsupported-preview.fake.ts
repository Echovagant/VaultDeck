import type {
  PreviewCapability,
  PreviewInput,
  PreviewPort,
  PreviewResult,
} from '../../application/ports/preview.port';

export class UnsupportedPreviewFake implements PreviewPort {
  capabilities(): PreviewCapability {
    return { supported: false, formats: [] };
  }

  async convert(_input: PreviewInput): Promise<PreviewResult> {
    return { kind: 'unsupported', reason: 'fake 无预览能力，前端应降级为下载' };
  }
}
