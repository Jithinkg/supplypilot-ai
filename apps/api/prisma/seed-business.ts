import type { PrismaClient } from '@prisma/client';
import { demoData, demoId } from './demo-data.js';
import { lineTotalPaise, sumPaise } from '../src/services/money.js';

export async function seedBusinessData(db: PrismaClient, staffId: string, managerId: string, asOf: Date) {
  const fixture = demoData(asOf);
  return db.$transaction(async (tx) => {
    // Only the named demo records are refreshed; unrelated application data is retained.
    for (const supplier of fixture.suppliers) await tx.supplier.upsert({ where: { id: supplier.id }, create: supplier, update: supplier });
    for (const product of fixture.products) await tx.product.upsert({ where: { id: product.id }, create: product, update: product });
    for (const quote of fixture.quotes) await tx.supplierQuote.upsert({ where: { id: quote.id }, create: quote, update: quote });
    const productIds = fixture.products.map((product) => product.id);
    await tx.dailySale.deleteMany({ where: { productId: { in: productIds }, OR: [{ date: { lt: fixture.start } }, { date: { gte: fixture.endExclusive } }] } });
    await tx.dailySale.createMany({ data: fixture.sales, skipDuplicates: true });
    // Refresh overlapping fixture dates too, so moving the reference date remains reproducible.
    const quantities = new Set(fixture.sales.map((sale) => sale.quantity));
    for (const quantity of quantities) {
      await tx.dailySale.updateMany({ where: { id: { in: fixture.sales.filter((sale) => sale.quantity === quantity).map((sale) => sale.id) } }, data: { quantity } });
    }
    const budget = await tx.budget.upsert({ where: { key: 'SHARED' }, create: { id: demoId('budget'), allocatedPaise: 50_000_000 }, update: {} });
    // History is fixture data, not an approval service. Never overwrite a real or previously decided proposal.
    const historical = await tx.purchaseProposal.count();
    if (historical === 0) {
      const statuses = ['APPROVED', 'DRAFT', 'REJECTED', 'APPROVED', 'DRAFT'] as const;
      const reservationAmounts: number[] = [];
      for (let i = 0; i < statuses.length; i++) {
        const status = statuses[i]!;
        const quote = fixture.quotes[(i + 6) * 3]!;
        const quantity = 10 + i * 5;
        const totalPaise = lineTotalPaise(quote.unitPricePaise, quantity);
        const id = demoId(`proposal-${i}`);
        const createdAt = new Date(fixture.endExclusive.getTime() - (6 - i) * 86_400_000);
        const decidedAt = status === 'DRAFT' ? null : new Date(createdAt.getTime() + 3_600_000);
        await tx.purchaseProposal.create({ data: {
          id, supplierId: quote.supplierId, budgetId: budget.id, creatorId: staffId, source: 'HUMAN', status, totalPaise,
          reason: 'Seeded historical procurement example', createdAt, decidedAt,
          decisionMakerId: status === 'DRAFT' ? null : managerId,
          rejectionReason: status === 'REJECTED' ? 'Seeded manager decision: purchase not needed.' : null,
          lines: { create: { id: demoId(`line-${i}`), productId: quote.productId, quoteId: quote.id, quantity, unitPricePaise: quote.unitPricePaise, leadTimeDays: quote.leadTimeDays, lineTotalPaise: totalPaise } },
        } });
        await tx.auditEvent.create({ data: { id: demoId(`proposal-created-${i}`), actorUserId: staffId, actorKind: 'HUMAN', action: 'PROPOSAL_CREATED', entityType: 'PurchaseProposal', entityId: id, requestId: 'demo-seed', createdAt, metadata: { fixture: true, totalPaise } } });
        if (status !== 'DRAFT') {
          await tx.auditEvent.create({ data: { id: demoId(`proposal-decided-${i}`), actorUserId: managerId, actorKind: 'HUMAN', action: status === 'APPROVED' ? 'PROPOSAL_APPROVED' : 'PROPOSAL_REJECTED', entityType: 'PurchaseProposal', entityId: id, requestId: 'demo-seed', createdAt: decidedAt!, metadata: { fixture: true, totalPaise } } });
        }
        if (status === 'APPROVED') {
          reservationAmounts.push(totalPaise);
          await tx.budgetReservation.create({ data: { id: demoId(`reservation-${i}`), proposalId: id, budgetId: budget.id, amountPaise: totalPaise, createdAt: decidedAt! } });
        }
      }
      // Existing balances are never reset. PostgreSQL enforces sufficient budget for fixtures too.
      await tx.budget.update({ where: { id: budget.id }, data: { reservedPaise: { increment: sumPaise(reservationAmounts) } } });
    }
    return { products: fixture.products.length, suppliers: fixture.suppliers.length, sales: fixture.sales.length, quotes: fixture.quotes.length, windowStart: fixture.windowStart, windowEnd: fixture.windowEnd };
  }, { timeout: 30_000 });
}
