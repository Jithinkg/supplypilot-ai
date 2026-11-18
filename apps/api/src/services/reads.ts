import type { PrismaClient } from '@prisma/client';
import { budgetSnapshotSchema, inventoryQuerySchema, productIdSchema, positiveQuantitySchema, type InventoryQuery } from '@supplypilot/contracts';
import { HttpError } from '../middleware/errors.js';
import { inventoryRisk, riskSummary, salesHistory, salesWindow, sortRisks } from './inventory.js';
import { availableBudgetPaise } from './money.js';
import { compareSupplierQuotes, quoteAffordability } from './suppliers.js';

export function createReadService(db: Pick<PrismaClient, 'product' | 'budget' | 'supplierQuote'>, clock = () => new Date()) {
  async function products(asOf: Date, productId?: string) {
    const { start, endExclusive } = salesWindow(asOf);
    return db.product.findMany({
      where: productId ? { id: productIdSchema.parse(productId) } : {},
      include: { sales: { where: { date: { gte: start, lt: endExclusive } } }, proposalLines: { where: { proposal: { status: { in: ['DRAFT', 'APPROVED'] } } }, select: { id: true } } },
    });
  }
  async function budget(asOf: Date) {
    const row = await db.budget.findUnique({ where: { key: 'SHARED' } });
    if (!row) throw new HttpError(503, 'BUDGET_NOT_INITIALIZED', 'Run the business-data seed to initialize the shared budget.');
    return budgetSnapshotSchema.parse({ budgetId: row.id, currency: row.currency, allocatedPaise: row.allocatedPaise, reservedPaise: row.reservedPaise,
      availablePaise: availableBudgetPaise(row.allocatedPaise, row.reservedPaise), asOf: asOf.toISOString() });
  }
  return {
    async inventory(query: InventoryQuery) {
      const parsed = inventoryQuerySchema.parse(query);
      const asOf = clock();
      const records = await products(asOf);
      const rows = sortRisks(records.map((row) => inventoryRisk(row, row.sales, asOf, row.proposalLines.length > 0)));
      const search = parsed.search.toLowerCase();
      const filtered = rows.filter((row) => (!parsed.risk || row.riskLevel === parsed.risk) && (!search || `${row.sku} ${row.name}`.toLowerCase().includes(search)));
      const { windowStart, windowEnd } = salesWindow(asOf);
      return { items: filtered.slice((parsed.page - 1) * parsed.pageSize, parsed.page * parsed.pageSize), total: filtered.length, page: parsed.page, pageSize: parsed.pageSize,
        summary: riskSummary(rows), asOf: asOf.toISOString(), windowStart, windowEnd };
    },
    async sales(productId: string) {
      const asOf = clock();
      const [product] = await products(asOf, productId);
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      return { productId, ...salesHistory(product.sales, asOf), asOf: asOf.toISOString() };
    },
    async quotes(productId: string, quantity?: number) {
      if (quantity !== undefined) positiveQuantitySchema.parse(quantity);
      const asOf = clock();
      const [product] = await products(asOf, productId);
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
      const risk = inventoryRisk(product, product.sales, asOf, product.proposalLines.length > 0);
      const quotes = await db.supplierQuote.findMany({ where: { productId, supplier: { active: true } }, include: { supplier: true } });
      const comparison = compareSupplierQuotes(risk, quotes, quantity);
      const snapshot = await budget(asOf);
      return { ...comparison, budget: snapshot, affordability: quoteAffordability(comparison, snapshot.availablePaise), asOf: asOf.toISOString() };
    },
    async budget() { return budget(clock()); },
  };
}
export type ReadService = ReturnType<typeof createReadService>;
