import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { budgetSnapshotSchema, inventoryQuerySchema, riskListSchema } from '@supplypilot/contracts';
import { readEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { createReadService } from './services/reads.js';
import { createApp } from './app.js';
import { createAuthService } from './services/auth.js';
import { demoData, demoId, referenceDate } from '../prisma/demo-data.js';
import { seedBusinessData } from '../prisma/seed-business.js';

const env = readEnv();
const db = createDatabase(env.DATABASE_URL);
const asOf = referenceDate(process.env.SEED_REFERENCE_DATE);
const fixture = demoData(asOf);
const reads = createReadService(db, () => asOf);
const app = createApp({ auth: createAuthService(db), reads, webOrigin: env.WEB_ORIGIN, production: false, checkDatabase: async () => { await db.$queryRaw`SELECT 1`; } });
afterAll(async () => { await db.$disconnect(); });

describe('Day 2 real database', () => {
  it('contains exact demo seed counts and consistent reservations/audit', async () => {
    expect(await db.product.count()).toBe(50);
    expect(await db.supplier.count()).toBe(10);
    expect(await db.dailySale.count()).toBe(1500);
    expect(await db.supplierQuote.count()).toBe(150);
    const budget = await reads.budget();
    const reservations = await db.budgetReservation.findMany({ where: { budgetId: budget.budgetId }, include: { proposal: { include: { lines: true, decisionMaker: true } } } });
    expect(budget.allocatedPaise).toBe(50_000_000);
    expect(reservations).toHaveLength(2);
    expect(budget.reservedPaise).toBe(reservations.reduce((total, reservation) => total + reservation.amountPaise, 0));
    for (const reservation of reservations) {
      expect(reservation.proposal.status).toBe('APPROVED');
      expect(reservation.proposal.decisionMaker?.role).toBe('MANAGER');
      expect(reservation.amountPaise).toBe(reservation.proposal.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0));
      expect(await db.auditEvent.count({ where: { entityId: reservation.proposalId, action: 'PROPOSAL_APPROVED' } })).toBe(1);
    }
  });
  it('returns validated risk data with matching portfolio KPI windows and pagination', async () => {
    const all = riskListSchema.parse(await reads.inventory(inventoryQuerySchema.parse({ pageSize: 100 })));
    expect(all.items).toHaveLength(50);
    expect(all.summary.atRiskNext14Days).toBe(all.items.filter((row) => row.riskLevel !== 'LOW').length);
    expect(all.summary.stockoutWithin7Days).toBe(all.items.filter((row) => row.riskLevel === 'CRITICAL').length);
    const exact7 = all.items.find((row) => row.sku === 'SP-003');
    const exact14 = all.items.find((row) => row.sku === 'SP-004');
    expect(exact7).toMatchObject({ estimatedDaysUntilStockout: 7, riskLevel: 'CRITICAL' });
    expect(exact14).toMatchObject({ estimatedDaysUntilStockout: 14, riskLevel: 'HIGH' });
    expect(all.items.find((row) => row.sku === 'SP-007')).toMatchObject({ hasPendingReplenishment: true, eligibleForAutomaticReplenishment: false });
    const filtered = await reads.inventory(inventoryQuerySchema.parse({ risk: 'HIGH', pageSize: 2 }));
    expect(filtered.items).toHaveLength(2);
    expect(filtered.items.every((row) => row.riskLevel === 'HIGH')).toBe(true);
    expect(filtered.summary).toEqual(all.summary);
    expect((await reads.inventory(inventoryQuerySchema.parse({ search: 'sp-003' }))).total).toBe(1);
  });
  it('uses exactly 30 completed sales days and quotes consistent with backend totals', async () => {
    const id = demoId('product-2');
    const sales = await reads.sales(id);
    expect(sales.days).toHaveLength(30);
    expect(sales.averageDailySales).toBe(10);
    expect(sales.windowStart).toBe(fixture.windowStart);
    const quotes = await reads.quotes(id);
    expect(quotes.quantity).toBe(230);
    expect(quotes.quotes[0]?.leadTimeDays).toBe(6);
    expect(quotes.quotes[0]?.lineTotalPaise).toBe(230 * (10_000 + 2 * 271 + 1500));
    expect((await reads.quotes(demoId('product-1'))).quantityRequired).toBe(true);
    expect((await reads.quotes(demoId('product-1'), 3)).quantity).toBe(3);
    await expect(reads.sales(randomUUID())).rejects.toThrow('Product not found');
    await expect(reads.quotes(randomUUID())).rejects.toThrow('Product not found');
  });
  it('enforces authentication and query validation on the read API for both roles', async () => {
    for (const path of ['/api/inventory/risks', '/api/budget', `/api/products/${demoId('product-2')}/quotes`]) expect((await request(app).get(path)).status).toBe(401);
    for (const role of ['STAFF', 'MANAGER'] as const) {
      const agent = request.agent(app);
      const login = await agent.post('/api/auth/login').set('Origin', env.WEB_ORIGIN).send({ email: process.env[`SEED_${role}_EMAIL`], password: process.env[`SEED_${role}_PASSWORD`] });
      expect(login.status).toBe(200);
      expect(riskListSchema.parse((await agent.get('/api/inventory/risks')).body).total).toBe(50);
      expect(budgetSnapshotSchema.parse((await agent.get('/api/budget')).body).currency).toBe('INR');
      expect((await agent.get('/api/inventory/risks?pageSize=101')).status).toBe(400);
      expect((await agent.get('/api/inventory/risks?risk=UNKNOWN')).status).toBe(400);
      expect((await agent.get('/api/products/not-a-uuid/sales')).status).toBe(400);
      expect((await agent.get(`/api/products/${demoId('product-2')}/quotes?quantity=0`)).status).toBe(400);
      expect((await agent.get(`/api/products/${randomUUID()}/quotes`)).status).toBe(404);
      expect((await agent.get(`/api/products/${demoId('product-2')}/quotes?quantity=2`)).body.quantity).toBe(2);
      await agent.post('/api/auth/logout').set('Origin', env.WEB_ORIGIN).set('x-csrf-token', login.body.csrfToken).expect(204);
    }
  });
  it('can reseed twice without duplicates, changed decisions, new audit entries or double reservation', async () => {
    const staff = await db.user.findUniqueOrThrow({ where: { email: process.env.SEED_STAFF_EMAIL! } });
    const manager = await db.user.findUniqueOrThrow({ where: { email: process.env.SEED_MANAGER_EMAIL! } });
    const before = { budget: await reads.budget(), proposals: await db.purchaseProposal.findMany({ orderBy: { id: 'asc' } }), audits: await db.auditEvent.count({ where: { requestId: 'demo-seed' } }) };
    await seedBusinessData(db, staff.id, manager.id, asOf);
    await seedBusinessData(db, staff.id, manager.id, asOf);
    expect(await reads.budget()).toEqual(before.budget);
    expect(await db.purchaseProposal.findMany({ orderBy: { id: 'asc' } })).toEqual(before.proposals);
    expect(await db.auditEvent.count({ where: { requestId: 'demo-seed' } })).toBe(before.audits);
    expect(await db.dailySale.count()).toBe(1500);
    expect(await db.supplierQuote.count()).toBe(150);
  });
  it('refreshes an overlapping sales window when the seed reference date changes', async () => {
    const staff = await db.user.findUniqueOrThrow({ where: { email: process.env.SEED_STAFF_EMAIL! } });
    const manager = await db.user.findUniqueOrThrow({ where: { email: process.env.SEED_MANAGER_EMAIL! } });
    const nextDay = new Date(asOf.getTime() + 86_400_000);
    try {
      await seedBusinessData(db, staff.id, manager.id, nextDay);
      const persisted = await db.dailySale.findMany({ orderBy: [{ productId: 'asc' }, { date: 'asc' }] });
      const expected = demoData(nextDay).sales;
      expect(persisted).toHaveLength(1500);
      const expectedQuantities = new Map(expected.map((sale) => [sale.id, sale.quantity]));
      expect(persisted.every((sale) => expectedQuantities.get(sale.id) === sale.quantity)).toBe(true);
    } finally {
      await seedBusinessData(db, staff.id, manager.id, asOf);
    }
  });
});
