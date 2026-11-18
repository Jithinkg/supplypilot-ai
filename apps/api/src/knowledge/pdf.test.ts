import { expect, it } from 'vitest';
import { chunkPages, extractPdf, validatePdf, MAX_PDF_BYTES } from './pdf.js';
import { syntheticPdf } from './fixtures.js';
it('validates extension, MIME, signature and size', () => {
  expect(() => validatePdf(Buffer.from('%PDF-1.7'), 'policy.pdf', 'application/pdf')).not.toThrow();
  expect(() => validatePdf(Buffer.from('%PDF-1.7'), 'policy.exe', 'application/pdf')).toThrow();
  expect(() => validatePdf(Buffer.from('%PDF-1.7'), 'policy.pdf', 'text/plain')).toThrow();
  expect(() => validatePdf(Buffer.from('not a pdf'), 'policy.pdf', 'application/pdf')).toThrow();
  expect(() => validatePdf(new Uint8Array(MAX_PDF_BYTES + 1), 'policy.pdf', 'application/pdf')).toThrow();
});
it('extracts original page numbers while skipping blank pages', async () => {
  const output = await extractPdf(await syntheticPdf(['First page policy.', '', 'Third page clause.']));
  expect(output.pageCount).toBe(3);
  expect(output.pages.map((page) => page.pageNumber)).toEqual([1, 3]);
});
it('rejects blank/image-only and malformed PDFs', async () => {
  await expect(extractPdf(await syntheticPdf(['']))).rejects.toMatchObject({ code: 'PDF_NO_TEXT' });
  await expect(extractPdf(Buffer.from('%PDF-not-valid'))).rejects.toMatchObject({ code: 'PDF_UNREADABLE' });
});
it('rejects documents beyond fifty pages', async () => {
  await expect(extractPdf(await syntheticPdf(Array.from({ length: 51 }, () => 'text')))).rejects.toMatchObject({ code: 'PDF_PAGE_LIMIT' });
});
it('chunks within pages, bounds tokens and retains exact source offsets', () => {
  const pages = [{ pageNumber: 3, text: Array.from({ length: 450 }, (_, index) => `word${index}`).join(' ') }, { pageNumber: 5, text: 'Last clause' }];
  const chunks = chunkPages(pages, (text) => text.trim().split(/\s+/).length);
  expect(chunks.length).toBeGreaterThan(2);
  for (const chunk of chunks) {
    expect(chunk.text.trim().split(/\s+/).length).toBeLessThanOrEqual(180);
    expect(pages.find((page) => page.pageNumber === chunk.pageNumber)?.text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
  }
  expect(chunks[1]!.startOffset).toBeLessThan(chunks[0]!.endOffset);
  expect(chunks.at(-1)?.pageNumber).toBe(5);
});
it('rejects an encrypted PDF instead of attempting password recovery', async () => {
  const { PDFDocument, PDFName, PDFHexString } = await import('pdf-lib');
  const document = await PDFDocument.create(); document.addPage();
  document.context.trailerInfo.Encrypt = document.context.register(document.context.obj({ Filter: PDFName.of('Standard'), V: 1, R: 2, Length: 40, O: PDFHexString.of('00'.repeat(32)), U: PDFHexString.of('00'.repeat(32)), P: -4 }));
  await expect(extractPdf(await document.save())).rejects.toMatchObject({ code: 'PDF_UNREADABLE' });
});
