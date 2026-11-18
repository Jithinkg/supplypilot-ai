import { describe, expect, it } from 'vitest';
import { inventoryRisk, riskSummary, salesHistory, salesWindow, sortRisks } from './inventory.js';

const asOf = new Date('2026-11-16T18:00:00.000Z');
const product = { id: '11111111-1111-4111-a111-111111111111', sku: 'A', name: 'Product', stockQuantity: 70 };
const demand = [{ date: new Date('2026-11-15T00:00:00.000Z'), quantity: 300 }];
describe('deterministic inventory policy', () => {
  it.each([[0, 'CRITICAL', 0], [70, 'CRITICAL', 7], [71, 'HIGH', 7.1], [140, 'HIGH', 14], [141, 'LOW', 14.1]] as const)('classifies stock %s using unrounded days', (stockQuantity, level, days) => {
    const row = inventoryRisk({ ...product, stockQuantity }, demand, asOf);
    expect(row.riskLevel).toBe(level);
    expect(row.estimatedDaysUntilStockout).toBe(days);
    expect(row.averageDailySales).toBe(10);
  });
  it('uses 30 completed UTC dates and fills missing dates with zero', () => {
    const result = salesHistory([...demand,
      { date: new Date('2026-11-16T00:00:00Z'), quantity: 900 },
      { date: new Date('2026-10-16T00:00:00Z'), quantity: 800 },
      { date: new Date('2026-10-17T00:00:00Z'), quantity: 30 },
    ], asOf);
    expect(result.days).toHaveLength(30);
    expect(result.days[0]).toEqual({ date: '2026-10-17', quantity: 30 });
    expect(result.days[1]?.quantity).toBe(0);
    expect(result.totalSold).toBe(330);
    expect(result.averageDailySales).toBe(11);
    expect(result.windowEnd).toBe('2026-11-15');
    expect(salesWindow(new Date('2026-11-17T02:00:00+05:30')).windowEnd).toBe('2026-11-15');
  });
  it('distinguishes zero stock from positive stock with no recent demand', () => {
    expect(inventoryRisk({ ...product, stockQuantity: 0 }, [], asOf)).toMatchObject({ riskLevel: 'CRITICAL', estimatedDaysUntilStockout: 0, recommendedQuantity: 0, exclusionReason: 'NO_RECENT_DEMAND' });
    expect(inventoryRisk(product, [], asOf)).toMatchObject({ riskLevel: 'LOW', estimatedDaysUntilStockout: null, eligibleForAutomaticReplenishment: false });
  });
  it('uses exact target arithmetic for fractional demand and excludes existing proposals', () => {
    const fractional = [{ date: demand[0]!.date, quantity: 3 }];
    expect(inventoryRisk({ ...product, stockQuantity: 1 }, fractional, asOf)).toMatchObject({ averageDailySales: 0.1, estimatedDaysUntilStockout: 10, recommendedQuantity: 2 });
    const row = inventoryRisk(product, demand, asOf, true);
    expect(row).toMatchObject({ recommendedQuantity: 230, hasPendingReplenishment: true, eligibleForAutomaticReplenishment: false, exclusionReason: 'EXISTING_PROPOSAL' });
    expect(inventoryRisk({ ...product, stockQuantity: 500 }, demand, asOf)).toMatchObject({ recommendedQuantity: 0, exclusionReason: 'TARGET_STOCK_MET' });
  });
  it('keeps both risk windows consistent and sorts by risk, days and SKU', () => {
    const rows = [140, 0, 500, 70].map((stockQuantity, i) => inventoryRisk({ ...product, sku: String(i), stockQuantity }, demand, asOf));
    expect(riskSummary(rows)).toEqual({ totalProducts: 4, atRiskNext14Days: 3, stockoutWithin7Days: 2 });
    expect(sortRisks(rows).map((row) => row.stock)).toEqual([0, 70, 140, 500]);
    expect(sortRisks([inventoryRisk({ ...product, sku: 'B' }, [], asOf), inventoryRisk(product, [], asOf)])[0]?.sku).toBe('A');
  });
  it('rejects invalid dates, stock and sales values', () => {
    expect(() => salesWindow(new Date('invalid'))).toThrow();
    expect(() => inventoryRisk({ ...product, stockQuantity: -1 }, [], asOf)).toThrow();
    expect(() => salesHistory([{ date: asOf, quantity: 0.5 }], asOf)).toThrow();
  });
});
