import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { citationSchema, documentInputSchema, documentMetadataSchema, knowledgeQuerySchema, knowledgeResultSchema, knowledgeSearchSchema, type Citation, type KnowledgeResult, type KnowledgeSearch } from '@supplypilot/contracts';
import { z } from 'zod';
import { authorize, type Actor } from './access.js';
import { type Embeddings, localEmbeddings, validateVector } from './embeddings.js';
import { chunkPages, extractPdf, validatePdf } from './pdf.js';
import { HttpError } from '../middleware/errors.js';
const metadataSelect = { id: true, title: true, type: true, supplierId: true, originalFilename: true, pageCount: true, status: true, errorCode: true, createdAt: true, updatedAt: true } satisfies Prisma.KnowledgeDocumentSelect;
function metadata(row: { createdAt: Date; updatedAt: Date }) { return documentMetadataSchema.parse({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }); }
export const unavailableKnowledge = (): KnowledgeResult => ({ outcome: 'UNAVAILABLE', advisory: true, findings: 'Policy review is unavailable. No compliance approval has been provided.', citations: [] });
export function createKnowledgeService(db: PrismaClient, options: { embeddings?: () => Promise<Embeddings>; enabled?: boolean; threshold?: number; connectionString?: string } = {}) {
  const embeddings = options.embeddings ?? localEmbeddings;
  const enabled = options.enabled ?? true;
  const threshold = z.number().min(-1).max(1).parse(options.threshold ?? 0.45);
  let busy = false;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  async function scope(actor: Actor, type: string, supplierId?: string) {
    await authorize(db, actor, type === 'SUPPLIER_CONTRACT');
    if (type === 'SUPPLIER_CONTRACT' && (!supplierId || !await db.supplier.findUnique({ where: { id: supplierId } }))) throw new HttpError(404, 'SUPPLIER_NOT_FOUND', 'Supplier not found.');
  }
  async function get(id: string, actor: Actor, supplierId?: string) {
    await authorize(db, actor);
    const row = await db.knowledgeDocument.findUnique({ where: { id: z.uuid().parse(id) }, select: metadataSelect });
    // Staff must not learn whether a contract ID exists.
    const user = await authorize(db, actor);
    if (!row || (row.type === 'SUPPLIER_CONTRACT' && (user.role !== 'MANAGER' || row.supplierId !== supplierId))) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    return metadata(row);
  }
  async function event(action: string, id: string, actor: Actor) {
    await db.auditEvent.create({ data: { actorUserId: actor.userId, actorKind: 'HUMAN', action, entityType: 'KnowledgeDocument', entityId: id, requestId: actor.requestId, metadata: {} } });
  }
  async function lease() {
    const client = new pg.Client({ connectionString: options.connectionString ?? process.env.DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 3000 });
    let lost = false;
    client.on('error', () => { lost = true; });
    try {
      await client.connect();
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('SupplyPilot:knowledge-ingestion', 0)) AS locked");
      if (!lock.rows[0]?.locked) { await client.end(); return null; }
      return { client, lost: () => lost };
    } catch (error) { await client.end().catch(() => {}); throw error; }
  }
  async function processNext() {
    if (busy || stopped || !enabled) return;
    busy = true;
    let id: string | undefined;
    let activeLease: Awaited<ReturnType<typeof lease>> = null;
    try {
      activeLease = await lease();
      if (!activeLease) return;
      await db.knowledgeDocument.updateMany({ where: { status: 'PROCESSING' }, data: { status: 'FAILED', errorCode: 'INTERRUPTED' } });
      const doc = await db.knowledgeDocument.findFirst({ where: { status: 'QUEUED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (!doc) return;
      id = doc.id;
      const claimed = await db.knowledgeDocument.updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'PROCESSING', errorCode: null } });
      if (!claimed.count) return;
      const extracted = await extractPdf(doc.pdf);
      const encoder = await embeddings();
      const chunks = chunkPages(extracted.pages, encoder.countTokens);
      const vectors: number[][] = [];
      for (let offset = 0; offset < chunks.length; offset += 16) vectors.push(...await encoder.embed(chunks.slice(offset, offset + 16).map((chunk) => chunk.text)));
      if (vectors.length !== chunks.length) throw new Error('Incomplete embedding batch.');
      vectors.forEach((vector) => validateVector(vector, encoder.profile.dimensions));
      if (activeLease.lost()) throw new Error('Ingestion lease lost.');
      await db.$transaction(async (tx) => {
        // Updating first locks the document. An archive racing publication either
        // wins first or removes the newly READY document from retrieval afterward.
        const active = await tx.knowledgeDocument.updateMany({ where: { id: doc.id, status: 'PROCESSING' }, data: { status: 'READY', pageCount: extracted.pageCount } });
        if (!active.count) return;
        await tx.embeddingProfile.upsert({ where: { id: encoder.profile.id }, update: {}, create: encoder.profile });
        await tx.documentChunk.deleteMany({ where: { documentId: doc.id } });
        for (const [index, chunk] of chunks.entries()) {
          const chunkId = randomUUID();
          const vector = vectors[index];
          if (!vector) throw new Error('Missing embedding.');
          await tx.documentChunk.create({ data: { id: chunkId, documentId: doc.id, ...chunk, text: chunk.text, pageNumber: chunk.pageNumber } });
          await tx.$executeRaw`INSERT INTO "ChunkEmbedding" ("chunkId", "profileId", dimensions, embedding) VALUES (${chunkId}::uuid, ${encoder.profile.id}, ${encoder.profile.dimensions}, ${JSON.stringify(vector)}::vector)`;
        }
      }, { timeout: 30000 });
    } catch (error) {
      if (id) await db.knowledgeDocument.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', errorCode: error instanceof HttpError ? error.code : 'INGESTION_FAILED' } });
      // No document/parser/model text is logged.
    } finally { if (activeLease) await activeLease.client.end().catch(() => {}); busy = false; }
  }
  return {
    async upload(input: unknown, file: { bytes: Uint8Array; filename: string; mime: string }, actor: Actor) {
      await authorize(db, actor, true);
      if (!enabled) throw new HttpError(503, 'RAG_DISABLED', 'Knowledge ingestion is disabled.');
      const body = documentInputSchema.parse(input);
      await scope(actor, body.type, body.supplierId);
      validatePdf(file.bytes, file.filename, file.mime);
      const checksum = createHash('sha256').update(file.bytes).digest('hex');
      const dedupKey = `${body.type}:${body.supplierId ?? 'policy'}:${checksum}`;
      const row = await db.knowledgeDocument.upsert({ where: { dedupKey }, update: {}, create: { title: body.title, type: body.type, supplierId: body.supplierId ?? null, uploaderId: actor.userId, originalFilename: file.filename.slice(0, 200), checksum, dedupKey, pdf: Buffer.from(file.bytes) }, select: metadataSelect });
      await event('DOCUMENT_UPLOAD_REQUESTED', row.id, actor);
      return metadata(row);
    },
    async list(input: unknown, actor: Actor) {
      const query = knowledgeQuerySchema.parse(input);
      await scope(actor, query.type, query.supplierId);
      const where = { type: query.type, supplierId: query.supplierId ?? null };
      const [items, total] = await db.$transaction([db.knowledgeDocument.findMany({ where, select: metadataSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }), db.knowledgeDocument.count({ where })]);
      return { items: items.map(metadata), total, page: query.page, pageSize: query.pageSize };
    },
    async suppliers(actor: Actor) {
      await authorize(db, actor, true);
      return db.supplier.findMany({ select: { id: true, code: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    }, get,
    async file(id: string, actor: Actor, supplierId?: string) {
      const doc = await get(id, actor, supplierId);
      if (doc.status === 'ARCHIVED') throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
      // Recheck archive state in the read itself.
      const row = await db.knowledgeDocument.findFirst({ where: { id, status: { not: 'ARCHIVED' } }, select: { pdf: true } });
      if (!row) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
      return row.pdf;
    },
    async retry(id: string, actor: Actor, supplierId?: string) {
      await authorize(db, actor, true);
      await get(id, actor, supplierId);
      if (!enabled) throw new HttpError(503, 'RAG_DISABLED', 'Knowledge ingestion is disabled.');
      const changed = await db.knowledgeDocument.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'QUEUED', errorCode: null } });
      if (!changed.count) throw new HttpError(409, 'INVALID_DOCUMENT_STATE', 'Only failed documents can be retried.');
      await event('DOCUMENT_RETRIED', id, actor);
      return get(id, actor, supplierId);
    },
    async reembed(id: string, actor: Actor, supplierId?: string) {
      await authorize(db, actor, true);
      await get(id, actor, supplierId);
      if (!enabled) throw new HttpError(503, 'RAG_DISABLED', 'Knowledge ingestion is disabled.');
      const changed = await db.knowledgeDocument.updateMany({ where: { id, status: 'READY' }, data: { status: 'QUEUED', errorCode: null } });
      if (!changed.count) throw new HttpError(409, 'INVALID_DOCUMENT_STATE', 'Only ready documents can be re-embedded.');
      await event('DOCUMENT_REEMBED_REQUESTED', id, actor);
      return get(id, actor, supplierId);
    },
    async archive(id: string, actor: Actor, supplierId?: string) {
      await authorize(db, actor, true);
      await get(id, actor, supplierId);
      await db.knowledgeDocument.update({ where: { id }, data: { status: 'ARCHIVED', errorCode: null } });
      await event('DOCUMENT_ARCHIVED', id, actor);
      return get(id, actor, supplierId);
    },
    async search(input: KnowledgeSearch, actor: Actor): Promise<KnowledgeResult> {
      const query = knowledgeSearchSchema.parse(input);
      await scope(actor, query.type, query.supplierId);
      if (!enabled) return unavailableKnowledge();
      try {
        const encoder = await embeddings();
        if (encoder.countTokens(query.query) > 180) throw new HttpError(400, 'QUERY_TOO_LONG', 'Search query exceeds the embedding token limit.');
        const [vector] = await encoder.embed([query.query]);
        if (!vector) throw new Error('Query embedding unavailable.');
        validateVector(vector, encoder.profile.dimensions);
        const supplierFilter = query.type === 'SUPPLIER_CONTRACT' ? Prisma.sql`AND d."supplierId" = ${query.supplierId}::uuid` : Prisma.sql`AND d."supplierId" IS NULL`;
        const rows = await db.$queryRaw<{ documentId: string; chunkId: string; pageNumber: number; supportingText: string; similarity: number }[]>(Prisma.sql`
          WITH authorized AS MATERIALIZED (
            SELECT d.id AS "documentId", c.id AS "chunkId", c."pageNumber", c.text AS "supportingText", e.embedding
            FROM "ChunkEmbedding" e JOIN "DocumentChunk" c ON c.id = e."chunkId" JOIN "KnowledgeDocument" d ON d.id = c."documentId"
            WHERE d.status = 'READY' AND d.type = ${query.type}::"DocumentType" ${supplierFilter}
              AND e."profileId" = ${encoder.profile.id} AND e.dimensions = ${encoder.profile.dimensions}
          )
          SELECT "documentId", "chunkId", "pageNumber", "supportingText", 1 - (embedding <=> ${JSON.stringify(vector)}::vector) AS similarity
          FROM authorized WHERE 1 - (embedding <=> ${JSON.stringify(vector)}::vector) >= ${threshold}
          ORDER BY embedding <=> ${JSON.stringify(vector)}::vector, "chunkId" LIMIT 5`);
        // Recheck session role and document readiness after the potentially slow embed/search.
        await scope(actor, query.type, query.supplierId);
        const citations: Citation[] = [];
        for (const row of rows) {
          const current = await db.documentChunk.findFirst({ where: { id: row.chunkId, documentId: row.documentId, document: { status: 'READY', type: query.type, supplierId: query.supplierId ?? null } } });
          if (current && current.pageNumber === row.pageNumber && current.text === row.supportingText) citations.push(citationSchema.parse({ documentId: row.documentId, chunkId: row.chunkId, pageNumber: row.pageNumber, supportingText: row.supportingText }));
        }
        return knowledgeResultSchema.parse({ outcome: citations.length ? 'EVIDENCE_FOUND' : 'INSUFFICIENT_EVIDENCE', scope: { type: query.type, supplierId: query.supplierId ?? null }, advisory: true, findings: citations.length ? 'Relevant source passages were retrieved. These are advisory evidence, not compliance approval. Review the cited text.' : 'Insufficient relevant authorized evidence. No policy or contract conclusion can be supported.', citations });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        return unavailableKnowledge();
      }
    },
    async citation(input: Citation, actor: Actor, supplierId?: string) {
      if (!enabled) throw new HttpError(503, 'RAG_DISABLED', 'Knowledge review is unavailable.');
      const citation = citationSchema.parse(input);
      const doc = await get(citation.documentId, actor, supplierId);
      if (doc.status !== 'READY') throw new HttpError(404, 'CITATION_UNAVAILABLE', 'Citation is unavailable.');
      const row = await db.documentChunk.findFirst({ where: { id: citation.chunkId, documentId: citation.documentId, pageNumber: citation.pageNumber, document: { status: 'READY' } } });
      if (!row || !row.text.includes(citation.supportingText)) throw new HttpError(404, 'CITATION_UNAVAILABLE', 'Citation is unavailable.');
      return citation;
    }, processNext,
    async start() {
      if (!enabled) return;
      const recoveryLease = await lease();
      if (recoveryLease) { try { await db.knowledgeDocument.updateMany({ where: { status: 'PROCESSING' }, data: { status: 'FAILED', errorCode: 'INTERRUPTED' } }); } finally { await recoveryLease.client.end().catch(() => {}); } }
      stopped = false;
      interval = setInterval(() => { void processNext().catch(() => { /* Safe next poll; never log document contents. */ }); }, 1000);
      interval.unref();
    },
    async stop() { stopped = true; if (interval) clearInterval(interval); while (busy) await new Promise((resolve) => setTimeout(resolve, 50)); },
  };
}
export type KnowledgeService = ReturnType<typeof createKnowledgeService>;
