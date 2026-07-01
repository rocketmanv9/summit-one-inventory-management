/**
 * PDF → text extraction (text-first strategy).
 *
 * Most vendor invoices/receipts are digital PDFs with a real text layer, which
 * is far cheaper and more accurate to read than rasterizing to an image. We use
 * pdfjs-dist's headless legacy build (no native deps, runs in the Node runtime).
 *
 * The import is dynamic + guarded so the pipeline degrades gracefully to the
 * vision fallback (or 'unsupported') if the dependency is unavailable in an
 * environment, rather than breaking the build.
 */

export interface PdfTextResult {
  text: string;
  pageCount: number;
  /** True when the PDF appears to be scanned (little/no extractable text). */
  likelyScanned: boolean;
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult | null> {
  try {
    // Non-literal specifier: keeps this off the type-checker's module graph so
    // the build succeeds whether or not pdfjs-dist is installed; resolved at
    // runtime in the Node route handler.
    const spec = 'pdfjs-dist/legacy/build/pdf.mjs';
    const pdfjs: any = await import(/* webpackIgnore: true */ spec);

    const loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await loadingTask.promise;
    const pageCount: number = doc.numPages;

    const parts: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as any[])
        .map((it) => (typeof it.str === 'string' ? it.str : ''))
        .join(' ');
      parts.push(pageText);
    }
    await doc.destroy?.();

    const text = parts.join('\n').replace(/[ \t]{2,}/g, ' ').trim();
    // Heuristic: a real text layer yields well more than a handful of chars/page.
    const likelyScanned = text.replace(/\s/g, '').length < Math.max(40, pageCount * 20);
    return { text, pageCount, likelyScanned };
  } catch {
    return null;
  }
}
