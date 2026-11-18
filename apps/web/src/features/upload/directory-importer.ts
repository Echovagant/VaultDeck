import { uploadFile } from './uploader';

export interface ImportResult {
  fileName: string;
  status: 'success' | 'skipped' | 'failed';
  message: string;
}

/** 以有限并发上传目录中的文件，返回每个文件的处理结果。 */
export async function importDirectory(input: {
  files: File[];
  projectId: string;
  folderId: string;
  concurrency?: number;
  onProgress: (done: number, total: number, current: string) => void;
}): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  const queue = [...input.files];
  const total = input.files.length;
  let done = 0;

  const workerCount = Math.max(1, Math.min(input.concurrency ?? 2, queue.length));

  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const file = queue.shift();
      if (!file) break;

      input.onProgress(done, total, file.name);
      try {
        const outcome = await uploadFile(file, input.projectId, input.folderId, () => {});
        results.push({
          fileName: file.name,
          status: outcome.instant ? 'skipped' : 'success',
          message: outcome.instant ? '秒传：已存在相同内容' : '',
        });
      } catch (error) {
        results.push({
          fileName: file.name,
          status: 'failed',
          message: error instanceof Error ? error.message : '上传失败',
        });
      } finally {
        done += 1;
        input.onProgress(done, total, file.name);
      }
    }
  });

  await Promise.all(workers);
  return results.sort((left, right) => left.fileName.localeCompare(right.fileName));
}
