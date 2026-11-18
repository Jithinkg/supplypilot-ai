import { z } from 'zod';
import { budgetSnapshotSchema, riskRowSchema, supplierComparisonSchema, draftBatchSchema, type AssistantResult } from '@supplypilot/contracts';
import { money, stockoutDays } from '@/lib/format';
import { StatusBadge } from '@/components/common';
const stocks = z.array(riskRowSchema.pick({ productId: true, sku: true, name: true, stock: true }));
const sales = z.array(z.object({ productId: z.uuid(), totalSold: z.number().int().nonnegative(), averageDailySales: z.number().nonnegative(), windowStart: z.string(), windowEnd: z.string(), days: z.array(z.object({ date: z.string(), quantity: z.number().int().nonnegative() })) }));
export function ToolResult({ entry }: { entry: AssistantResult['data'][number] }) {
  if (entry.tool === 'getAvailableBudget') {
    const parsed = budgetSnapshotSchema.safeParse(entry.result);
    if (parsed.success) return <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Allocated</dt><dd>{money(parsed.data.allocatedPaise)}</dd><dt>Reserved</dt><dd>{money(parsed.data.reservedPaise)}</dd><dt>Available</dt><dd className="font-semibold">{money(parsed.data.availablePaise)}</dd></dl>;
  }
  if (entry.tool === 'getInventoryRisks') {
    const parsed = z.array(riskRowSchema).safeParse(entry.result);
    if (parsed.success) return <details open><summary className="text-sm font-semibold">Inventory findings ({parsed.data.length})</summary><div className="mt-3 max-h-80 space-y-3 overflow-auto">{parsed.data.map((row) => <div className="rounded border p-3 text-xs" key={row.productId}><div className="flex flex-wrap justify-between gap-2"><strong>{row.name} · {row.sku}</strong><StatusBadge status={row.riskLevel} /></div><p className="mt-2">Stock: {row.stock} · Average daily sales: {row.averageDailySales.toFixed(2)}</p><p>Until stockout: {stockoutDays(row.estimatedDaysUntilStockout)} · Recommended quantity: {row.recommendedQuantity}</p>{row.hasPendingReplenishment && <p>Replenishment already pending.</p>}</div>)}</div></details>;
  }
  if (entry.tool === 'getStockLevels') {
    const parsed = stocks.safeParse(entry.result);
    if (parsed.success) return <div className="max-h-80 space-y-2 overflow-auto text-sm">{parsed.data.map((row) => <p key={row.productId}>{row.name} · {row.sku}: <strong>{row.stock}</strong></p>)}</div>;
  }
  if (entry.tool === 'getSalesHistory') {
    const parsed = sales.safeParse(entry.result);
    if (parsed.success) return <div className="space-y-3 text-sm">{parsed.data.map((row) => <details key={row.productId}><summary>Sales: {row.totalSold} units · Daily average: {row.averageDailySales.toFixed(2)}</summary><p className="break-all text-xs">Product: {row.productId} · {row.windowStart} to {row.windowEnd}</p><ul className="mt-2 max-h-48 overflow-auto text-xs">{row.days.map((day) => <li key={day.date}>{day.date}: {day.quantity}</li>)}</ul></details>)}</div>;
  }
  if (entry.tool === 'getSupplierQuotes') {
    const parsed = z.array(supplierComparisonSchema).safeParse(entry.result);
    if (parsed.success) return <details><summary className="text-sm font-semibold">Supplier comparisons ({parsed.data.length})</summary><div className="mt-3 max-h-80 space-y-3 overflow-auto">{parsed.data.map((row) => <div key={row.productId} className="space-y-2 rounded border p-3 text-xs"><p className="break-all">Product: {row.productId} · Quantity: {row.quantity ?? 'Required'}</p>{row.quotes.map((quote) => <p key={quote.quoteId}>{quote.supplierName}{quote.quoteId === row.selectedQuoteId ? ' · Selected' : ''} · {money(quote.unitPricePaise)}/unit · {quote.leadTimeDays} days · Total: {quote.lineTotalPaise === null ? 'Quantity required' : money(quote.lineTotalPaise)}</p>)}{row.lateDeliveryRisk && <p className="text-amber-800">Delivery may arrive after stockout.</p>}{row.affordability?.overBudget && <p className="text-amber-800">Over budget by {money(row.affordability.shortfallPaise)}.</p>}</div>)}</div></details>;
  }
  if (entry.tool === 'createPurchaseProposal') {
    const parsed = draftBatchSchema.safeParse(entry.result);
    if (parsed.success) return <div className="space-y-2 text-sm"><p>Draft batch total: <strong>{money(parsed.data.batchTotalPaise)}</strong></p>{parsed.data.affordability.overBudget && <p className="text-amber-800">Over budget by {money(parsed.data.affordability.shortfallPaise)}. Manager approval requires sufficient funds.</p>}{parsed.data.exclusions.map((row) => <p className="break-all text-xs" key={row.productId}>{row.productId}: {row.reason}</p>)}{parsed.data.warnings.map((row, i) => <p className="break-all text-xs text-amber-800" key={i}>{row.productId}: {row.code}</p>)}</div>;
  }
  return <p className="text-xs text-muted-foreground">Some structured findings could not be displayed. Consult the inventory or proposal screens.</p>;
}
