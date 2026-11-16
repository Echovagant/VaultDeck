import { execFile } from 'node:child_process';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { PreviewUnavailable } from '../../domain/errors';

const execFileAsync = promisify(execFile);

const OFFICE_EXTENSIONS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf'];

export interface LibreOfficeOptions {
  sofficePath: string;
  cacheDir: string;
}

export class LibreOfficePreview {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: LibreOfficeOptions) {}

  capabilities(): { supported: boolean; formats: string[] } {
    return { supported: this.options.sofficePath.length > 0, formats: OFFICE_EXTENSIONS };
  }

  supports(fileName: string): boolean {
    return OFFICE_EXTENSIONS.includes(fileExtension(fileName));
  }

  async convertToPdf(input: { fileId: string; objectPath: string }): Promise<string> {
    const task = this.queue.then(() => this.runConversion(input));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async runConversion(input: { fileId: string; objectPath: string }): Promise<string> {
    if (!this.options.sofficePath) {
      throw new PreviewUnavailable('未配置 LibreOffice，Office 预览不可用');
    }

    const cachePath = path.join(this.options.cacheDir, `${input.fileId}.pdf`);
    try {
      const cached = await stat(cachePath);
      if (cached.size > 0) return cachePath;
    } catch {
      // 未缓存，继续转换
    }

    const workDir = path.join(this.options.cacheDir, 'work', input.fileId);
    const profileDir = path.join(this.options.cacheDir, 'profile');
    await mkdir(workDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });

    const profilePath = profileDir.replace(/\\/g, '/');
    const args = [
      '--headless',
      '--norestore',
      '--invisible',
      '--nologo',
      `-env:UserInstallation=file:///${profilePath}`,
      '--convert-to',
      'pdf',
      '--outdir',
      workDir,
      input.objectPath,
    ];

    try {
      await execFileAsync(this.options.sofficePath, args, {
        timeout: 120000,
        windowsHide: true,
      });
    } catch (error) {
      throw new PreviewUnavailable(
        `Office 转换失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const sourceBase = path.basename(input.objectPath).replace(/\.[^.]*$/, '');
    const produced = path.join(workDir, `${sourceBase}.pdf`);
    try {
      await stat(produced);
    } catch {
      throw new PreviewUnavailable('Office 转换未生成 PDF');
    }

    await rename(produced, cachePath);
    return cachePath;
  }
}

export function fileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? (parts[parts.length - 1] ?? '').toLowerCase() : '';
}

export function createLibreOfficePreview(): LibreOfficePreview {
  return new LibreOfficePreview({
    sofficePath: process.env['VD_SOFFICE_PATH'] ?? '',
    cacheDir: path.resolve(process.env['VD_PREVIEW_CACHE'] ?? '_private/storage/previews'),
  });
}
