import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  auditQuerySchema, createProposalSchema, draftBatchSchema, idempotencyKeySchema, inventoryQuerySchema,
  paiseSchema, proposalIdSchema, proposalQuerySchema, rejectProposalSchema,
  type AuditQuery, type CreateProposalInput, type ProposalQuery,
} from '@supplypilot/contracts';
import { HttpError } from '../middleware/errors.js';
import { inventoryRisk, salesWindow } from './inventory.js';
import { affordability, availableBudgetPaise, lineTotalPaise, sumPaise } from './money.js';
import { createReadService } from './reads.js';
import { compareSupplierQuotes } from './suppliers.js';
import { transaction } from './transactions.js';

export interface MutationContext {
  userId: string; sessionId: string; requestId: string; actorKind: 'HUMAN' | 'AI';
}
const contextSchema = z.object({ userId: z.uuid(), sessionId: z.uuid(), requestId: z.string().min(1).max(128), actorKind: z.enum(['HUMAN', 'AI']) }).strict();
const summaryInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  creator: { select: { id: true, email: true, role: true } },
  decisionMaker: { select: { id: true, email: true, role: true } },
} satisfies Prisma.PurchaseProposalInclude;
type Summary = Prisma.PurchaseProposalGetPayload<{ include: typeof summaryInclude }>;

export function proposalSummary(proposal: Summary) {
  return { id: proposal.id, supplier: proposal.supplier, creator: proposal.creator, decisionMaker: proposal.decisionMaker,
    status: proposal.status, source: proposal.source, reason: proposal.reason, rejectionReason: proposal.rejectionReason,
    totalPaise: proposal.totalPaise, createdAt: proposal.createdAt.toISOString(), decidedAt: proposal.decidedAt?.toISOString() ?? null, affordability: null as ReturnType<typeof affordability> | null };
}

const auditMetadata = z.object({ totalPaise: paiseSchema.optional(), amountPaise: paiseSchema.optional(), status: z.enum(['DRAFT', 'APPROVED', 'REJECTED']).optional(), fixture: z.boolean().optional() });
function auditResult(event: Prisma.AuditEventGetPayload<Record<string, never>>) {
  const safeMetadata = auditMetadata.safeParse(event.metadata ?? {});
  return { id: event.id, actorUserId: event.actorUserId, actorKind: event.actorKind, action: event.action,
    entityType: event.entityType, entityId: event.entityId, requestId: event.requestId, createdAt: event.createdAt.toISOString(),
    metadata: safeMetadata.success ? safeMetadata.data : {} };
}

