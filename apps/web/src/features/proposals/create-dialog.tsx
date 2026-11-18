import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { createProposalSchema, positiveQuantitySchema, type DraftBatch, type RiskRow } from '@supplypilot/contracts';
import { Plus, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Loading, Notice, Pagination, StatusBadge } from '@/components/common';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { refreshProcurement } from '@/app/query-client';
import { useAccount, useInventory } from '@/features/queries';
import { clearPendingDraft, readPendingDraft, savePendingDraft, type PendingDraft } from './pending-draft';

interface Selection { product: RiskRow; quantity: string }
export function CreateProposalDialog({ initial = [], onClose }: { initial?: RiskRow[]; onClose: () => void }) {
  const { user, csrfToken } = useAccount();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Selection[]>(initial.map((product) => ({ product, quantity: '' })));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState<PendingDraft | null>(() => readPendingDraft(user.id));
  const [result, setResult] = useState<DraftBatch | null>(null);
  const products = useInventory({ search, page, pageSize: 8 });
  const quantity = (value: string) => value.trim() === '' ? undefined : Number(value);
  const validQuantity = (value: string) => value.trim() === '' || positiveQuantitySchema.safeParse(Number(value)).success;
  const previews = useQueries({ queries: selected.map((item) => ({
    queryKey: ['business', user.id, 'quotes', item.product.productId, item.quantity],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.quotes(item.product.productId, quantity(item.quantity), signal),
    enabled: !pending && !result && validQuantity(item.quantity),
  })) });
  const create = useMutation({ mutationFn: (request: PendingDraft) => api.create(request.input, csrfToken, request.key),
    onSuccess: async (data) => {
      clearPendingDraft(user.id); setPending(null); setResult(data);
      await refreshProcurement(client);
    },
    onError: (error) => {
      // These server rejections occur before any draft is committed. Uncertain
      // outcomes retain the exact request/key for explicit recovery instead.
      if (error instanceof ApiError && ['VALIDATION_ERROR', 'QUANTITY_REQUIRED', 'PRODUCT_NOT_FOUND', 'NO_SUPPLIER_QUOTES'].includes(error.code)) {
        clearPendingDraft(user.id); setPending(null);
      }
    },
  });
  function toggle(product: RiskRow) {
    setSelected((current) => current.some((item) => item.product.productId === product.productId)
      ? current.filter((item) => item.product.productId !== product.productId)
      : current.length < 50 ? [...current, { product, quantity: '' }] : current);
  }
  function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    const input = createProposalSchema.safeParse({ items: selected.map((item) => ({ productId: item.product.productId, ...(quantity(item.quantity) === undefined ? {} : { quantity: quantity(item.quantity) }) })), reason });
    if (!input.success) { setFormError('Select at least one product, use positive whole quantities, and enter a purchase reason.'); return; }
    if (previews.some((preview) => preview.data?.quantityRequired && preview.data.exclusionReason === 'NO_RECENT_DEMAND')) { setFormError('Enter an explicit quantity for products with no recent demand.'); return; }
    const request: PendingDraft = { userId: user.id, key: crypto.randomUUID(), input: input.data };
    try { savePendingDraft(request); } catch { setFormError('Unable to save the retry key. Enable session storage before submitting.'); return; }
    setPending(request); create.mutate(request);
  }
  const busy = create.isPending;
  const unavailablePreview = previews.some((preview) => preview.isPending || preview.isFetching || preview.isError);
  const productName = (id: string) => selected.find((item) => item.product.productId === id)?.product.name ?? products.data?.items.find((item) => item.productId === id)?.name ?? id;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }} title={result ? 'Proposal request complete' : pending ? 'Recover pending request' : 'Create purchase proposals'} description="Select products and quantities. Suppliers are selected automatically by delivery time and price. Each supplier receives a separate draft for manager review." wide locked={busy}>
    {result ? <div className="space-y-4">
      <Notice>{result.proposals.length ? `${result.proposals.length} proposal(s) confirmed. Open each proposal for its current status. Creating drafts does not reserve funds.` : 'No new proposals were created. Review the exclusions below.'}</Notice>
      {result.affordability.overBudget && <Notice warning>Combined request exceeds available funds by {money(result.affordability.shortfallPaise)}. Drafts are saved, but approval requires sufficient funds.</Notice>}
      <div className="flex justify-between rounded-lg bg-muted p-4 text-sm"><span>Request total</span><strong>{money(result.batchTotalPaise)}</strong></div>
      {result.proposals.map((proposal) => <Link key={proposal.id} to={`/proposals/${proposal.id}`} onClick={onClose} className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted"><div><p className="font-medium">{proposal.supplier.name}</p><p className="mt-1 text-xs text-primary">View proposal →</p></div><span>{money(proposal.totalPaise)}</span></Link>)}
      {result.exclusions.map((item) => <p key={item.productId} className="text-sm text-muted-foreground">{productName(item.productId)}: {item.reason === 'EXISTING_PROPOSAL' ? 'already has draft or approved replenishment.' : 'already meets the recommended stock target.'}</p>)}
      {result.warnings.map((item) => <p key={`${item.productId}-${item.code}`} className="text-sm text-amber-800">{productName(item.productId)}: {item.code === 'LATE_DELIVERY' ? 'delivery may arrive after stockout.' : 'already has pending replenishment; explicit quantity was used.'}</p>)}
      <Button className="w-full" onClick={onClose}>Done</Button>
    </div> : pending ? <div className="space-y-4">
      <Notice warning>{busy ? 'Submitting your saved request. Please wait…' : 'A request is awaiting a confirmed result. Retry the saved request to recover its result without creating duplicate proposals.'}</Notice>
      <p className="text-sm">{pending.input.items.length} product(s) · {pending.input.reason}</p>
      {create.error && <ErrorNotice error={create.error} />}
      <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => create.mutate(pending)}>{busy ? 'Creating proposals…' : 'Retry saved request'}</Button><Button variant="outline" asChild><Link to="/proposals" onClick={onClose}>Inspect existing proposals</Link></Button></div>
    </div> : <form onSubmit={submit} className="space-y-5">
      <div><label htmlFor="product-search" className="mb-2 block text-sm font-medium">Find products</label><Input id="product-search" value={search} placeholder="Search product name or SKU" onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
      <div className="rounded-lg border">
        {products.isPending && <Loading label="Loading products…" />}
        {products.error && <ErrorNotice error={products.error} retry={() => void products.refetch()} />}
        {products.data && <>{!products.data.items.length && <p className="p-5 text-sm text-muted-foreground">No matching products.</p>}{products.data.items.map((product) => <label key={product.productId} className="flex cursor-pointer items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/40"><input type="checkbox" aria-label={`Select ${product.sku}`} checked={selected.some((item) => item.product.productId === product.productId)} onChange={() => toggle(product)} className="size-4 accent-primary" /><span className="min-w-0 flex-1 text-sm"><span className="font-medium">{product.name}</span><span className="ml-2 text-xs text-muted-foreground">{product.sku}</span></span><StatusBadge status={product.riskLevel} /></label>)}<Pagination page={page} pageSize={8} total={products.data.total} onPage={setPage} /></>}
      </div>
      {selected.length > 0 && <div className="space-y-3"><h3 className="text-sm font-semibold">Selected products ({selected.length})</h3>{selected.map((item, index) => {
        const preview = previews[index]; const data = preview?.data;
        const choice = data?.quotes.find((quote) => quote.quoteId === data.selectedQuoteId);
        return <div key={item.product.productId} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3"><div className="text-sm font-medium">{item.product.name}<span className="ml-2 text-xs text-muted-foreground">{item.product.sku}</span></div><button type="button" aria-label={`Remove ${item.product.sku}`} onClick={() => toggle(item.product)} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button></div>
          <label className="mt-3 block text-xs font-medium" htmlFor={`quantity-${item.product.productId}`}>Quantity for {item.product.sku} (optional)</label>
          <Input id={`quantity-${item.product.productId}`} className="mt-1 max-w-48" type="number" min={1} max={2_147_483_647} step={1} placeholder="Use recommendation" value={item.quantity} onChange={(event) => setSelected((current) => current.map((row) => row.product.productId === item.product.productId ? { ...row, quantity: event.target.value } : row))} />
          {!validQuantity(item.quantity) && <p className="mt-2 text-xs text-destructive">Enter a positive whole number.</p>}
          {preview?.isFetching && <p className="mt-2 text-xs text-muted-foreground">Comparing suppliers…</p>}
          {preview?.error && <div className="mt-2"><ErrorNotice error={preview.error} retry={() => void preview.refetch()} /></div>}
          {data && <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            {choice && <p>{choice.supplierName} · {data.quantity} units · {choice.leadTimeDays} days · <strong className="text-foreground">{choice.lineTotalPaise === null ? '—' : money(choice.lineTotalPaise)}</strong></p>}
            {choice && <p>{data.selectionReason === 'FASTEST_AVAILABLE' ? 'Fastest available delivery; no supplier can arrive before stockout.' : data.selectionReason === 'LOWEST_PRICE_NO_RECENT_DEMAND' ? 'Lowest price; no recent demand for a stockout estimate.' : 'Lowest price among suppliers arriving before stockout.'}</p>}
            {data.quantityRequired && <p className="text-amber-800">{data.exclusionReason === 'NO_RECENT_DEMAND' ? 'No recent demand. Enter a quantity to purchase.' : 'No automatic quantity. Enter one or this product may be excluded.'}</p>}
            {data.automaticReplenishmentExcluded && <p className="text-amber-800">{data.exclusionReason === 'EXISTING_PROPOSAL' ? 'Already has replenishment. Omit quantity to skip, or enter an explicit quantity.' : data.exclusionReason === 'TARGET_STOCK_MET' ? 'Recommended stock target is already met.' : 'An explicit purchase quantity is required.'}</p>}
            {data.lateDeliveryRisk && <p className="text-amber-800">Delivery may arrive after stockout.</p>}
            {data.affordability?.overBudget && <p className="text-amber-800">Exceeds available funds by {money(data.affordability.shortfallPaise)}. A draft can still be created.</p>}
          </div>}
        </div>;
      })}</div>}
      <div><label htmlFor="purchase-reason" className="mb-2 block text-sm font-medium">Purchase reason</label><textarea id="purchase-reason" required maxLength={1000} rows={3} className="w-full rounded-md border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why these products are needed" /></div>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      {create.error && <ErrorNotice error={create.error} />}
      <p className="text-xs text-muted-foreground">Creation saves drafts only. A manager must approve each proposal to reserve funds. No supplier order is placed.</p>
      <div className="flex justify-end gap-3 border-t pt-4"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!selected.length || selected.some((item) => !validQuantity(item.quantity)) || unavailablePreview}><Plus className="size-4" />Create drafts</Button></div>
    </form>}
  </Dialog>;
}
