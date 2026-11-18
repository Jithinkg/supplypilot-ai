import { assertFreeModelQuota, FreeModelPreflightError } from '../src/agents/preflight.js';
import '../src/tests/require-isolated-db.js';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../src/db/client.js';
import { readEnv } from '../src/config/env.js';
import { createAuthService } from '../src/services/auth.js';
import { createReadService } from '../src/services/reads.js';
import { createProposalService } from '../src/services/proposals.js';
import { createKnowledgeService } from '../src/knowledge/service.js';
import { syntheticPdf } from '../src/knowledge/fixtures.js';
import { createModelInvoker } from '../src/agents/model.js';
import { createAssistantService } from '../src/agents/service.js';
const env = readEnv(); const db = createDatabase(env.DATABASE_URL);
try {
  if (!env.OPENROUTER_API_KEY) { console.log('SKIPPED: OpenRouter key unavailable. Live agents not verified.'); }
  else {
    await assertFreeModelQuota(env.OPENROUTER_API_KEY, 20);
    const auth = createAuthService(db);
    const email = process.env.SEED_STAFF_EMAIL; const password = process.env.SEED_STAFF_PASSWORD;
    if (!email || !password) throw new Error('Test credentials unavailable.');
    const logged = await auth.login(email, password, randomUUID()); const session = await auth.resolve(logged.token);
    if (!session) throw new Error('Test authentication failed.');
    const actor = { userId: session.user.id, sessionId: session.sessionId, requestId: randomUUID() };
    const knowledge = createKnowledgeService(db);
    const managerLogin = await auth.login(process.env.SEED_MANAGER_EMAIL ?? '', process.env.SEED_MANAGER_PASSWORD ?? '', randomUUID());
    const managerSession = await auth.resolve(managerLogin.token);
    if (!managerSession) throw new Error('Test authentication failed.');
    const manager = { userId: managerSession.user.id, sessionId: managerSession.sessionId, requestId: randomUUID() };
    await knowledge.upload({ title: 'Synthetic smoke policy', type: 'PROCUREMENT_POLICY' }, { bytes: await syntheticPdf(['Procurement policy for purchase proposals: create draft proposals for manager review. Compare supplier delivery lead times and prices and document the purpose of the request. Recommendations are advisory. The application checks budget availability. AI cannot approve proposals or place orders.']), filename: 'synthetic.pdf', mime: 'application/pdf' }, manager);
    await knowledge.processNext();
    const invoke = createModelInvoker(env.OPENROUTER_API_KEY);
    let evidencePresented = false;
    const service = createAssistantService(db, { reads: createReadService(db), proposals: createProposalService(db), knowledge, invoke: async (request) => { console.log(`Live tool stage: ${request.forced ?? 'specialist'}`); if (request.forced === 'formatPolicyFindings') evidencePresented = JSON.stringify(request.messages).includes('Compare supplier delivery lead times and prices'); const reply = await invoke(request); if (request.forced === 'getInventoryRisks') console.log('Inventory call diagnostic:', { calls: reply.calls.length, usage: reply.usage, diagnostic: reply.diagnostic }); if (request.forced === 'formatPolicyFindings') console.log('Review schema diagnostic:', reply.calls.map((call) => ({ expectedName: call.name === 'formatPolicyFindings', knownFinding: ['SUPPORTING_CLAUSE', 'POTENTIAL_CONFLICT', 'INSUFFICIENT_EVIDENCE'].some((value) => value === ((typeof call.args === 'object' && call.args !== null && 'finding' in call.args) ? call.args.finding : null)), indexCount: (typeof call.args === 'object' && call.args !== null && 'citationIndexes' in call.args && Array.isArray(call.args.citationIndexes)) ? call.args.citationIndexes.length : -1 }))); return reply; } });
    const countBefore = await db.purchaseProposal.count();
    const reservedBefore = (await createReadService(db).budget()).reservedPaise;
    for (const scenario of [
      { message: 'which products are at risk', intent: 'INVENTORY_QUERY', tool: 'getInventoryRisks', actor },
      { message: 'any products at risk', intent: 'INVENTORY_QUERY', tool: 'getInventoryRisks', actor: manager },
      { message: 'Are any products running low?', intent: 'INVENTORY_QUERY', tool: 'getInventoryRisks', actor },
      { message: 'What is the available procurement budget?', intent: 'PROCUREMENT_QUERY', tool: 'getAvailableBudget', actor },
    ]) {
      const answer = await service.run({ message: scenario.message, mode: 'READ_ONLY' }, randomUUID(), scenario.actor);
      console.log('Live read diagnostic:', { status: answer.status, intent: answer.intent, errorCode: answer.errorCode, tools: answer.data.map((entry) => entry.tool), proposalCount: answer.createdProposalIds.length });
      if (answer.status !== 'COMPLETED' || answer.intent !== scenario.intent || !answer.data.some((entry) => entry.tool === scenario.tool) || answer.createdProposalIds.length) throw new Error('LIVE_READ_ROUTING_FAILED');
      console.log(`PASS: live ${scenario.intent} → ${scenario.tool}; real backend findings, no draft creation.`);
    }
    if (await db.purchaseProposal.count() !== countBefore || (await createReadService(db).budget()).reservedPaise !== reservedBefore) throw new Error('READ_ONLY_BUSINESS_STATE_CHANGED');
    const product = await db.product.findUniqueOrThrow({ where: { sku: 'SP-003' } });
    const result = await service.run({ message: `Create a draft purchase proposal for the selected product ${product.sku}. Use the supplied quantity. Check inventory, supplier quotes, budget and procurement policies first. Review what the policy says about comparing supplier prices and delivery times.`, mode: 'CREATE_DRAFT', items: [{ productId: product.id, quantity: 2 }] }, randomUUID(), actor);
    const diagnostic = await db.agentRun.findUniqueOrThrow({ where: { id: result.runId }, select: { error: true, intent: true } });
    console.log('Live graph diagnostic:', { warnings: result.warnings, knowledgeOutcomes: result.knowledge.map((item) => item.outcome), evidencePresented, status: result.status, toolCalls: result.toolCalls, proposalCount: result.createdProposalIds.length, ...diagnostic });
    if (result.status !== 'COMPLETED' || result.createdProposalIds.length !== 1 || !evidencePresented || !result.knowledge.some((item) => item.outcome !== 'UNAVAILABLE')) throw new Error('LIVE_RUN_FAILED');
    const proposal = await db.purchaseProposal.findUniqueOrThrow({ where: { id: result.createdProposalIds[0]! } });
    if (proposal.status !== 'DRAFT' || proposal.source !== 'AI') throw new Error('LIVE_RUN_FAILED');
    console.log(`PASS: exact-free-model LangGraph classification → Inventory → Procurement planning → Policy Knowledge → grounded advisory review → DRAFT; ${result.toolCalls} validated tool calls. Isolated database only; no order/approval.`);
  }
} catch (error) { if (error instanceof FreeModelPreflightError) console.error(error.message); else console.error('Live agent smoke FAILED. Inspect owned run diagnostics in the disposable test environment; no paid fallback attempted.'); process.exitCode = 1; }
finally { await db.$disconnect(); }
