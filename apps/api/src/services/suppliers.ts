import { positiveQuantitySchema, type RiskRow } from '@supplypilot/contracts';
import { affordability, lineTotalPaise } from './money.js';
import { HttpError } from '../middleware/errors.js';

export interface QuoteInput {
  id: string; supplierId: string; productId: string; unitPricePaise: number; leadTimeDays: number;
  supplier: { code: string; name: string; active: boolean };
}

export function compareSupplierQuotes(risk: RiskRow, quotes: readonly QuoteInput[], explicitQuantity?: number) {
  const quantity = explicitQuantity === undefined
    ? risk.averageDailySales === 0 || risk.recommendedQuantity === 0 ? null : risk.recommendedQuantity
    : positiveQuantitySchema.parse(explicitQuantity);
  const active = quotes.filter((quote) => quote.supplier.active && quote.productId === risk.productId);
  for (const quote of active) {
    positiveQuantitySchema.parse(quote.leadTimeDays);
    // Validate price even when a zero-demand product has no selected quantity.
    lineTotalPaise(quote.unitPricePaise, 1);
  }
  if (!active.length) throw new HttpError(409, 'NO_SUPPLIER_QUOTES', 'No active supplier quote is available for this product.');
  const days = risk.estimatedDaysUntilStockout;
  const requiresDelivery = days !== null;
  const onTime = active.filter((quote) => days !== null && quote.leadTimeDays < days);
  const lateDeliveryRisk = requiresDelivery && onTime.length === 0;
  const priceFirst = (a: QuoteInput, b: QuoteInput) => a.unitPricePaise - b.unitPricePaise || a.leadTimeDays - b.leadTimeDays || a.supplier.code.localeCompare(b.supplier.code);
  const speedFirst = (a: QuoteInput, b: QuoteInput) => a.leadTimeDays - b.leadTimeDays || priceFirst(a, b);
  const ranked = [...active].sort((a, b) => {
    if (lateDeliveryRisk) return speedFirst(a, b);
    if (days !== null) {
      const aOnTime = a.leadTimeDays < days;
      const bOnTime = b.leadTimeDays < days;
      if (aOnTime !== bOnTime) return aOnTime ? -1 : 1;
    }
    return priceFirst(a, b);
  });
  const selected = ranked[0];
  if (!selected) throw new HttpError(409, 'NO_SUPPLIER_QUOTES', 'No supplier could be selected.');
  return {
    productId: risk.productId, quantity, selectedQuoteId: quantity === null ? null : selected.id,
    quantityRequired: quantity === null, lateDeliveryRisk,
    hasPendingReplenishment: risk.hasPendingReplenishment,
    automaticReplenishmentExcluded: explicitQuantity === undefined && !risk.eligibleForAutomaticReplenishment,
    exclusionReason: explicitQuantity === undefined ? risk.exclusionReason : null,
    selectionReason: lateDeliveryRisk ? 'FASTEST_AVAILABLE' : days === null ? 'LOWEST_PRICE_NO_RECENT_DEMAND' : 'LOWEST_PRICE_BEFORE_STOCKOUT',
    quotes: ranked.map((quote) => ({
      quoteId: quote.id, supplierId: quote.supplierId, supplierCode: quote.supplier.code, supplierName: quote.supplier.name,
      unitPricePaise: quote.unitPricePaise, leadTimeDays: quote.leadTimeDays,
      arrivesBeforeStockout: days === null ? null : quote.leadTimeDays < days,
      lineTotalPaise: quantity === null ? null : lineTotalPaise(quote.unitPricePaise, quantity),
    })),
  };
}

export function quoteAffordability(comparison: ReturnType<typeof compareSupplierQuotes>, availablePaise: number) {
  const selected = comparison.quotes.find((quote) => quote.quoteId === comparison.selectedQuoteId);
  return selected?.lineTotalPaise === undefined || selected.lineTotalPaise === null ? null : affordability(selected.lineTotalPaise, availablePaise);
}
