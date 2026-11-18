import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { createDatabase } from './db/client.js';
import { readEnv } from './config/env.js';
import { hashToken } from './services/auth.js';
import { createKnowledgeService } from './knowledge/service.js';
import { policyFixtures, missingQuestions, syntheticPdf } from './knowledge/fixtures.js';
import { localEmbeddings } from './knowledge/embeddings.js';
import type { Actor } from './knowledge/access.js';
const db = createDatabase(readEnv().DATABASE_URL);
// Threshold frozen before evaluating the labeled questions. Calibration uses a
// separate pair below; expected-answer labels do not tune the threshold.
const THRESHOLD = 0.45;
const service = createKnowledgeService(db, { threshold: THRESHOLD });
const report = { threshold: THRESHOLD, answerableCorrect: 0, answerableTotal: 10, missingCorrect: 0, missingTotal: 5, citationsValidated: 0, profileId: '', calibration: { relevant: 0, unrelated: 0 } };
let manager: Actor, staff: Actor; let documentId: string;
beforeAll(async () => {
  const managerUser = await db.user.findFirstOrThrow({ where: { role: 'MANAGER' } }); const staffUser = await db.user.findFirstOrThrow({ where: { role: 'STAFF' } });
  manager = { userId: managerUser.id, sessionId: randomUUID(), requestId: randomUUID() }; staff = { userId: staffUser.id, sessionId: randomUUID(), requestId: randomUUID() };
  for (const actor of [manager, staff]) await db.session.create({ data: { id: actor.sessionId, userId: actor.userId, tokenHash: hashToken(randomBytes(32).toString('hex')), csrfSecret: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 3600000) } });
  const doc = await service.upload({ title: 'Synthetic procurement evaluation', type: 'PROCUREMENT_POLICY' }, { bytes: await syntheticPdf(policyFixtures.map((fixture) => fixture.text)), filename: 'synthetic-evaluation.pdf', mime: 'application/pdf' }, manager); documentId = doc.id;
  await service.processNext();
  const current = await service.get(documentId, manager); expect(current.status, current.errorCode ?? '').toBe('READY');
});
afterAll(async () => { const dir = fileURLToPath(new URL('../../../.cache', import.meta.url)); await mkdir(dir, { recursive: true }); await writeFile(`${dir}/rag-evaluation.json`, JSON.stringify(report, null, 2)); await service.stop(); await db.$disconnect(); });
it('records a separate calibration sanity check at the frozen threshold', async () => {
  const encoder = await localEmbeddings();
  const vectors = await encoder.embed(['A manager reviews procurement requests.', 'Who reviews a procurement request?', 'Penguins nest on Antarctic ice.']);
  const cosine = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index]!, 0);
  report.profileId = encoder.profile.id; report.calibration = { relevant: cosine(vectors[0]!, vectors[1]!), unrelated: cosine(vectors[0]!, vectors[2]!) };
  expect(cosine(vectors[0]!, vectors[1]!)).toBeGreaterThan(THRESHOLD);
  expect(cosine(vectors[0]!, vectors[2]!)).toBeLessThan(THRESHOLD);
  console.log(`Local MiniLM calibration sanity PASS; frozen similarity threshold ${THRESHOLD}.`);
});
it('retrieves the expected page in top five for at least 80% of ten answerable questions', async () => {
  let correct = 0;
  for (const [index, fixture] of policyFixtures.entries()) {
    const result = await service.search({ type: 'PROCUREMENT_POLICY', query: fixture.query }, staff);
    if (result.citations.some((citation) => citation.documentId === documentId && citation.pageNumber === index + 1)) correct++;
    for (const citation of result.citations) { await expect(service.citation(citation, staff)).resolves.toEqual(citation); report.citationsValidated++; }
  }
  console.log(`Real local-model/pgvector retrieval: ${correct}/10 expected pages in top five.`);
  report.answerableCorrect = correct;
  expect(correct).toBeGreaterThanOrEqual(8);
});
it('abstains for five unrelated missing-evidence questions', async () => {
  for (const query of missingQuestions) {
    const result = await service.search({ type: 'PROCUREMENT_POLICY', query }, staff);
    expect(result.outcome, query).toBe('INSUFFICIENT_EVIDENCE'); expect(result.citations).toEqual([]); report.missingCorrect++;
  }
});
