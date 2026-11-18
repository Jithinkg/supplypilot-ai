import { describe, expect, it } from 'vitest';
import { demoData, referenceDate } from '../prisma/demo-data.js';
import { inventoryRisk, riskSummary } from './services/inventory.js';
describe('reproducible demo fixtures', () => {
  it('produces exact counts, boundary scenarios and integer-paise quotes', () => {
    const asOf = referenceDate('2026-11-16');
    const fixture = demoData(asOf);
    expect(fixture).toEqual(demoData(asOf));
    expect(fixture.products).toHaveLength(50);
    expect(fixture.suppliers).toHaveLength(10);
    expect(fixture.sales).toHaveLength(1500);
    expect(fixture.quotes).toHaveLength(150);
    expect(new Set(fixture.sales.map((sale) => `${sale.productId}:${sale.date.toISOString()}`)).size).toBe(1500);
    expect(fixture.windowStart).toBe('2026-10-17');
    expect(fixture.windowEnd).toBe('2026-11-15');
    const risks = fixture.products.map((product) => inventoryRisk(product, fixture.sales.filter((sale) => sale.productId === product.id), asOf));
    expect(new Set(risks.map((row) => row.riskLevel))).toEqual(new Set(['CRITICAL', 'HIGH', 'LOW']));
    expect(risks[0]).toMatchObject({ stock: 0, averageDailySales: 0, riskLevel: 'CRITICAL' });
    expect(risks[2]?.estimatedDaysUntilStockout).toBe(7);
    expect(risks[3]?.estimatedDaysUntilStockout).toBe(14);
    expect(riskSummary(risks).atRiskNext14Days).toBeGreaterThan(riskSummary(risks).stockoutWithin7Days);
    expect(fixture.quotes.every((quote) => Number.isInteger(quote.unitPricePaise))).toBe(true);
  });
  it('rejects invalid reference dates', () => {
    expect(() => referenceDate('2026-02-30')).toThrow();
    expect(() => referenceDate('not-a-date')).toThrow();
  });
});
