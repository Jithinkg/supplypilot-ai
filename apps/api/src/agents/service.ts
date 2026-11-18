import { z } from 'zod';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assistantInputSchema, assistantResultSchema, idempotencyKeySchema, intentSchema, type AssistantResult } from '@supplypilot/contracts';
import { authorize, type Actor } from '../knowledge/access.js';
import type { KnowledgeService } from '../knowledge/service.js';
import type { ReadService } from '../services/reads.js';
import type { ProposalService } from '../services/proposals.js';
import { HttpError } from '../middleware/errors.js';
import { createModelInvoker, type ModelInvoker } from './model.js';
import { runOrchestrator } from './orchestrator.js';
export function createAssistantService(db: PrismaClient, deps: { reads: ReadService; proposals: ProposalService; knowledge: KnowledgeService; key?: string; invoke?: ModelInvoker; enabled?: boolean }) {
  const invoke = deps.invoke ?? createModelInvoker(deps.key);
  const enabled = deps.enabled ?? true;
  const serial = (value: AssistantResult): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  async function recover(id: string, actor: Actor): Promise<AssistantResult> {
    const user = await authorize(db, actor);
    const run = await db.agentRun.findFirst({ where: { id, userId: actor.userId } });
    if (!run) throw new HttpError(404, 'RUN_NOT_FOUND', 'Run not found.');
    if (run.status === 'RUNNING' && (!run.deadline || run.deadline.getTime() <= Date.now())) await db.agentRun.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'FAILED', completedAt: new Date(), error: { code: 'INTERRUPTED' } } });
    const current = await db.agentRun.findUniqueOrThrow({ where: { id } });
    const committed = await db.purchaseProposal.findMany({ where: { agentRunId: id, creatorId: actor.userId }, select: { id: true } });
    const diagnostic = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(64), toolCalls: z.number().int().min(0).max(12).optional() }).safeParse(current.error);
    const base: AssistantResult = { runId: id, status: current.status, intent: intentSchema.safeParse(current.intent).success ? intentSchema.parse(current.intent) : null, answer: current.status === 'RUNNING' ? 'This run is still processing. Recover this run; do not start another request.' : committed.length ? 'Committed draft links are available. Open each proposal for its current status.' : current.mode === 'READ_ONLY' ? 'The assistant request did not complete. Inventory and budget remain available in the dashboard.' : 'The request did not complete. No draft proposals are recorded for this run.', createdProposalIds: committed.map((row) => row.id), warnings: [], knowledge: [], data: [], toolCalls: diagnostic.success ? diagnostic.data.toolCalls ?? 0 : 0, errorCode: current.status === 'FAILED' ? diagnostic.success ? diagnostic.data.code : 'RUN_FAILED' : null };
    if (current.capturedRole !== user.role) return { ...base, answer: 'Your permissions have changed. Previous findings are unavailable.', errorCode: 'PERMISSIONS_CHANGED' };
    const parsed = assistantResultSchema.safeParse(current.result);
    if (!parsed.success) return base;
    for (const review of parsed.data.knowledge) for (const citation of review.citations) {
      const source = await db.knowledgeDocument.findUnique({ where: { id: citation.documentId }, select: { supplierId: true } });
      try { await deps.knowledge.citation(citation, actor, source?.supplierId ?? undefined); }
      catch { return { ...base, answer: 'Previously cited evidence is no longer available or authorized. Run a new read-only review.', warnings: ['Previous findings have been suppressed.'], errorCode: 'EVIDENCE_CHANGED' }; }
    }
    return { ...parsed.data, status: current.status, createdProposalIds: committed.map((row) => row.id) };
  }
  return {
    async run(rawInput: unknown, rawKey: unknown, actor: Actor) {
      const input = assistantInputSchema.parse(rawInput);
      const key = idempotencyKeySchema.parse(rawKey);
      const user = await authorize(db, actor);
      if (!enabled) throw new HttpError(503, 'ASSISTANT_DISABLED', 'Assistant is disabled. Use manual procurement.');
      const canonical = { ...input, ...(input.items ? { items: [...input.items].sort((a, b) => a.productId.localeCompare(b.productId)) } : {}) };
      const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
      const prior = await db.agentRun.findUnique({ where: { userId_requestKey: { userId: user.id, requestKey: key } } });
      if (prior) {
        if (prior.requestHash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with different input.');
        return recover(prior.id, actor);
      }
      const deadline = new Date(Date.now() + 60000);
      let run;
      try { run = await db.agentRun.create({ data: { userId: user.id, requestKey: key, requestHash: hash, prompt: input.message, mode: input.mode, capturedRole: user.role, deadline } }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await db.agentRun.findUniqueOrThrow({ where: { userId_requestKey: { userId: user.id, requestKey: key } } });
          if (existing.requestHash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with different input.');
          return recover(existing.id, actor);
        }
        throw error;
      }
      const usage = { inputTokens: 0, outputTokens: 0 };
      const meteredInvoke: ModelInvoker = async (request) => { const reply = await invoke(request); if (reply.usage) { usage.inputTokens += reply.usage.input; usage.outputTokens += reply.usage.output; } return reply; };
      const started = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const limits = { stage: 'validation', toolCalls: 0, signal: controller.signal, async check() {
        if (controller.signal.aborted || Date.now() >= deadline.getTime()) throw new Error('RUN_TIMEOUT');
        if (limits.toolCalls >= 12) throw new Error('TOOL_LIMIT');
        const currentUser = await authorize(db, actor);
        if (currentUser.role !== user.role) throw new Error('PERMISSIONS_CHANGED');
      } };
      let abortRun: (() => void) | undefined;
      const interrupted = new Promise<never>((_resolve, reject) => { abortRun = () => reject(new Error('RUN_TIMEOUT')); controller.signal.addEventListener('abort', abortRun, { once: true }); });
      try {
        const output = await Promise.race([runOrchestrator({ runId: run.id, deadline: deadline.toISOString(), input, actor, role: user.role, limits, reads: deps.reads, proposals: Object.freeze({ createForAgent: deps.proposals.createForAgent }), knowledge: Object.freeze({ search: deps.knowledge.search, citation: deps.knowledge.citation }), invoke: meteredInvoke, setIntent: async (intent) => { await db.agentRun.update({ where: { id: run.id }, data: { intent } }); } }), interrupted]);
        await db.$transaction([db.agentRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date(), result: serial(output) } }), db.auditEvent.create({ data: { actorUserId: actor.userId, actorKind: 'AI', action: 'AGENT_RUN_COMPLETED', entityType: 'AgentRun', entityId: run.id, requestId: actor.requestId, runId: run.id, metadata: { intent: output.intent, toolCalls: limits.toolCalls, durationMs: Date.now() - started, ...usage } } })]);
      } catch (error) {
        const code = controller.signal.aborted ? 'RUN_TIMEOUT' : error instanceof Error && (/^MODEL_HTTP_[45][0-9]{2}$/.test(error.message) || ['TOOL_DENIED', 'PRODUCT_SCOPE_DENIED', 'SUPPLIER_SCOPE_DENIED', 'MODEL_QUANTITY_DENIED', 'DRAFT_CAPABILITY_REQUIRED', 'TOOL_LIMIT', 'RUN_TIMEOUT', 'PERMISSIONS_CHANGED', 'INVALID_CLASSIFICATION', 'MISSING_TOOL_CALL', 'MODEL_UNAVAILABLE'].includes(error.message)) ? error.message : error instanceof z.ZodError ? 'INVALID_TOOL_ARGUMENTS' : 'ASSISTANT_UNAVAILABLE';
        await db.agentRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedAt: new Date(), error: { code, stage: limits.stage, durationMs: Date.now() - started, toolCalls: Math.min(limits.toolCalls, 12) } } });
        await db.auditEvent.create({ data: { actorUserId: actor.userId, actorKind: 'AI', action: code.includes('DENIED') || code.includes('CAPABILITY') ? 'AGENT_ACTION_DENIED' : 'AGENT_RUN_FAILED', entityType: 'AgentRun', entityId: run.id, requestId: actor.requestId, runId: run.id, metadata: { code, stage: limits.stage, toolCalls: Math.min(limits.toolCalls, 12), durationMs: Date.now() - started, ...usage } } });
      } finally { clearTimeout(timeout); if (abortRun) controller.signal.removeEventListener('abort', abortRun); }
      return recover(run.id, actor);
    },
    get: recover,
    async reconcile() {
      await db.agentRun.updateMany({ where: { status: 'RUNNING', OR: [{ deadline: { lte: new Date() } }, { deadline: null }] }, data: { status: 'FAILED', completedAt: new Date(), error: { code: 'INTERRUPTED' } } });
    },
  };
}
export type AssistantService = ReturnType<typeof createAssistantService>;
