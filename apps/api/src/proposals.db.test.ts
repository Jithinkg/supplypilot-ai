import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import request from 'supertest';
import { dashboardSchema, draftBatchSchema, proposalDetailSchema, proposalQuerySchema, proposalListSchema } from '@supplypilot/contracts';
import { readEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { createAuthService, hashToken } from './services/auth.js';
import { createReadService } from './services/reads.js';
import { createProposalService, type MutationContext } from './services/proposals.js';
import { createApp } from './app.js';

const env = readEnv();
const db = createDatabase(env.DATABASE_URL);
const asOf = new Date('2026-11-17T12:00:00Z');
const yesterday = new Date('2026-11-16T00:00:00Z');
const service = createProposalService(db, () => asOf);
const staffId = randomUUID(); const managerId = randomUUID();
const users = [staffId, managerId];
const suppliers: [string, string] = [randomUUID(), randomUUID()];
const products: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
const staffToken = randomBytes(32).toString('hex'); const managerToken = randomBytes(32).toString('hex');
const csrf = randomBytes(32).toString('hex');
const staffContext: MutationContext = { userId: staffId, sessionId: randomUUID(), requestId: 'day3-test', actorKind: 'HUMAN' };
const managerContext: MutationContext = { userId: managerId, sessionId: randomUUID(), requestId: 'day3-test', actorKind: 'HUMAN' };
const app = createApp({ auth: createAuthService(db), reads: createReadService(db, () => asOf), proposals: service, webOrigin: env.WEB_ORIGIN, production: false, checkDatabase: async () => { await db.$queryRaw`SELECT 1`; } });
let originalBudget: { id: string; allocatedPaise: number; reservedPaise: number };
const body = (index = 0, quantity: number | undefined = 10) => ({ items: [{ productId: products[index]!, ...(quantity === undefined ? {} : { quantity }) }], reason: 'Day 3 test replenishment' });
async function draft(index = 0, quantity = 10) { return (await service.create(body(index, quantity), randomUUID(), staffContext)).proposals[0]!; }
function post(path: string, role: 'STAFF' | 'MANAGER' = 'MANAGER') {
  return request(app).post(path).set('Cookie', `supplypilot_session=${role === 'STAFF' ? staffToken : managerToken}`).set('Origin', env.WEB_ORIGIN).set('X-CSRF-Token', csrf);
}

beforeAll(async () => {
  originalBudget = await db.budget.findUniqueOrThrow({ where: { key: 'SHARED' }, select: { id: true, allocatedPaise: true, reservedPaise: true } });
  const passwordHash = await argon2.hash(randomBytes(32), { type: argon2.argon2id });
  for (const [id, role] of [[staffId, 'STAFF'], [managerId, 'MANAGER']] as const) await db.user.create({ data: { id, email: `${id}@example.test`, role, passwordHash } });
  await db.session.createMany({ data: [
    { id: staffContext.sessionId, userId: staffId, tokenHash: hashToken(staffToken), csrfSecret: csrf, expiresAt: new Date(Date.now() + 3600_000) },
    { id: managerContext.sessionId, userId: managerId, tokenHash: hashToken(managerToken), csrfSecret: csrf, expiresAt: new Date(Date.now() + 3600_000) },
  ] });
  await db.supplier.createMany({ data: suppliers.map((id, i) => ({ id, code: `DAY3-${id}`, name: `Test supplier ${i}` })) });
  await db.product.createMany({ data: products.map((id) => ({ id, sku: `DAY3-${id}`, name: 'Test product', unit: 'pack', stockQuantity: 90 })) });
  await db.dailySale.createMany({ data: products.map((productId) => ({ productId, date: yesterday, quantity: 300 })) });
  await db.supplierQuote.createMany({ data: [
    { productId: products[0]!, supplierId: suppliers[0]!, unitPricePaise: 100, leadTimeDays: 2 },
    { productId: products[0]!, supplierId: suppliers[1]!, unitPricePaise: 80, leadTimeDays: 12 },
    { productId: products[1]!, supplierId: suppliers[0]!, unitPricePaise: 150, leadTimeDays: 2 },
    { productId: products[2]!, supplierId: suppliers[1]!, unitPricePaise: 120, leadTimeDays: 2 },
  ] });
});
afterEach(async () => {
  await db.$executeRaw`DROP TRIGGER IF EXISTS day3_audit_failure ON "AuditEvent"`;
  await db.$executeRaw`DROP FUNCTION IF EXISTS day3_audit_failure()`;
  await db.$executeRaw`DROP TRIGGER IF EXISTS day3_reservation_failure ON "BudgetReservation"`;
  await db.$executeRaw`DROP FUNCTION IF EXISTS day3_reservation_failure()`;
  const ids = (await db.purchaseProposal.findMany({ where: { creatorId: { in: users } }, select: { id: true } })).map((p) => p.id);
  await db.auditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: users } }, { entityId: { in: ids } }] } });
  await db.budgetReservation.deleteMany({ where: { proposalId: { in: ids } } });
  await db.proposalLine.deleteMany({ where: { proposalId: { in: ids } } });
  await db.purchaseProposal.deleteMany({ where: { id: { in: ids } } });
  await db.idempotencyRecord.deleteMany({ where: { userId: { in: users } } });
  await db.budget.update({ where: { id: originalBudget.id }, data: { allocatedPaise: originalBudget.allocatedPaise, reservedPaise: originalBudget.reservedPaise } });
  await db.user.update({ where: { id: managerId }, data: { role: 'MANAGER', active: true } });
  await db.supplier.updateMany({ where: { id: { in: suppliers } }, data: { active: true } });
  await db.product.updateMany({ where: { id: { in: products } }, data: { stockQuantity: 90 } });
  await db.dailySale.updateMany({ where: { productId: { in: products } }, data: { quantity: 300 } });
});
afterAll(async () => {
  await db.dailySale.deleteMany({ where: { productId: { in: products } } });
  await db.supplierQuote.deleteMany({ where: { productId: { in: products } } });
  await db.product.deleteMany({ where: { id: { in: products } } });
  await db.supplier.deleteMany({ where: { id: { in: suppliers } } });
  await db.session.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe('Day 3 procurement transactions', () => {
  it('groups products into one DRAFT per supplier with immutable paise snapshots and no reservation', async () => {
    const before = await db.budget.findUniqueOrThrow({ where: { id: originalBudget.id } });
    const result = draftBatchSchema.parse(await service.create({ items: products.map((productId) => ({ productId, quantity: 10 })), reason: 'Restock' }, randomUUID(), staffContext));
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals.every((p) => p.status === 'DRAFT')).toBe(true);
    expect(result.batchTotalPaise).toBe(3700);
    const stored = await db.purchaseProposal.findMany({ where: { creatorId: staffId }, include: { lines: true } });
    expect(stored.find((p) => p.supplierId === suppliers[0])?.lines).toHaveLength(2);
    expect(await db.budget.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    expect(await db.budgetReservation.count({ where: { proposalId: { in: stored.map((p) => p.id) } } })).toBe(0);
    expect(await db.auditEvent.count({ where: { actorUserId: staffId, action: 'PROPOSAL_CREATED' } })).toBe(2);
  });
  it('returns one committed result to concurrent retries and rejects a reused key with different input', async () => {
    const key = randomUUID();
    const [first, second] = await Promise.all([service.create(body(), key, staffContext), service.create(body(), key, staffContext)]);
    expect(second).toEqual(first);
    expect(await db.purchaseProposal.count({ where: { creatorId: staffId } })).toBe(1);
    expect(await db.idempotencyRecord.count({ where: { userId: staffId } })).toBe(1);
    await expect(service.create(body(0, 11), key, staffContext)).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });
  it('scopes idempotency to the user and canonicalizes item order', async () => {
    const key = randomUUID();
    const input = { items: [{ productId: products[0]!, quantity: 2 }, { productId: products[1]!, quantity: 3 }], reason: 'Restock' };
    const first = await service.create(input, key, staffContext);
    expect(await service.create({ ...input, items: [...input.items].reverse() }, key, staffContext)).toEqual(first);
    const other = await service.create(input, key, managerContext);
    expect(other.proposals[0]?.id).not.toBe(first.proposals[0]?.id);
  });
  it('calculates omitted quantity, skips pending automatic replenishment, and permits an explicit repeat with warning', async () => {
    const input = { items: [{ productId: products[0]! }], reason: 'Restock' };
    const first = await service.create(input, randomUUID(), staffContext);
    expect(first.batchTotalPaise).toBe(21_000);
    const skipped = await service.create(input, randomUUID(), staffContext);
    expect(skipped.proposals).toHaveLength(0);
    expect(skipped.exclusions).toEqual([{ productId: products[0], reason: 'EXISTING_PROPOSAL' }]);
    expect((await service.create(body(), randomUUID(), staffContext)).warnings).toContainEqual({ productId: products[0], code: 'EXISTING_REPLENISHMENT' });
  });
  it('requires a zero-demand quantity and skips a satisfied stock target', async () => {
    await db.dailySale.updateMany({ where: { productId: products[0] }, data: { quantity: 0 } });
    await expect(service.create({ items: [{ productId: products[0]! }], reason: 'Restock' }, randomUUID(), staffContext)).rejects.toMatchObject({ code: 'QUANTITY_REQUIRED' });
    expect((await service.create(body(), randomUUID(), staffContext)).proposals).toHaveLength(1);
    await db.product.update({ where: { id: products[1] }, data: { stockQuantity: 500 } });
    expect((await service.create({ items: [{ productId: products[1]! }], reason: 'Restock' }, randomUUID(), staffContext)).exclusions[0]?.reason).toBe('TARGET_STOCK_MET');
  });
  it('does not partially write a multi-supplier request with missing quotes or unknown products', async () => {
    await db.supplier.update({ where: { id: suppliers[1] }, data: { active: false } });
    await expect(service.create({ items: [{ productId: products[0]!, quantity: 10 }, { productId: products[2]!, quantity: 10 }], reason: 'Restock' }, randomUUID(), staffContext)).rejects.toMatchObject({ code: 'NO_SUPPLIER_QUOTES' });
    await expect(service.create({ items: [{ productId: products[0]!, quantity: 10 }, { productId: randomUUID(), quantity: 10 }], reason: 'Restock' }, randomUUID(), staffContext)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    expect(await db.purchaseProposal.count({ where: { creatorId: staffId } })).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { userId: staffId } })).toBe(0);
  });
  it('allows over-budget drafts but blocks approval without changing proposal, funds or audit', async () => {
    await db.budget.update({ where: { id: originalBudget.id }, data: { allocatedPaise: originalBudget.reservedPaise + 50 } });
    const result = await service.create(body(0, 1), randomUUID(), staffContext);
    expect(result.affordability).toEqual({ overBudget: true, shortfallPaise: 50 });
    const id = result.proposals[0]!.id;
    expect((await service.list(proposalQuerySchema.parse({ pageSize: 100 }))).items.find((item) => item.id === id)?.affordability).toEqual(result.affordability);
    const before = await db.budget.findUniqueOrThrow({ where: { id: originalBudget.id } });
    await expect(service.approve(id, managerContext)).rejects.toMatchObject({ status: 409, code: 'INSUFFICIENT_BUDGET' });
    expect(await db.budget.findUniqueOrThrow({ where: { id: originalBudget.id } })).toEqual(before);
    expect((await service.detail(id)).status).toBe('DRAFT');
    expect(await db.budgetReservation.count({ where: { proposalId: id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { entityId: id, action: 'PROPOSAL_APPROVED' } })).toBe(0);
  });
  it('approves once under concurrent duplicate requests and does not change stock', async () => {
    const proposal = await draft();
    const [first, second] = await Promise.all([service.approve(proposal.id, managerContext), service.approve(proposal.id, managerContext)]);
    expect(first.status).toBe('APPROVED'); expect(second.status).toBe('APPROVED');
    expect(first.decisionMaker?.id).toBe(managerId);
    expect((await db.budget.findUniqueOrThrow({ where: { id: originalBudget.id } })).reservedPaise).toBe(originalBudget.reservedPaise + proposal.totalPaise);
    expect(await db.budgetReservation.count({ where: { proposalId: proposal.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { entityId: proposal.id, action: 'PROPOSAL_APPROVED' } })).toBe(1);
    expect((await db.product.findUniqueOrThrow({ where: { id: products[0] } })).stockQuantity).toBe(90);
  });
  it('serializes competing proposals so funds cannot be overspent', async () => {
    const a = await draft(0, 100); const b = await draft(0, 100);
    await db.budget.update({ where: { id: originalBudget.id }, data: { allocatedPaise: originalBudget.reservedPaise + 15_000 } });
    const outcomes = await Promise.allSettled([service.approve(a.id, managerContext), service.approve(b.id, managerContext)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect((await db.budget.findUniqueOrThrow({ where: { id: originalBudget.id } })).reservedPaise).toBe(originalBudget.reservedPaise + 10_000);
  });
  it('approves when funds exactly equal the total', async () => {
    const proposal = await draft();
    await db.budget.update({ where: { id: originalBudget.id }, data: { allocatedPaise: originalBudget.reservedPaise + proposal.totalPaise } });
    const approved = await service.approve(proposal.id, managerContext);
    expect(approved.status).toBe('APPROVED');
    expect(approved.budget.availablePaise).toBe(0);
  });
  it('allows exactly one winner in approve-versus-reject and makes identical rejection repeat-safe', async () => {
    const proposal = await draft();
    const outcomes = await Promise.allSettled([service.approve(proposal.id, managerContext), service.reject(proposal.id, 'Not needed', managerContext)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const another = await draft();
    await service.reject(another.id, 'Not needed', managerContext);
    expect((await service.reject(another.id, 'Not needed', managerContext)).status).toBe('REJECTED');
    await expect(service.reject(another.id, 'Different reason', managerContext)).rejects.toMatchObject({ status: 409 });
    expect(await db.budgetReservation.count({ where: { proposalId: another.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { entityId: another.id, action: 'PROPOSAL_REJECTED' } })).toBe(1);
  });
  it('enforces current server permissions inside services, including AI and revoked-role attempts', async () => {
    const proposal = await draft();
    await expect(service.approve(proposal.id, staffContext)).rejects.toMatchObject({ status: 403 });
    await expect(service.approve(proposal.id, { ...managerContext, actorKind: 'AI' })).rejects.toMatchObject({ status: 403 });
    await db.user.update({ where: { id: managerId }, data: { role: 'STAFF' } });
    await expect(service.reject(proposal.id, 'Not needed', managerContext)).rejects.toMatchObject({ status: 403 });
    await expect(service.approve(proposal.id, { ...managerContext, sessionId: randomUUID() })).rejects.toMatchObject({ status: 401 });
  });
  it('rolls back all draft and approval writes when audit insertion fails', async () => {
    await db.$executeRaw`CREATE FUNCTION day3_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."requestId" = 'test-audit-failure' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$`;
    await db.$executeRaw`CREATE TRIGGER day3_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION day3_audit_failure()`;
    await expect(service.create(body(), randomUUID(), { ...staffContext, requestId: 'test-audit-failure' })).rejects.toThrow();
    expect(await db.purchaseProposal.count({ where: { creatorId: staffId } })).toBe(0);
    expect(await db.idempotencyRecord.count({ where: { userId: staffId } })).toBe(0);
    const proposal = await draft();
    await expect(service.approve(proposal.id, { ...managerContext, requestId: 'test-audit-failure' })).rejects.toThrow();
    expect((await service.detail(proposal.id)).status).toBe('DRAFT');
    expect(await db.budgetReservation.count({ where: { proposalId: proposal.id } })).toBe(0);
    expect((await db.budget.findUniqueOrThrow({ where: { id: originalBudget.id } })).reservedPaise).toBe(originalBudget.reservedPaise);
  });
  it('rolls back the budget increment when reservation insertion fails', async () => {
    const proposal = await draft();
    await db.$executeRaw`CREATE FUNCTION day3_reservation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected reservation failure'; END $$`;
    await db.$executeRaw`CREATE TRIGGER day3_reservation_failure BEFORE INSERT ON "BudgetReservation" FOR EACH ROW EXECUTE FUNCTION day3_reservation_failure()`;
    await expect(service.approve(proposal.id, managerContext)).rejects.toThrow();
    expect((await service.detail(proposal.id)).status).toBe('DRAFT');
    expect((await db.budget.findUniqueOrThrow({ where: { id: originalBudget.id } })).reservedPaise).toBe(originalBudget.reservedPaise);
  });
  it('rejects corrupted persisted totals instead of trusting a proposal header', async () => {
    const proposal = await draft();
    await db.purchaseProposal.update({ where: { id: proposal.id }, data: { totalPaise: 1 } });
    await expect(service.approve(proposal.id, managerContext)).rejects.toMatchObject({ code: 'PROPOSAL_INTEGRITY_ERROR' });
  });
  it('serves list/details/dashboard and strips non-allowlisted audit metadata', async () => {
    const proposal = await draft();
    await db.auditEvent.create({ data: { actorUserId: managerId, actorKind: 'HUMAN', action: 'TEST', entityType: 'PurchaseProposal', entityId: proposal.id, requestId: 'day3-test', metadata: { totalPaise: 1000, contractText: 'restricted-content' } } });
    const detail = proposalDetailSchema.parse(await service.detail(proposal.id));
    expect(JSON.stringify(detail.audit)).not.toContain('restricted-content');
    expect(detail.lines[0]?.quantity).toBe(10);
    const list = proposalListSchema.parse(await service.list(proposalQuerySchema.parse({ status: 'DRAFT', pageSize: 1 })));
    expect(list.items).toHaveLength(1);
    const dashboard = dashboardSchema.parse(await service.dashboard());
    expect(dashboard.totalProducts).toBe(53);
    expect(dashboard.recentProposals).toHaveLength(5);
    expect(dashboard.pendingProposals).toBe(await db.purchaseProposal.count({ where: { status: 'DRAFT' } }));
    const all = await service.list(proposalQuerySchema.parse({ pageSize: 100 }));
    expect(dashboard.recentProposals.map((p) => p.id)).toEqual(all.items.slice(0, 5).map((p) => p.id));
  });
  it('protects HTTP mutations with session, role, origin, CSRF, key and strict body validation', async () => {
    expect((await request(app).post('/api/proposals').send(body())).status).toBe(401);
    expect((await request(app).post('/api/proposals').set('Cookie', `supplypilot_session=${staffToken}`).set('X-CSRF-Token', csrf).send(body())).status).toBe(403);
    expect((await request(app).post('/api/proposals').set('Cookie', `supplypilot_session=${staffToken}`).set('Origin', env.WEB_ORIGIN).send(body())).status).toBe(403);
    expect((await post('/api/proposals', 'STAFF').send(body())).status).toBe(400);
    expect((await post('/api/proposals', 'STAFF').set('Idempotency-Key', randomUUID()).send({ ...body(), status: 'APPROVED' })).status).toBe(400);
    const created = await post('/api/proposals', 'STAFF').set('Idempotency-Key', randomUUID()).send(body());
    expect(created.status).toBe(201);
    const id = created.body.proposals[0].id as string;
    expect((await post(`/api/proposals/${id}/approve`, 'STAFF').send({})).status).toBe(403);
    expect((await post(`/api/proposals/${id}/approve`).send({ totalPaise: 1 })).status).toBe(400);
    expect((await post(`/api/proposals/${id}/reject`).send({ reason: '' })).status).toBe(400);
    expect((await post(`/api/proposals/${id}/approve`).send({})).status).toBe(200);
    expect((await request(app).get('/api/audit-events').set('Cookie', `supplypilot_session=${staffToken}`)).status).toBe(403);
    expect((await request(app).get('/api/audit-events').set('Cookie', `supplypilot_session=${managerToken}`)).status).toBe(200);
    expect((await request(app).get('/api/proposals?pageSize=101').set('Cookie', `supplypilot_session=${staffToken}`)).status).toBe(400);
    expect((await post('/api/orders').send({})).status).toBe(404);
    expect((await post(`/api/proposals/${id}/order`).send({})).status).toBe(404);
  });
});
