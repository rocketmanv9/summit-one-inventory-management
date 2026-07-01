/**
 * Image-conversion helpers for the vision fallback.
 *
 *   • rasterizePdfPage — render a scanned PDF's page to a PNG so the vision
 *     model can read a PDF that has no text layer.
 *   • heicToJpeg — convert an Apple HEIC/HEIF photo to JPEG (OpenAI vision does
 *     not accept HEIC).
 *
 * Both use optional native/wasm deps via guarded dynamic imports and return
 * null on any failure, so the pipeline degrades to 'unsupported' rather than
 * breaking when a dependency isn't available in an environment.
 */

/** Render one page of a PDF to PNG bytes (default: first page, 2× scale). */
export async function rasterizePdfPage(bytes: Uint8Array, pageNumber = 1, scale = 2): Promise<Uint8Array | null> {
  try {
    const pdfSpec = 'pdfjs-dist/legacy/build/pdf.mjs';
    const canvasSpec = '@napi-rs/canvas';
    const [pdfjs, canvasMod]: [any, any] = await Promise.all([
      import(/* webpackIgnore: true */ pdfSpec),
      import(/* webpackIgnore: true */ canvasSpec),
    ]);

    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: false }).promise;
    const page = await doc.getPage(Math.min(pageNumber, doc.numPages));
    const viewport = page.getViewport({ scale });

    const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx as any, viewport }).promise;
    const png = canvas.toBuffer('image/png');
    await doc.destroy?.();
    return new Uint8Array(png);
  } catch {
    return null;
  }
}

/** Convert HEIC/HEIF bytes to JPEG bytes. */
export async function heicToJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const spec = 'heic-convert';
    const mod: any = await import(/* webpackIgnore: true */ spec);
    const convert = mod.default ?? mod;
    const out: Buffer = await convert({ buffer: Buffer.from(bytes), format: 'JPEG', quality: 0.9 });
    return new Uint8Array(out);
  } catch {
    return null;
  }
}
