import '../src/config/load-env.js';
import { execFileSync } from 'node:child_process';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = `${root}.cache/backups`;
mkdirSync(dir, { recursive: true, mode: 0o700 });
const path = `${dir}/before-day5-${Date.now()}.dump`;
const fd = openSync(path, 'wx', 0o600);
try { execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom'], { cwd: root, stdio: ['ignore', fd, 'inherit'] }); }
finally { closeSync(fd); }
console.log(`Database backup created at ${path}. Keep this private; it includes database contents.`);
