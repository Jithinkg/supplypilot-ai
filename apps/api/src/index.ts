import { readEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { createAuthService } from './services/auth.js';
import { createApp } from './app.js';
import { createReadService } from './services/reads.js';
import { createProposalService } from './services/proposals.js';

import { createKnowledgeService } from './knowledge/service.js';
import { createAssistantService } from './agents/service.js';

const env = readEnv();
const db = createDatabase(env.DATABASE_URL);
const reads = createReadService(db);
const proposals = createProposalService(db);
const knowledge = createKnowledgeService(db, { enabled: env.RAG_ENABLED, threshold: env.RAG_MIN_SIMILARITY });
const assistant = createAssistantService(db, { reads, proposals, knowledge, enabled: env.ASSISTANT_ENABLED, ...(env.OPENROUTER_API_KEY ? { key: env.OPENROUTER_API_KEY } : {}) });
const startup = await Promise.allSettled([knowledge.start(), assistant.reconcile()]);
if (startup.some((result) => result.status === 'rejected')) console.warn('Knowledge worker or assistant recovery unavailable. Check database connectivity/migrations and restart. Manual APIs and health checks remain available.');
const app = createApp({ auth: createAuthService(db), reads, proposals, knowledge, assistant, checkDatabase: async () => { await db.$queryRaw`SELECT 1`; }, webOrigin: env.WEB_ORIGIN, production: env.NODE_ENV === 'production' });
const server = app.listen(env.API_PORT, '127.0.0.1', (error?: Error) => {
  if (error) {
    console.error('API startup failed. Check whether the configured port is already in use.');
    void knowledge.stop().then(() => db.$disconnect()).finally(() => { process.exitCode = 1; });
    return;
  }
  console.log(`SupplyPilot API: http://127.0.0.1:${env.API_PORT}`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { server.close(() => { void knowledge.stop().then(() => db.$disconnect()).finally(() => process.exit(0)); }); });
}
