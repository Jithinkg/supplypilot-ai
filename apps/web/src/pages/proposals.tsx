import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorNotice, Loading, Pagination, selectClass } from '@/components/common';
import { useProposals } from '@/features/queries';
import { ProposalTable } from '@/features/proposals/summary-table';
import { CreateProposalDialog } from '@/features/proposals/create-dialog';
import { pageNumber } from '@/lib/format';

export function ProposalsPage() {
  const [params, setParams] = useSearchParams();
  const page = pageNumber(params.get('page'));
  const status = ['DRAFT', 'APPROVED', 'REJECTED'].includes(params.get('status') ?? '') ? params.get('status') ?? '' : '';
  const proposals = useProposals({ status, page, pageSize: 10 });
  const [createOpen, setCreateOpen] = useState(false);
  function update(key: string, value: string) { setParams((current) => { const next = new URLSearchParams(current); value ? next.set(key, value) : next.delete(key); if (key !== 'page') next.delete('page'); return next; }); }
  return <main className="mx-auto max-w-[1600px] space-y-7 px-5 py-8 md:px-8"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Purchase planning</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Proposals</h1><p className="mt-2 text-sm text-muted-foreground">Review supplier-grouped purchases and track decisions.</p></div><Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />Create proposal</Button></div>
    <Card><CardHeader><CardTitle>Purchase proposals</CardTitle><div className="flex gap-2"><select className={selectClass} aria-label="Filter proposal status" value={status} onChange={(event) => update('status', event.target.value)}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select><Button aria-label="Refresh proposals" variant="outline" disabled={proposals.isFetching} onClick={() => void proposals.refetch()}><RefreshCw className="size-4" /></Button></div></CardHeader>
      {proposals.isPending && <Loading label="Loading proposals…" />}{proposals.error && <div className="p-5"><ErrorNotice error={proposals.error} retry={() => void proposals.refetch()} /></div>}{proposals.data && <><ProposalTable items={proposals.data.items} /><Pagination page={page} pageSize={10} total={proposals.data.total} onPage={(value) => update('page', String(value))} /></>}
    </Card>{createOpen && <CreateProposalDialog onClose={() => setCreateOpen(false)} />}
  </main>;
}
