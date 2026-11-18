import { describe, expect, it } from 'vitest';
import { inventoryRisk } from './inventory.js';
import { compareSupplierQuotes, quoteAffordability, type QuoteInput } from './suppliers.js';

const asOf = new Date('2026-11-16T12:00:00Z');
const product = { id: '11111111-1111-4111-a111-111111111111', sku: 'A', name: 'Product', stockQuantity: 70 };
const risk = inventoryRisk(product, [{ date: new Date('2026-11-15'), quantity: 300 }], asOf);
function quote(id: string, unitPricePaise: number, leadTimeDays: number, code = id): QuoteInput {
  return { id, supplierId: id, productId: product.id, unitPricePaise, leadTimeDays, supplier: { code, name: code, active: true } };
}
describe('supplier comparison', () => {
  it('chooses cheapest on-time quote instead of cheapest overall or fastest', () => {
    const result = compareSupplierQuotes(risk, [quote('slow', 100, 12), quote('fast', 300, 2), quote('balanced', 200, 6)]);
    expect(result.selectedQuoteId).toBe('balanced');
    expect(result.lateDeliveryRisk).toBe(false);
    expect(result.quantity).toBe(230);
    expect(result.quotes[0]?.lineTotalPaise).toBe(46_000);
    expect(quoteAffordability(result, 45_000)).toEqual({ overBudget: true, shortfallPaise: 1000 });
  });
  it('treats arrival exactly at stockout as late and chooses fastest fallback', () => {
    const result = compareSupplierQuotes(risk, [quote('equal', 300, 7), quote('cheap', 100, 8)], 2);
    expect(result.selectedQuoteId).toBe('equal');
    expect(result.selectionReason).toBe('FASTEST_AVAILABLE');
    expect(result.lateDeliveryRisk).toBe(true);
    expect(result.quotes[0]?.arrivesBeforeStockout).toBe(false);
  });
  it('breaks ties by delivery time then supplier code regardless of input order', () => {
    const result = compareSupplierQuotes(risk, [quote('C', 100, 5), quote('B', 100, 4), quote('A', 100, 4)]);
    expect(result.selectedQuoteId).toBe('A');
    const late = compareSupplierQuotes(risk, [quote('C', 200, 8), quote('B', 100, 8), quote('A', 100, 8)]);
    expect(late.selectedQuoteId).toBe('A');
  });
  it('requires explicit quantities for zero demand and otherwise ranks by price', () => {
    const noDemand = inventoryRisk(product, [], asOf);
    const quotes = [quote('fast', 200, 2), quote('cheap', 100, 12)];
    const missing = compareSupplierQuotes(noDemand, quotes);
    expect(missing).toMatchObject({ quantityRequired: true, quantity: null, selectedQuoteId: null });
    expect(quoteAffordability(missing, 10)).toBeNull();
    expect(compareSupplierQuotes(noDemand, quotes, 3)).toMatchObject({ selectedQuoteId: 'cheap', lateDeliveryRisk: false });
    const stockout = inventoryRisk({ ...product, stockQuantity: 0 }, [], asOf);
    expect(compareSupplierQuotes(stockout, quotes, 3)).toMatchObject({ selectedQuoteId: 'fast', lateDeliveryRisk: true });
  });
  it('ignores inactive/wrong-product quotes and rejects missing quotes or invalid quantities', () => {
    const inactive = { ...quote('inactive', 1, 1), supplier: { code: 'inactive', name: 'Inactive', active: false } };
    const other = { ...quote('other', 1, 1), productId: 'another-product' };
    expect(() => compareSupplierQuotes(risk, [inactive, other])).toThrow('No active supplier quote');
    expect(() => compareSupplierQuotes(risk, [quote('valid', 100, 1)], 0)).toThrow();
    expect(() => compareSupplierQuotes(risk, [quote('valid', 2_147_483_647, 1)], 2)).toThrow();
  });
  it('reports pending replenishment exclusions while allowing explicit comparison', () => {
    const pending = { ...risk, hasPendingReplenishment: true, eligibleForAutomaticReplenishment: false, exclusionReason: 'EXISTING_PROPOSAL' as const };
    expect(compareSupplierQuotes(pending, [quote('A', 100, 1)]).automaticReplenishmentExcluded).toBe(true);
    expect(compareSupplierQuotes(pending, [quote('A', 100, 1)], 2)).toMatchObject({ automaticReplenishmentExcluded: false, hasPendingReplenishment: true });
  });
});
