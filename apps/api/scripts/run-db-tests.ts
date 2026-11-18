import '../src/config/load-env.js';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readEnv } from '../src/config/env.js';
import { assertFreeModelQuota, FreeModelPreflightError } from '../src/agents/preflight.js';

const env = readEnv();
const browser = process.argv.includes('--e2e');
const rag = process.argv.includes('--rag');
const agents = process.argv.includes('--agents');
if (env.NODE_ENV === 'production') throw new Error('Database tests are disabled in production.');
if (agents) {
  try {
    if (!env.OPENROUTER_API_KEY) throw new FreeModelPreflightError('MODEL_UNAVAILABLE: Live check requires a configured key.');
    await assertFreeModelQuota(env.OPENROUTER_API_KEY, 20);
  } catch (error) {
    console.error(error instanceof FreeModelPreflightError ? error.message : 'Live quota preflight unavailable. No inference attempted.');
    process.exit(1); // No disposable database has been created yet.
  }
}
const name = `supplypilot_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(env.DATABASE_URL);
url.searchParams.delete('schema');
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
let created = false;
try {
  // Identifier is internally generated from a UUID, never request input.
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = `/${name}`;
  const testEnv = { ...process.env, DATABASE_URL: url.toString(), NODE_ENV: 'test', TEST_DATABASE_ISOLATED: '1', SEED_REFERENCE_DATE: process.env.SEED_REFERENCE_DATE ?? new Date().toISOString().slice(0, 10),
    ...(browser ? { API_PORT: '3104', WEB_PORT: '5183', WEB_ORIGIN: 'http://localhost:5183', API_PROXY_TARGET: 'http://127.0.0.1:3104', SEED_STAFF_EMAIL: 'staff@browser.example', SEED_MANAGER_EMAIL: 'manager@browser.example', SEED_STAFF_PASSWORD: `Staff-${randomUUID()}!`, SEED_MANAGER_PASSWORD: `Manager-${randomUUID()}!` } : {}),
  };
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const commands = [
    { args: ['run', 'db:migrate'], cwd }, { args: ['run', 'db:seed'], cwd },
    browser ? { args: ['exec', '--', 'playwright', 'test'], cwd: fileURLToPath(new URL('../../../', import.meta.url)) } : { args: agents ? ['exec', '--', 'tsx', 'scripts/smoke-agents.ts'] : ['exec', '--', 'vitest', 'run', '--config', rag ? 'vitest.rag.config.ts' : 'vitest.db.config.ts'], cwd },
  ];
  for (const command of commands) {
    const result = spawnSync('npm', command.args, { cwd: command.cwd, env: testEnv, stdio: 'inherit' });
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
} finally {
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  console.log('Isolated test database removed. The application database was not migrated or seeded.');
}
