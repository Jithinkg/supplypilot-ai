import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['apps/web/src/**/*.test.{ts,tsx}'], setupFiles: ['apps/web/src/test/setup.ts'] },
});
