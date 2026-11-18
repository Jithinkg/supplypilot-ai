import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ApiError } from '@/lib/api';

export const selectClass = 'h-10 rounded-md border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
export const tableClass = 'w-full min-w-[640px] text-left text-sm [&_th]:px-5 [&_th]:py-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-muted-foreground [&_td]:px-5 [&_td]:py-4 [&_tbody_tr]:border-t [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-muted/40';
export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = { DRAFT: 'bg-amber-50 text-amber-800', APPROVED: 'bg-emerald-50 text-emerald-800', REJECTED: 'bg-slate-100 text-slate-600', CRITICAL: 'bg-rose-50 text-rose-800', HIGH: 'bg-amber-50 text-amber-800', LOW: 'bg-emerald-50 text-emerald-800' };
  return <Badge className={styles[status] ?? 'bg-muted'}>{status}</Badge>;
}
export function Notice({ children, warning = false }: { children: React.ReactNode; warning?: boolean }) {
  return <div role={warning ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${warning ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-teal-100 bg-teal-50 text-teal-900'}`}>{children}</div>;
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><div className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><div>{error instanceof Error ? error.message : 'Unable to load this section.'}{error instanceof ApiError && error.requestId && <p className="mt-1 text-xs">Reference: {error.requestId}</p>}</div></div>{retry && <Button variant="outline" size="sm" onClick={retry}><RefreshCw className="size-3" />Retry</Button>}</div>;
}
export function Loading({ label = 'Loading…' }: { label?: string }) { return <div role="status" className="animate-pulse px-5 py-8 text-sm text-muted-foreground">{label}</div>; }
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-xs text-muted-foreground"><span>{total} results · Page {page}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>Next</Button></div></div>;
}
