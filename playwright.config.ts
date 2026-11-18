import { defineConfig, devices } from '@playwright/test';
// Browser tests may mutate only the disposable database owned by the harness.
const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
if (process.env.TEST_DATABASE_ISOLATED !== '1' || !/^\/supplypilot_test_[a-f0-9]{32}$/.test(database.pathname)) {
  throw new Error('Run browser tests with npm run test:e2e, which provisions an isolated database.');
}
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0, timeout: 60000,
  outputDir: '.cache/playwright-results', reporter: 'list',
  use: { baseURL: 'http://localhost:5183', ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  webServer: [
    { command: 'npm exec -w @supplypilot/api -- tsx src/index.ts', url: 'http://127.0.0.1:3104/api/health', reuseExistingServer: false, timeout: 60000 },
    { command: 'npm run dev -w @supplypilot/web -- --host 127.0.0.1', url: 'http://localhost:5183', reuseExistingServer: false, timeout: 60000 },
  ],
});