async function authenticateMutation(tx: Prisma.TransactionClient, input: MutationContext, manager: boolean, agentRunId?: string) {
  const context = contextSchema.parse(input);
  if (context.actorKind !== 'HUMAN' && !agentRunId) throw new HttpError(403, 'HUMAN_ACTION_REQUIRED', 'This endpoint requires an authenticated human action.');
  // Hold shared locks through commit so a simultaneous role change, deactivation
  // or session revocation cannot race a purchasing mutation.
  const sessions = await tx.$queryRaw<{ id: string }[]>`
    SELECT s.id FROM "Session" s JOIN "User" u ON u.id = s."userId"
    WHERE s.id = ${context.sessionId}::uuid AND u.id = ${context.userId}::uuid
      AND u.active = true AND s."expiresAt" > NOW()
    FOR SHARE OF u, s`;
  if (!sessions.length) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  const user = await tx.user.findUniqueOrThrow({ where: { id: context.userId } });
  if (agentRunId) {
    const runs = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "AgentRun" WHERE id = ${agentRunId}::uuid AND "userId" = ${context.userId}::uuid AND mode = 'CREATE_DRAFT' AND intent = 'DRAFT_REQUEST' AND status = 'RUNNING' AND deadline > NOW() AND "capturedRole" = ${user.role}::"Role" FOR SHARE`;
    if (!runs.length || manager || context.actorKind !== 'AI') throw new HttpError(403, 'DRAFT_CAPABILITY_REQUIRED', 'An active authorized draft run is required.');
  }
  if (manager && user.role !== 'MANAGER') throw new HttpError(403, 'FORBIDDEN', 'Manager access required.');
  return context;
}

async function lockBudget(tx: Prisma.TransactionClient, budgetId?: string) {
  const rows = budgetId
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Budget" WHERE id = ${budgetId}::uuid FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Budget" WHERE key = 'SHARED' FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new HttpError(503, 'BUDGET_NOT_INITIALIZED', 'Shared budget is unavailable.');
  return tx.budget.findUniqueOrThrow({ where: { id: row.id } });
}
function budgetSnapshot(budget: { id: string; currency: string; allocatedPaise: number; reservedPaise: number }, asOf: Date) {
  if (budget.currency !== 'INR') throw new HttpError(409, 'CURRENCY_MISMATCH', 'Budget currency must be INR.');
  return { budgetId: budget.id, currency: 'INR' as const, allocatedPaise: budget.allocatedPaise, reservedPaise: budget.reservedPaise,
    availablePaise: availableBudgetPaise(budget.allocatedPaise, budget.reservedPaise), asOf: asOf.toISOString() };
}

export function canonicalDraft(input: CreateProposalInput) {
  const parsed = createProposalSchema.parse(input);
  return { reason: parsed.reason, items: [...parsed.items].sort((a, b) => a.productId.localeCompare(b.productId)) };
}

export function createProposalService(db: PrismaClient, clock = () => new Date()) {
  async function decide(id: string, status: 'APPROVED' | 'REJECTED', reason: string | undefined, input: MutationContext) {
    proposalIdSchema.parse(id);
    const rejection = status === 'REJECTED' ? rejectProposalSchema.parse({ reason }).reason : null;
    await transaction(db, async (tx) => {
      const context = await authenticateMutation(tx, input, true);
      const lookup = await tx.purchaseProposal.findUnique({ where: { id }, select: { budgetId: true } });
      if (!lookup) throw new HttpError(404, 'PROPOSAL_NOT_FOUND', 'Proposal not found.');
      const budget = await lockBudget(tx, lookup.budgetId);
      await tx.$queryRaw`SELECT id FROM "PurchaseProposal" WHERE id = ${id}::uuid FOR UPDATE`;
      const proposal = await tx.purchaseProposal.findUniqueOrThrow({ where: { id }, include: { lines: { include: { quote: true } }, reservation: true } });
      if (proposal.status !== 'DRAFT') {
        if (proposal.status === status && (status !== 'REJECTED' || proposal.rejectionReason === rejection)) return;
        throw new HttpError(409, 'PROPOSAL_ALREADY_DECIDED', 'Proposal already has a conflicting decision.');
      }
      if (!proposal.lines.length || proposal.reservation) throw new HttpError(409, 'PROPOSAL_INTEGRITY_ERROR', 'Proposal state is inconsistent.');
      const totals = proposal.lines.map((line) => {
        const total = lineTotalPaise(line.unitPricePaise, line.quantity);
        if (line.lineTotalPaise !== total || line.quote.productId !== line.productId || line.quote.supplierId !== proposal.supplierId || line.leadTimeDays < 1) {
          throw new HttpError(409, 'PROPOSAL_INTEGRITY_ERROR', 'Proposal line snapshot is inconsistent.');
        }
        return total;
      });
      const totalPaise = sumPaise(totals);
      if (totalPaise !== proposal.totalPaise) throw new HttpError(409, 'PROPOSAL_INTEGRITY_ERROR', 'Proposal total is inconsistent.');
      const snapshot = budgetSnapshot(budget, clock());
      if (status === 'APPROVED') {
        if (totalPaise > snapshot.availablePaise) throw new HttpError(409, 'INSUFFICIENT_BUDGET', 'Available funds are insufficient for approval.');
        const updated = await tx.budget.updateMany({ where: { id: budget.id, reservedPaise: { lte: budget.allocatedPaise - totalPaise } }, data: { reservedPaise: { increment: totalPaise } } });
        if (updated.count !== 1) throw new HttpError(409, 'INSUFFICIENT_BUDGET', 'Available funds are insufficient for approval.');
        await tx.budgetReservation.create({ data: { proposalId: id, budgetId: budget.id, amountPaise: totalPaise } });
      }
      const decidedAt = clock();
      await tx.purchaseProposal.update({ where: { id }, data: { status, decidedAt, decisionMakerId: context.userId, rejectionReason: rejection } });
      await tx.auditEvent.create({ data: { actorUserId: context.userId, actorKind: 'HUMAN', action: status === 'APPROVED' ? 'PROPOSAL_APPROVED' : 'PROPOSAL_REJECTED', entityType: 'PurchaseProposal', entityId: id, requestId: context.requestId,
        metadata: { totalPaise, status }, createdAt: decidedAt } });
    });
    return detail(id);
  }

  async function detail(id: string) {
    proposalIdSchema.parse(id);
    const asOf = clock();
    return db.$transaction(async (tx) => {
      const proposal = await tx.purchaseProposal.findUnique({ where: { id }, include: { ...summaryInclude, lines: { include: { product: true }, orderBy: { productId: 'asc' } }, budget: true } });
      if (!proposal) throw new HttpError(404, 'PROPOSAL_NOT_FOUND', 'Proposal not found.');
      const window = salesWindow(asOf);
      const ids = proposal.lines.map((line) => line.productId);
      const sales = await tx.dailySale.findMany({ where: { productId: { in: ids }, date: { gte: window.start, lt: window.endExclusive } } });
      const pending = await tx.proposalLine.findMany({ where: { productId: { in: ids }, proposal: { status: { in: ['DRAFT', 'APPROVED'] } } }, select: { productId: true } });
      const audit = await tx.auditEvent.findMany({ where: { entityType: 'PurchaseProposal', entityId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const budget = budgetSnapshot(proposal.budget, asOf);
      return { ...proposalSummary(proposal), budget, affordability: proposal.status === 'DRAFT' ? affordability(proposal.totalPaise, budget.availablePaise) : null,
        lines: proposal.lines.map((line) => {
          const risk = inventoryRisk(line.product, sales.filter((sale) => sale.productId === line.productId), asOf, pending.some((item) => item.productId === line.productId));
          return { id: line.id, product: { id: line.product.id, sku: line.product.sku, name: line.product.name, unit: line.product.unit }, quoteId: line.quoteId,
            quantity: line.quantity, unitPricePaise: line.unitPricePaise, leadTimeDays: line.leadTimeDays, lineTotalPaise: line.lineTotalPaise,
            lateDeliveryRisk: risk.estimatedDaysUntilStockout !== null && line.leadTimeDays >= risk.estimatedDaysUntilStockout, hasPendingReplenishment: risk.hasPendingReplenishment };
        }), audit: audit.map(auditResult) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async function createDraft(input: CreateProposalInput, keyInput: string, actor: MutationContext, agentRunId?: string) {
      const request = canonicalDraft(input);
      const key = idempotencyKeySchema.parse(keyInput);
      const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
      return transaction(db, async (tx) => {
        const context = await authenticateMutation(tx, actor, false, agentRunId);
        // Key-scoped lock makes concurrent retries wait for the committed response.
        const lock = `${context.userId}:CREATE_PROPOSALS:${key}`;
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
        const prior = await tx.idempotencyRecord.findUnique({ where: { userId_operation_key: { userId: context.userId, operation: 'CREATE_PROPOSALS', key } } });
        if (prior) {
          if (prior.requestHash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with different input.');
          return draftBatchSchema.parse(prior.response);
        }
        const budgetRow = await lockBudget(tx);
        const asOf = clock();
        const budget = budgetSnapshot(budgetRow, asOf);
        const window = salesWindow(asOf);
        const ids = request.items.map((item) => item.productId);
        const products = await tx.product.findMany({ where: { id: { in: ids } }, include: {
          sales: { where: { date: { gte: window.start, lt: window.endExclusive } } },
          proposalLines: { where: { proposal: { status: { in: ['DRAFT', 'APPROVED'] } } }, select: { id: true } },
        } });
        if (products.length !== ids.length) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'One or more products were not found.');
        const quotes = await tx.supplierQuote.findMany({ where: { productId: { in: ids }, supplier: { active: true } }, include: { supplier: true } });
        const exclusions: { productId: string; reason: 'EXISTING_PROPOSAL' | 'TARGET_STOCK_MET' }[] = [];
        const warnings: { productId: string; code: 'LATE_DELIVERY' | 'EXISTING_REPLENISHMENT' }[] = [];
        const groups = new Map<string, { quote: (typeof quotes)[number]; quantity: number; totalPaise: number }[]>();
        for (const item of request.items) {
          const product = products.find((row) => row.id === item.productId);
          if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
          const risk = inventoryRisk(product, product.sales, asOf, product.proposalLines.length > 0);
          if (item.quantity === undefined && risk.hasPendingReplenishment) { exclusions.push({ productId: product.id, reason: 'EXISTING_PROPOSAL' }); continue; }
          if (item.quantity === undefined && risk.averageDailySales === 0) throw new HttpError(400, 'QUANTITY_REQUIRED', 'Products without recent demand need an explicit quantity.');
          if (item.quantity === undefined && risk.recommendedQuantity === 0) { exclusions.push({ productId: product.id, reason: 'TARGET_STOCK_MET' }); continue; }
          const comparison = compareSupplierQuotes(risk, quotes, item.quantity);
          const selected = quotes.find((quote) => quote.id === comparison.selectedQuoteId);
          if (!selected || comparison.quantity === null) throw new HttpError(400, 'QUANTITY_REQUIRED', 'A positive purchase quantity is required.');
          const line = { quote: selected, quantity: comparison.quantity, totalPaise: lineTotalPaise(selected.unitPricePaise, comparison.quantity) };
          const group = groups.get(selected.supplierId) ?? [];
          group.push(line);
          groups.set(selected.supplierId, group);
          if (comparison.lateDeliveryRisk) warnings.push({ productId: product.id, code: 'LATE_DELIVERY' });
          if (risk.hasPendingReplenishment) warnings.push({ productId: product.id, code: 'EXISTING_REPLENISHMENT' });
        }
        const batchTotalPaise = sumPaise([...groups.values()].flat().map((line) => line.totalPaise));
        const proposals = [];
        for (const [supplierId, lines] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          const totalPaise = sumPaise(lines.map((line) => line.totalPaise));
          const proposal = await tx.purchaseProposal.create({ data: {
            supplierId, budgetId: budgetRow.id, creatorId: context.userId, source: context.actorKind, status: 'DRAFT', reason: agentRunId ? 'AI-assisted replenishment requested by authenticated user.' : request.reason, totalPaise, createdAt: asOf, ...(agentRunId ? { agentRunId } : {}),
            lines: { create: lines.map(({ quote, quantity, totalPaise: lineTotal }) => ({ productId: quote.productId, quoteId: quote.id, quantity, unitPricePaise: quote.unitPricePaise, leadTimeDays: quote.leadTimeDays, lineTotalPaise: lineTotal })) },
          }, include: summaryInclude });
          await tx.auditEvent.create({ data: { actorUserId: context.userId, actorKind: context.actorKind, action: 'PROPOSAL_CREATED', entityType: 'PurchaseProposal', entityId: proposal.id, requestId: context.requestId, ...(agentRunId ? { runId: agentRunId } : {}), metadata: { totalPaise, status: 'DRAFT' }, createdAt: asOf } });
          proposals.push({ ...proposalSummary(proposal), affordability: affordability(totalPaise, budget.availablePaise) });
        }
        const response = draftBatchSchema.parse({ proposals, exclusions, warnings, batchTotalPaise, budget, affordability: affordability(batchTotalPaise, budget.availablePaise), asOf: asOf.toISOString() });
        await tx.idempotencyRecord.create({ data: { userId: context.userId, operation: 'CREATE_PROPOSALS', key, requestHash: hash, response } });
        return response;
      });
    }
  return {
    create: (input: CreateProposalInput, key: string, actor: MutationContext) => createDraft(input, key, actor),
    createForAgent: (input: CreateProposalInput, runId: string, actor: MutationContext) => createDraft({ ...input, reason: 'AI-assisted replenishment requested by authenticated user.' }, `agent-${runId}`, { ...actor, actorKind: 'AI' }, runId),
    async list(input: ProposalQuery) {
      const query = proposalQuerySchema.parse(input);
      const where = query.status ? { status: query.status } : {};
      return db.$transaction(async (tx) => {
        const budget = await createReadService(tx, clock).budget();
        const items = (await tx.purchaseProposal.findMany({ where, include: summaryInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }))
          .map((proposal) => ({ ...proposalSummary(proposal), affordability: proposal.status === 'DRAFT' ? affordability(proposal.totalPaise, budget.availablePaise) : null }));
        return { items, total: await tx.purchaseProposal.count({ where }), page: query.page, pageSize: query.pageSize };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
    detail,
    approve: (id: string, actor: MutationContext) => decide(id, 'APPROVED', undefined, actor),
    reject: (id: string, reason: string, actor: MutationContext) => decide(id, 'REJECTED', reason, actor),
    async dashboard() {
      const asOf = clock();
      return db.$transaction(async (tx) => {
        const reads = createReadService(tx, () => asOf);
        const inventory = await reads.inventory(inventoryQuerySchema.parse({ pageSize: 1 }));
        const budget = await reads.budget();
        const grouped = await tx.purchaseProposal.groupBy({ by: ['status'], _count: { _all: true } });
        const proposalCounts = { DRAFT: 0, APPROVED: 0, REJECTED: 0 };
        for (const row of grouped) proposalCounts[row.status] = row._count._all;
        const recentProposals = (await tx.purchaseProposal.findMany({ include: summaryInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5 }))
          .map((proposal) => ({ ...proposalSummary(proposal), affordability: proposal.status === 'DRAFT' ? affordability(proposal.totalPaise, budget.availablePaise) : null }));
        return { ...inventory.summary, pendingProposals: proposalCounts.DRAFT, availableBudgetPaise: budget.availablePaise, currency: 'INR' as const, budget, proposalCounts, recentProposals, asOf: asOf.toISOString() };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
    async audit(input: AuditQuery) {
      const query = auditQuerySchema.parse(input);
      const where = { ...(query.entityType ? { entityType: query.entityType } : {}), ...(query.entityId ? { entityId: query.entityId } : {}) };
      return db.$transaction(async (tx) => ({ items: (await tx.auditEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize })).map(auditResult), total: await tx.auditEvent.count({ where }), page: query.page, pageSize: query.pageSize }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
  };
}
export type ProposalService = ReturnType<typeof createProposalService>;
