/**
 * unpdf 的最小类型声明：api 的 moduleResolution=Node 解析不了该包的 .d.mts。
 * 只声明实际用到的两个函数；unpdf 是 UnJS 出品的 pdf.js 服务端轻包装（纯 JS）。
 */
declare module 'unpdf' {
  export interface PdfDocument {
    numPages: number;
    getMetadata: () => Promise<{ info?: Record<string, unknown> }>;
  }
  export function getDocumentProxy(data: Uint8Array): Promise<PdfDocument>;
  export function extractText(
    pdf: PdfDocument,
    options?: { mergePages?: boolean },
  ): Promise<{ totalPages: number; text: string | string[] }>;
}
