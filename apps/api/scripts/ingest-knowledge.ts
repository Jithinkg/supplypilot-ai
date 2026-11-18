import '../src/config/load-env.js';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../src/middleware/errors.js';
import { createDatabase } from '../src/db/client.js';
import { readEnv } from '../src/config/env.js';
import { createAuthService, type AuthSession } from '../src/services/auth.js';
import { createKnowledgeService } from '../src/knowledge/service.js';
import { policyFixtures, syntheticPdf } from '../src/knowledge/fixtures.js';
const env = readEnv();
const db = createDatabase(env.DATABASE_URL);
const auth = createAuthService(db);
const knowledge = createKnowledgeService(db, { enabled: env.RAG_ENABLED, threshold: env.RAG_MIN_SIMILARITY });
let stage = 'authentication';
let operatorSession: AuthSession | null = null;
try {
  const credentials = z.object({ SEED_MANAGER_EMAIL: z.email(), SEED_MANAGER_PASSWORD: z.string().min(1) }).parse(process.env);
  const session = await auth.login(credentials.SEED_MANAGER_EMAIL, credentials.SEED_MANAGER_PASSWORD, randomUUID());
  const resolved = await auth.resolve(session.token);
  if (!resolved || resolved.user.role !== 'MANAGER') throw new Error('Manager authentication required.');
  operatorSession = resolved;
  stage = 'upload';
  const actor = { userId: resolved.user.id, sessionId: resolved.sessionId, requestId: randomUUID() };
  const args = process.argv.slice(2);
  const [path, type = 'PROCUREMENT_POLICY', title = 'Procurement policy', supplierId] = args;
  if (!path) throw new Error('Usage: knowledge:ingest -- <file.pdf|--synthetic|--reembed documentUUID [supplierUUID]> [PROCUREMENT_POLICY|SUPPLIER_CONTRACT] [title] [supplier UUID]');
  if (path === '--synthetic' && type !== 'PROCUREMENT_POLICY') throw new Error('Synthetic fixture is a procurement policy.');
  const supplierScope = path === '--reembed' ? z.uuid().optional().parse(args[2]) : supplierId;
  const bytes = path === '--reembed' ? new Uint8Array() : path === '--synthetic' ? await syntheticPdf(policyFixtures.map((fixture) => fixture.text)) : await readFile(path);
  const document = path === '--reembed' ? await knowledge.reembed(z.uuid().parse(args[1]), actor, supplierScope) : await knowledge.upload({ title: path === '--synthetic' ? 'SYNTHETIC DEMO procurement policies' : title, type, ...(supplierId ? { supplierId } : {}) }, { bytes, filename: path === '--synthetic' ? 'synthetic-policy.pdf' : basename(path), mime: 'application/pdf' }, actor);
  if (document.status === 'ARCHIVED') throw new Error('This document was archived; duplicate upload does not reactivate it.');
  if (document.status === 'FAILED') await knowledge.retry(document.id, actor, supplierScope);
  stage = 'ingestion';
  for (let count = 0; count < 300; count++) {
    const current = await knowledge.get(document.id, actor, supplierScope);
    if (current.status === 'READY') { console.log(`READY: document ${current.id}; ${current.pageCount} pages. No business seed was run.`); break; }
    if (current.status === 'FAILED' || count === 299) throw new Error('Ingestion did not complete; inspect document status.');
    await knowledge.processNext();
    if (current.status === 'PROCESSING') await new Promise((resolve) => setTimeout(resolve, 250));
  }
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith('Usage:') ? error.message : `Knowledge ingestion failed at ${stage}; ${error instanceof HttpError ? error.code : 'check configuration and document status'}. No business data was reseeded.`);
  process.exitCode = 1;
} finally { if (operatorSession) await auth.logout(operatorSession, randomUUID()).catch(() => { console.warn('Operator session cleanup unavailable.'); }); await knowledge.stop(); await db.$disconnect(); }
