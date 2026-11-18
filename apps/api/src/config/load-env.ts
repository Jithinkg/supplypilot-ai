import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Source and compiled execution both locate the repository root explicitly.
const depth = import.meta.url.includes('/dist/') ? '../../../../../.env' : '../../../../.env';
config({ path: fileURLToPath(new URL(depth, import.meta.url)), quiet: true });
