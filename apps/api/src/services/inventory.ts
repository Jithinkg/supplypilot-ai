import { z } from 'zod';
import { quantitySchema, riskRowSchema, type RiskRow } from '@supplypilot/contracts';

const DAY_MS = 86_400_000;
export interface DailySaleInput { date: Date; quantity: number }
export interface StockProduct { id: string; sku: string; name: string; stockQuantity: number }

export function salesWindow(asOf: Date) {
  z.date().parse(asOf);
  const endExclusive = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const start = new Date(endExclusive.getTime() - 30 * DAY_MS);
  const lastDate = new Date(endExclusive.getTime() - DAY_MS);
  return { start, endExclusive, windowStart: start.toISOString().slice(0, 10), windowEnd: lastDate.toISOString().slice(0, 10) };
}

export function salesHistory(sales: readonly DailySaleInput[], asOf: Date) {
  const window = salesWindow(asOf);
  const days = Array.from({ length: 30 }, (_, index) => ({ date: new Date(window.start.getTime() + index * DAY_MS).toISOString().slice(0, 10), quantity: 0 }));
  for (const sale of sales) {
    z.date().parse(sale.date);
    quantitySchema.parse(sale.quantity);
    const day = Math.floor((sale.date.getTime() - window.start.getTime()) / DAY_MS);
    if (day >= 0 && day < 30) {
      const entry = days[day];
      if (entry) entry.quantity = quantitySchema.parse(entry.quantity + sale.quantity);
    }
  }
  const totalSold = days.reduce((total, day) => total + day.quantity, 0);
  if (!Number.isSafeInteger(totalSold)) throw new Error('Sales total exceeds safe integer bounds.');
  return { days, totalSold, averageDailySales: totalSold / 30, windowStart: window.windowStart, windowEnd: window.windowEnd };
}

export function inventoryRisk(product: StockProduct, sales: readonly DailySaleInput[], asOf: Date, hasPendingReplenishment = false): RiskRow {
  const stock = quantitySchema.parse(product.stockQuantity);
  const { totalSold, averageDailySales } = salesHistory(sales, asOf);
  // Compute the exact ratio directly to avoid boundary drift from a rounded average.
  const estimatedDaysUntilStockout = stock === 0 ? 0 : totalSold === 0 ? null : stock * 30 / totalSold;
  const riskLevel = estimatedDaysUntilStockout === null ? 'LOW' : estimatedDaysUntilStockout <= 7 ? 'CRITICAL' : estimatedDaysUntilStockout <= 14 ? 'HIGH' : 'LOW';
  // Thirty days of a thirty-day average equals totalSold; no floating-point ceil is needed.
  const recommendedQuantity = quantitySchema.parse(Math.max(0, totalSold - stock));
  const exclusionReason = hasPendingReplenishment ? 'EXISTING_PROPOSAL' : totalSold === 0 ? 'NO_RECENT_DEMAND' : recommendedQuantity === 0 ? 'TARGET_STOCK_MET' : null;
  return riskRowSchema.parse({ productId: product.id, sku: product.sku, name: product.name, stock, averageDailySales, estimatedDaysUntilStockout, riskLevel, recommendedQuantity,
    hasPendingReplenishment, eligibleForAutomaticReplenishment: exclusionReason === null, exclusionReason });
}

const priority = { CRITICAL: 0, HIGH: 1, LOW: 2 };
export function sortRisks(rows: readonly RiskRow[]) {
  return [...rows].sort((a, b) => priority[a.riskLevel] - priority[b.riskLevel]
    || (a.estimatedDaysUntilStockout ?? Infinity) - (b.estimatedDaysUntilStockout ?? Infinity)
    || a.sku.localeCompare(b.sku));
}
export function riskSummary(rows: readonly RiskRow[]) {
  return { totalProducts: rows.length, atRiskNext14Days: rows.filter((row) => row.riskLevel !== 'LOW').length, stockoutWithin7Days: rows.filter((row) => row.riskLevel === 'CRITICAL').length };
}
