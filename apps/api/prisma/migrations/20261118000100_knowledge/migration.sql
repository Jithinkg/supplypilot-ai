-- Additive only. The existing PostgreSQL 17 image must supply pgvector first.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TYPE "DocumentType" AS ENUM ('PROCUREMENT_POLICY', 'SUPPLIER_CONTRACT');
CREATE TYPE "IngestionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');
ALTER TABLE "AgentRun" ADD COLUMN "intent" TEXT, ADD COLUMN "capturedRole" "Role", ADD COLUMN "deadline" TIMESTAMPTZ(3);
CREATE TABLE "KnowledgeDocument" (
 "id" UUID PRIMARY KEY, "type" "DocumentType" NOT NULL, "supplierId" UUID REFERENCES "Supplier"("id") ON DELETE RESTRICT,
 "uploaderId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "title" TEXT NOT NULL, "originalFilename" TEXT NOT NULL,
 "checksum" TEXT NOT NULL, "dedupKey" TEXT NOT NULL UNIQUE, "pdf" BYTEA NOT NULL,
 "pageCount" INTEGER CHECK ("pageCount" BETWEEN 1 AND 50), "status" "IngestionStatus" NOT NULL DEFAULT 'QUEUED', "errorCode" TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 CONSTRAINT "document_supplier_scope" CHECK (("type" = 'PROCUREMENT_POLICY' AND "supplierId" IS NULL) OR ("type" = 'SUPPLIER_CONTRACT' AND "supplierId" IS NOT NULL)),
 CONSTRAINT "document_size" CHECK (octet_length("pdf") BETWEEN 5 AND 10485760)
);
CREATE INDEX "KnowledgeDocument_status_createdAt_idx" ON "KnowledgeDocument"("status", "createdAt");
CREATE INDEX "KnowledgeDocument_type_supplierId_idx" ON "KnowledgeDocument"("type", "supplierId");
CREATE TABLE "DocumentChunk" (
 "id" UUID PRIMARY KEY, "documentId" UUID NOT NULL REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE,
 "ordinal" INTEGER NOT NULL CHECK ("ordinal" >= 0), "pageNumber" INTEGER NOT NULL CHECK ("pageNumber" BETWEEN 1 AND 50),
 "text" TEXT NOT NULL CHECK (length("text") > 0), "startOffset" INTEGER NOT NULL CHECK ("startOffset" >= 0), "endOffset" INTEGER NOT NULL,
 UNIQUE ("documentId", "ordinal"), CHECK ("endOffset" > "startOffset")
);
CREATE TABLE "EmbeddingProfile" (
 "id" VARCHAR(64) PRIMARY KEY, "model" TEXT NOT NULL, "revision" TEXT NOT NULL, "dimensions" INTEGER NOT NULL CHECK ("dimensions" > 0),
 "pooling" TEXT NOT NULL, "normalized" BOOLEAN NOT NULL, "chunkTokens" INTEGER NOT NULL CHECK ("chunkTokens" > 0),
 "overlapTokens" INTEGER NOT NULL CHECK ("overlapTokens" >= 0 AND "overlapTokens" < "chunkTokens"), "dtype" TEXT NOT NULL
);
CREATE TABLE "ChunkEmbedding" (
 "chunkId" UUID NOT NULL REFERENCES "DocumentChunk"("id") ON DELETE CASCADE,
 "profileId" VARCHAR(64) NOT NULL REFERENCES "EmbeddingProfile"("id") ON DELETE RESTRICT,
 "dimensions" INTEGER NOT NULL, "embedding" vector NOT NULL, PRIMARY KEY ("chunkId", "profileId"),
 CHECK (vector_dims("embedding") = "dimensions" AND vector_norm("embedding") > 0)
);
CREATE FUNCTION supplypilot_embedding_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME = 'EmbeddingProfile' THEN RAISE EXCEPTION 'Embedding profiles are immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "EmbeddingProfile" WHERE id = NEW."profileId" AND dimensions = NEW.dimensions) THEN
  RAISE EXCEPTION 'Embedding dimensions do not match profile';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER embedding_profile_immutable BEFORE UPDATE ON "EmbeddingProfile" FOR EACH ROW EXECUTE FUNCTION supplypilot_embedding_profile_guard();
CREATE TRIGGER embedding_dimensions_match BEFORE INSERT OR UPDATE ON "ChunkEmbedding" FOR EACH ROW EXECUTE FUNCTION supplypilot_embedding_profile_guard();
