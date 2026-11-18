import '../src/config/load-env.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { env, pipeline } from '@huggingface/transformers';

const config = z.object({
  EMBEDDING_MODEL: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).default('Xenova/all-MiniLM-L6-v2'),
  EMBEDDING_REVISION: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(384),
  EMBEDDING_CACHE_DIR: z.string().optional(),
}).parse(process.env);
const cache = resolve(config.EMBEDDING_CACHE_DIR ?? fileURLToPath(new URL('../../../.cache/embeddings', import.meta.url)));
const offline = process.argv.includes('--offline');
const deadline = setTimeout(() => { console.error('FAIL: local embedding check exceeded ten minutes.'); process.exit(1); }, 600_000);
try {
  await mkdir(cache, { recursive: true });
  const profilePath = join(cache, 'preflight-profile.json');
  let revision = config.EMBEDDING_REVISION;
  if (offline) {
    const saved = z.object({ model: z.string(), revision: z.string().regex(/^[a-f0-9]{40}$/) }).parse(JSON.parse(await readFile(profilePath, 'utf8')));
    if (saved.model !== config.EMBEDDING_MODEL) throw new Error('Cached profile does not match configured model.');
    revision ??= saved.revision;
    env.allowRemoteModels = false;
  }
  if (!revision) {
    const response = await fetch(`https://huggingface.co/api/models/${config.EMBEDDING_MODEL}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Public model metadata unavailable.');
    revision = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }).parse(await response.json()).sha;
  }
  env.cacheDir = cache;
  // Resolve the pinned cache directory explicitly offline. This avoids remote
  // repository discovery in the pipeline factory when remote models are disabled.
  const location = offline ? join(cache, config.EMBEDDING_MODEL, revision) : config.EMBEDDING_MODEL;
  const extractor = await pipeline('feature-extraction', location, { revision, device: 'cpu', dtype: 'q8', local_files_only: offline });
  const result = await extractor(['Procurement requires a manager to review a draft.', 'Penguins live in Antarctica.'], { pooling: 'mean', normalize: true });
  const vectors = z.array(z.array(z.number().finite()).length(config.EMBEDDING_DIMENSIONS)).length(2).parse(result.tolist());
  const norms = vectors.map((vector) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)));
  if (norms.some((norm) => Math.abs(norm - 1) > 0.001)) throw new Error('Vectors are not normalized.');
  const fingerprint = createHash('sha256').update(JSON.stringify(vectors)).digest('hex');
  const profile = { model: config.EMBEDDING_MODEL, revision, dimensions: config.EMBEDDING_DIMENSIONS, pooling: 'mean', normalize: true, dtype: 'q8', device: 'cpu', node: process.version, fingerprint };
  if (offline) {
    const previous = JSON.parse(await readFile(profilePath, 'utf8')) as { fingerprint?: string };
    if (previous.fingerprint !== fingerprint) throw new Error('Cached inference did not reproduce the original vectors.');
  } else await writeFile(profilePath, JSON.stringify(profile, null, 2));
  console.log(`PASS: ${offline ? 'offline cached' : 'local CPU'} embedding check`, profile);
} catch (error) {
  console.error('FAIL: embedding compatibility gate remains blocked.', error instanceof Error ? error.message : 'Unknown error.');
  process.exitCode = 1;
} finally { clearTimeout(deadline); }
