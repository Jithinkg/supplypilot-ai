import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.rag.db.test.ts'], setupFiles: ['src/tests/require-isolated-db.ts'], environment: 'node', testTimeout: 120000, hookTimeout: 120000, fileParallelism: false } });
