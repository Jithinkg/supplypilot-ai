import '../src/config/load-env.js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const config = z.object({ POSTGRES_USER: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), POSTGRES_DB: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }).parse(process.env);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const name = `supplypilot-pgvector-check-${suffix}`;
const volume = `${name}-data`;
const image = 'supplypilot-pgvector-preflight:0.8.7';
const dir = join(root, '.cache', 'pgvector');
mkdirSync(dir, { recursive: true });
function docker(args: string[], input?: string | Buffer, timeout = 600_000) {
  return execFileSync('docker', args, { cwd: root, ...(input === undefined ? {} : { input }), encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
}
function sourceSql(sql: string) {
  return docker(['compose', 'exec', '-T', 'postgres', 'psql', '-U', config.POSTGRES_USER, '-d', config.POSTGRES_DB, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).trim();
}
function cloneSql(sql: string) {
  return docker(['exec', name, 'psql', '-U', config.POSTGRES_USER, '-d', config.POSTGRES_DB, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).trim();
}
const tables = ['User', 'Product', 'DailySale', 'Supplier', 'SupplierQuote', 'Budget', 'PurchaseProposal', 'ProposalLine', 'BudgetReservation', 'IdempotencyRecord'];
const fingerprintSql = tables.map((table) => `SELECT '${table}', count(*), md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, '[]')) FROM "${table}" t;`).join('\n');
let volumeCreated = false;
let containerCreated = false;
try {
  const sourceId = docker(['compose', 'ps', '-q', 'postgres']).trim();
  if (!/^[a-f0-9]{12,64}$/.test(sourceId)) throw new Error('Application PostgreSQL is not running.');
  const sourceImage = docker(['inspect', '--format', '{{.Image}}', sourceId]).trim();
  const digests = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RepoDigests}}', sourceImage])) as string[] | null;
  const declared = readFileSync(join(root, 'infra/postgres/Dockerfile.pgvector'), 'utf8').match(/^ARG POSTGRES_BASE=(postgres@sha256:[a-f0-9]{64})$/m)?.[1];
  const base = digests?.find((digest) => /^postgres@sha256:[a-f0-9]{64}$/.test(digest)) ?? declared;
  if (!base) throw new Error('Cannot pin the exact current PostgreSQL base.');
  const layers = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RootFS.Layers}}', sourceImage])) as string[];
  const baseLayers = JSON.parse(docker(['image', 'inspect', '--format', '{{json .RootFS.Layers}}', base])) as string[];
  if (baseLayers.some((layer, index) => layers[index] !== layer)) throw new Error('Running image does not derive from the pinned PostgreSQL base.');
  const before = sourceSql(fingerprintSql);
  const version = Number(sourceSql('SHOW server_version_num'));
  if (version < 170000 || version >= 180000) throw new Error('The approved compatibility check requires PostgreSQL 17.');
  console.log('Building pgvector against the current PostgreSQL base:', base);
  execFileSync('docker', ['build', '-f', 'infra/postgres/Dockerfile.pgvector', '--build-arg', `POSTGRES_BASE=${base}`, '-t', image, 'infra/postgres'], { cwd: root, stdio: 'inherit', timeout: 900_000 });
  // pg_basebackup produces a consistent physical copy; never copy live PGDATA files directly.
  const tarPath = join(dir, `volume-copy-${suffix}.tar`);
  const output = openSync(tarPath, 'wx', 0o600);
  try {
    execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" pg_basebackup -h 127.0.0.1 -U "$POSTGRES_USER" --format=tar -D - -X fetch --checkpoint=fast'], { cwd: root, stdio: ['ignore', output, 'inherit'], timeout: 120_000 });
  } finally { closeSync(output); }
  docker(['volume', 'create', volume]); volumeCreated = true;
  const input = openSync(tarPath, 'r');
  try {
    execFileSync('docker', ['run', '--rm', '-i', '--mount', `type=volume,source=${volume},target=/clone`, '--entrypoint', 'sh', image, '-c', 'tar xf - -C /clone && chown -R postgres:postgres /clone && chmod 700 /clone'], { cwd: root, stdio: [input, 'inherit', 'inherit'], timeout: 120_000 });
  } finally { closeSync(input); }
  docker(['run', '-d', '--name', name, '--mount', `type=volume,source=${volume},target=/var/lib/postgresql/data`, image]); containerCreated = true;
  async function ready() {
    for (let i = 0; i < 40; i++) {
      try { if (cloneSql('SELECT 1') === '1') return; } catch { /* Startup recovery is expected. */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Copied volume did not become ready.');
  }
  await ready();
  if (cloneSql(fingerprintSql) !== before) throw new Error('Copied business records differ.');
  const probe = cloneSql(`CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TEMP TABLE vector_probe (id integer, embedding vector(384));
    INSERT INTO vector_probe VALUES (1, (ARRAY[1::real] || array_fill(0::real, ARRAY[383]))::vector), (2, (ARRAY[0::real,1::real] || array_fill(0::real, ARRAY[382]))::vector);
    SELECT id || ':' || vector_dims(embedding) FROM vector_probe ORDER BY embedding <=> (ARRAY[1::real] || array_fill(0::real, ARRAY[383]))::vector LIMIT 1;`);
  if (!probe.endsWith('1:384')) throw new Error('Vector insert/cosine search failed.');
  const migrationTested = process.argv.includes('--migration');
  if (migrationTested && cloneSql(`SELECT to_regclass('"KnowledgeDocument"') IS NOT NULL`) !== 't') cloneSql(readFileSync(join(root, 'apps/api/prisma/migrations/20261118000100_knowledge/migration.sql'), 'utf8'));
  docker(['restart', name]); await ready();
  if (cloneSql(fingerprintSql) !== before || sourceSql(fingerprintSql) !== before) throw new Error('Business data changed during compatibility check.');
  const report = { status: 'PASS', migrationTested, base, image, postgres: cloneSql('SHOW server_version'), pgvector: cloneSql("SELECT extversion FROM pg_extension WHERE extname = 'vector'"), dimensions: 384, copiedVolumeRestart: true, businessDataUnchanged: true };
  writeFileSync(join(dir, 'preflight.json'), JSON.stringify(report, null, 2));
  console.log('PASS: pgvector on a consistent physical copy; original and copied business records preserved.', report);
} catch (error) {
  writeFileSync(join(dir, 'preflight.json'), JSON.stringify({ status: 'FAIL', reason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error.' }, null, 2));
  console.error('FAIL: pgvector compatibility gate remains blocked. The application image/volume was not replaced.');
  process.exitCode = 1;
} finally {
  // Only ephemeral resources created by this invocation are removed.
  if (containerCreated) docker(['rm', '-f', name]);
  if (volumeCreated) docker(['volume', 'rm', volume]);
}
