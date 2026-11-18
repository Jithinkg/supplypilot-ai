import '../config/load-env.js';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/invalid');
if (process.env.TEST_DATABASE_ISOLATED !== '1' || !/^\/supplypilot_test_[a-f0-9]{32}$/.test(url.pathname)) {
  throw new Error('Refusing to mutate a non-isolated database. Run npm run test:db from the repository root.');
}
