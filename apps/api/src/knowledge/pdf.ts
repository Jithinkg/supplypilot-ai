import { HttpError } from '../middleware/errors.js';
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export function validatePdf(bytes: Uint8Array, filename: string, mime: string) {
  if (bytes.length > MAX_PDF_BYTES) throw new HttpError(413, 'PDF_TOO_LARGE', 'PDF must be at most 10 MiB.');
  if (!/\.pdf$/i.test(filename) || mime !== 'application/pdf' || Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') throw new HttpError(400, 'INVALID_PDF', 'A text-based PDF file is required.');
}
export interface TextPage { pageNumber: number; text: string }
export interface TextChunk extends TextPage { ordinal: number; startOffset: number; endOffset: number }
export async function extractPdf(bytes: Uint8Array): Promise<{ pageCount: number; pages: TextPage[] }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, stopAtErrors: true, verbosity: 0 });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages < 1 || pdf.numPages > 50) throw new HttpError(400, 'PDF_PAGE_LIMIT', 'PDF must have between 1 and 50 pages.');
    const pages: TextPage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim();
      if (text) pages.push({ pageNumber: number, text });
      if (pages.reduce((sum, entry) => sum + entry.text.length, 0) > 1000000) throw new HttpError(400, 'PDF_TEXT_LIMIT', 'Extracted PDF text is too large.');
      page.cleanup();
    }
    if (!pages.length) throw new HttpError(400, 'PDF_NO_TEXT', 'PDF contains no extractable text. OCR is not supported.');
    return { pageCount: pdf.numPages, pages };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'PDF_UNREADABLE', 'PDF is encrypted or malformed.');
  } finally { await loading.destroy(); }
}
// Token-count the original substrings rather than decoding token IDs, preserving
// exact supporting text and offsets. Also handles a single oversized word.
export function chunkPages(pages: TextPage[], countTokens: (text: string) => number): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const page of pages) {
    let start = 0;
    while (start < page.text.length) {
      let low = start + 1, high = page.text.length, end = low;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (countTokens(page.text.slice(start, mid)) <= 180) { end = mid; low = mid + 1; } else high = mid - 1;
      }
      const text = page.text.slice(start, end);
      if (countTokens(text) > 180) throw new Error('Unable to split within token limit.');
      chunks.push({ ...page, text, ordinal: chunks.length, startOffset: start, endOffset: end });
      if (end === page.text.length) break;
      let overlap = end;
      while (overlap > start && countTokens(page.text.slice(overlap - 1, end)) <= 30) overlap--;
      start = Math.max(start + 1, overlap);
      if (chunks.length > 10000) throw new Error('Too many PDF chunks.');
    }
  }
  return chunks;
}
