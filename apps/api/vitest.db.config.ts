import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/**/*.db.test.ts'], exclude: ['src/**/*.rag.db.test.ts'], setupFiles: ['src/tests/require-isolated-db.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 30_000, fileParallelism: false } });
