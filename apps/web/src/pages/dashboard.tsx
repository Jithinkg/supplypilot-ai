import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Package2, Plus, RefreshCw, Wallet, ClipboardList } from 'lucide-react';
import type { RiskRow } from '@supplypilot/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNotice, Loading, Pagination, selectClass, StatusBadge, tableClass } from '@/components/common';
import { useDashboard, useInventory } from '@/features/queries';
import { CreateProposalDialog } from '@/features/proposals/create-dialog';
import { AssistantPanel } from '@/features/assistant/panel';
import { ProposalTable } from '@/features/proposals/summary-table';
import { dateTime, money, pageNumber, stockoutDays } from '@/lib/format';

export function DashboardPage() {
  const dashboard = useDashboard();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const risk = ['HIGH', 'LOW', 'CRITICAL'].includes(params.get('risk') ?? '') ? params.get('risk') ?? '' : '';
  const page = pageNumber(params.get('page'));
  const inventory = useInventory({ search, risk, page, pageSize: 10 });
  const [selected, setSelected] = useState<RiskRow[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [initial, setInitial] = useState<RiskRow[]>([]);
  function filter(key: string, value: string) { setParams((current) => { const next = new URLSearchParams(current); value ? next.set(key, value) : next.delete(key); if (key !== 'page') next.delete('page'); return next; }); }
  function openCreate(rows: RiskRow[] = []) { setInitial(rows); setCreateOpen(true); }
  function toggle(row: RiskRow) { setSelected((current) => current.some((item) => item.productId === row.productId) ? current.filter((item) => item.productId !== row.productId) : [...current, row]); }
  const data = dashboard.data;
  return <main className="mx-auto max-w-[1600px] space-y-7 px-5 py-8 md:px-8">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Operations overview</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Dashboard</h1><p className="mt-2 text-sm text-muted-foreground">Know what needs attention. Keep procurement moving.</p></div><div className="flex gap-2"><Button variant="outline" aria-label="Refresh dashboard" disabled={dashboard.isFetching || inventory.isFetching} onClick={() => { void dashboard.refetch(); void inventory.refetch(); }}><RefreshCw className="size-4" /></Button><Button onClick={() => openCreate()}><Plus className="size-4" />Create proposal</Button></div></div>
    {dashboard.error && <ErrorNotice error={dashboard.error} retry={() => void dashboard.refetch()} />}
    {dashboard.isPending && <Loading label="Loading dashboard…" />}
    {data && <><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: 'Total Products', value: data.totalProducts, note: 'Across your inventory', icon: Package2, style: 'text-primary bg-teal-50' },
        { label: 'At Risk (Next 14 Days)', value: data.atRiskNext14Days, note: 'Critical and high risk', icon: AlertTriangle, style: 'text-amber-700 bg-amber-50' },
        { label: 'Pending Proposals', value: data.pendingProposals, note: 'Drafts awaiting a decision', icon: ClipboardList, style: 'text-indigo-700 bg-indigo-50' },
        { label: 'Available Budget', value: money(data.availableBudgetPaise), note: 'After approved reservations', icon: Wallet, style: 'text-primary bg-teal-50' },
      ].map(({ label, value, note, icon: Icon, style }) => <Card key={label} className="p-5"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{label}</p><span className={`rounded-lg p-2 ${style}`}><Icon className="size-4" aria-hidden /></span></div><p className="mt-3 text-2xl font-semibold tracking-tight" data-testid={`kpi-${label}`}>{value}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></Card>)}
    </div></>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="min-w-0"><CardHeader><div><CardTitle>Inventory risk</CardTitle><p className="mt-1 text-xs text-muted-foreground">Demand based on the previous 30 completed UTC days.</p></div><span className="rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800">Stockout Within 7 Days: {data?.stockoutWithin7Days ?? '—'}</span></CardHeader>
        <div className="flex flex-wrap gap-3 px-5 py-4"><Input aria-label="Search inventory" placeholder="Search products or SKU" className="max-w-xs" value={search} onChange={(event) => filter('search', event.target.value)} /><select aria-label="Filter inventory risk" className={selectClass} value={risk} onChange={(event) => filter('risk', event.target.value)}><option value="">All risk levels</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="LOW">Low</option></select></div>
        {selected.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-y bg-teal-50 px-5 py-3 text-sm"><span>{selected.length} products selected</span><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button><Button size="sm" onClick={() => openCreate(selected)}>Create from selection</Button></div></div>}
        {inventory.isPending && <Loading label="Loading inventory…" />}
        {inventory.error && <div className="px-5 pb-4"><ErrorNotice error={inventory.error} retry={() => void inventory.refetch()} /></div>}
        {inventory.data && <>{inventory.data.items.length ? <div className="overflow-x-auto"><table className={tableClass}><thead className="bg-muted/40"><tr><th><span className="sr-only">Select</span></th><th>Product</th><th>Stock</th><th>Avg. daily sales</th><th>Until stockout</th><th>Risk</th></tr></thead><tbody>{inventory.data.items.map((row) => <tr key={row.productId}><td><input type="checkbox" className="size-4 accent-primary" aria-label={`Select inventory ${row.sku}`} checked={selected.some((item) => item.productId === row.productId)} onChange={() => toggle(row)} /></td><td><p className="whitespace-nowrap font-medium">{row.name}</p><p className="mt-1 text-xs text-muted-foreground">{row.sku}{row.hasPendingReplenishment ? ' · Replenishment pending' : ''}</p></td><td>{row.stock}</td><td>{row.averageDailySales.toFixed(2)}</td><td className="whitespace-nowrap" title={row.estimatedDaysUntilStockout === null ? 'No recent demand' : String(row.estimatedDaysUntilStockout)}>{stockoutDays(row.estimatedDaysUntilStockout)}</td><td><StatusBadge status={row.riskLevel} /></td></tr>)}</tbody></table></div> : <p className="px-5 py-10 text-center text-sm text-muted-foreground">No products match your filters.</p>}<Pagination page={page} pageSize={10} total={inventory.data.total} onPage={(value) => filter('page', String(value))} /><p className="border-t px-5 py-3 text-[11px] text-muted-foreground">Sales window: {inventory.data.windowStart} to {inventory.data.windowEnd} · Risk levels use unrounded estimates.</p></>}
      </Card>
      <div className="space-y-5"><Card><CardHeader><CardTitle>Procurement overview</CardTitle></CardHeader>{data ? <div className="space-y-5 p-5"><div className="space-y-3">{(['DRAFT', 'APPROVED', 'REJECTED'] as const).map((status) => <div key={status} className="flex items-center justify-between"><StatusBadge status={status} /><span className="text-sm font-semibold">{data.proposalCounts[status]}</span></div>)}</div><div className="space-y-3 border-t pt-4 text-xs"><div className="flex justify-between"><span className="text-muted-foreground">Allocated</span><span>{money(data.budget.allocatedPaise)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Reserved</span><span>{money(data.budget.reservedPaise)}</span></div><div className="flex justify-between font-semibold text-primary"><span>Available</span><span>{money(data.budget.availablePaise)}</span></div></div><p className="text-[11px] leading-relaxed text-muted-foreground">Approved proposals reserve funds. They do not place supplier orders.</p></div> : <Loading label="Loading overview…" />}</Card>
      <AssistantPanel selected={selected} /></div>
    </div>
    <Card><CardHeader><div><CardTitle>Recent proposals</CardTitle><p className="mt-1 text-xs text-muted-foreground">The latest five purchase proposals.</p></div><Button asChild variant="ghost" size="sm"><Link to="/proposals">View all<ArrowUpRight className="size-4" /></Link></Button></CardHeader>{data ? <ProposalTable items={data.recentProposals} /> : dashboard.error ? <p className="p-5 text-sm text-muted-foreground">Recent proposals are unavailable. Retry the dashboard request above.</p> : <Loading />}</Card>
    {data && <p className="text-xs text-muted-foreground">Last updated {dateTime(data.asOf)}</p>}
    {createOpen && <CreateProposalDialog initial={initial} onClose={() => { setCreateOpen(false); setSelected([]); }} />}
  </main>;
}
