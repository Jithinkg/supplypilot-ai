import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { env, pipeline } from '@huggingface/transformers';
export interface Embeddings {
  profile: { id: string; model: string; revision: string; dimensions: number; pooling: string; normalized: boolean; chunkTokens: number; overlapTokens: number; dtype: string };
  countTokens(text: string): number;
  embed(texts: string[]): Promise<number[][]>;
}
export function validateVector(vector: number[], dimensions: number) {
  z.array(z.number().finite()).length(dimensions).parse(vector);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (Math.abs(norm - 1) > 0.001) throw new Error('Embedding must be normalized and nonzero.');
  return vector;
}
let instance: Promise<Embeddings> | undefined;
export function localEmbeddings(): Promise<Embeddings> {
  return instance ??= load().catch((error: unknown) => { instance = undefined; throw error; });
}
async function load(): Promise<Embeddings> {
  const config = z.object({ EMBEDDING_MODEL: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).default('Xenova/all-MiniLM-L6-v2'), EMBEDDING_REVISION: z.string().regex(/^[a-f0-9]{40}$/).optional(), EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(4096).default(384), EMBEDDING_CACHE_DIR: z.string().optional() }).parse(process.env);
  const cache = resolve(config.EMBEDDING_CACHE_DIR ?? fileURLToPath(new URL(import.meta.url.includes('/dist/') ? '../../../../../.cache/embeddings' : '../../../../.cache/embeddings', import.meta.url)));
  const saved = z.object({ model: z.string(), revision: z.string().regex(/^[a-f0-9]{40}$/), dimensions: z.number().int() }).parse(JSON.parse(await readFile(join(cache, 'preflight-profile.json'), 'utf8')));
  if (saved.model !== config.EMBEDDING_MODEL || (config.EMBEDDING_REVISION && saved.revision !== config.EMBEDDING_REVISION) || saved.dimensions !== config.EMBEDDING_DIMENSIONS) throw new Error('Run the embedding compatibility check for this profile first.');
  env.cacheDir = cache;
  const extractor = await pipeline('feature-extraction', join(cache, saved.model, saved.revision), { revision: saved.revision, device: 'cpu', dtype: 'q8', local_files_only: true });
  const profileData = { model: saved.model, revision: saved.revision, dimensions: saved.dimensions, pooling: 'mean', normalized: true, chunkTokens: 180, overlapTokens: 30, dtype: 'q8' };
  const profile = { id: createHash('sha256').update(JSON.stringify(profileData)).digest('hex'), ...profileData };
  return {
    profile,
    countTokens: (text) => extractor.tokenizer.encode(text, { add_special_tokens: false }).length,
    async embed(texts) {
      if (texts.some((text) => extractor.tokenizer.encode(text, { add_special_tokens: false }).length > 180)) throw new Error('Embedding input exceeds the chunk token limit; no truncation allowed.');
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      return z.array(z.array(z.number())).length(texts.length).parse(output.tolist()).map((vector) => validateVector(vector, profile.dimensions));
    },
  };
}
