// Synthetic documents only. These are retrieval fixtures, not application rules.
export const policyFixtures = [
  { query: 'How many competitive supplier quotations should buyers obtain?', text: 'Competitive quotations: buyers should collect three comparable supplier quotations for routine purchase recommendations. Quote comparisons are advisory until reviewed by a manager.' },
  { query: 'What information is required during supplier onboarding?', text: 'Supplier onboarding: collect the supplier tax registration number, legal business name, bank verification and primary contact before recommending a new vendor.' },
  { query: 'What are the standard invoice payment terms?', text: 'Invoice payment terms: standard payment is due thirty calendar days after receipt of a verified invoice. Contract-specific payment terms must be reviewed separately.' },
  { query: 'How should damaged deliveries be documented?', text: 'Damaged deliveries: receiving staff should photograph damaged packaging, record the quantity affected and notify the procurement manager within two business days.' },
  { query: 'What should employees disclose about conflicts of interest?', text: 'Conflicts of interest: employees must disclose ownership interests or family relationships involving a proposed supplier before participating in its purchase review.' },
  { query: 'How long should purchasing records be retained?', text: 'Record retention: procurement quotation comparisons, manager decisions and invoice records should be retained for seven years in the approved records system.' },
  { query: 'What packaging sustainability information is requested?', text: 'Packaging sustainability: request recyclable packaging, reduced single-use plastic and disclosure of recycled material content from suppliers when evaluating equivalent quotations.' },
  { query: 'How should urgent purchases be explained?', text: 'Urgent purchases: record the operational reason for urgency, expected stockout date and delivery constraints in the purchase recommendation for the manager to review.' },
  { query: 'How should supplier bank detail changes be verified?', text: 'Bank detail changes: verify changed supplier bank information through an independently confirmed contact channel before updating financial records.' },
  { query: 'What should buyers check about hazardous material documentation?', text: 'Hazardous materials: request a current safety data sheet and handling instructions for chemicals or other regulated hazardous supplies.' },
];
export const missingQuestions = ['Which planet has the largest rings?', 'How do penguins breed in Antarctica?', 'Who won the world football championship?', 'What is the boiling temperature of liquid nitrogen?', 'How do I bake a chocolate cake?'];
export async function syntheticPdf(pages: string[]) {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const document = await PDFDocument.create();
  document.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  document.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = document.addPage([612, 792]);
    const words = text.split(' '); let line = ''; let y = 740;
    for (const word of words) {
      if (font.widthOfTextAtSize(`${line} ${word}`, 11) > 500) { page.drawText(line, { x: 50, y, font, size: 11 }); y -= 18; line = ''; }
      line = line ? `${line} ${word}` : word;
    }
    if (line) page.drawText(line, { x: 50, y, font, size: 11 });
  }
  return document.save();
}
