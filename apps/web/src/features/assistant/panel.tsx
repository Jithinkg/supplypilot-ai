import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assistantInputSchema, type AssistantResult, type RiskRow } from '@supplypilot/contracts';
import { Sparkles } from 'lucide-react';
import { z } from 'zod';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorNotice, Notice, selectClass } from '@/components/common';
import { useAccount } from '@/features/queries';
import { api } from '@/lib/api';
import { refreshProcurement } from '@/app/query-client';
import { readPendingAssistant, savePendingAssistant, clearPendingAssistant, type PendingAssistant } from './pending';
import { Evidence } from './evidence';
import { ToolResult } from './tool-results';
import { assistantFailureMessage } from './errors';
interface Turn { message: string; result: AssistantResult }
export function AssistantPanel({ selected }: { selected: RiskRow[] }) {
  const { user, csrfToken } = useAccount();
  return <AssistantSession key={`${user.id}-${user.role}-${csrfToken}`} selected={selected} />;
}
function AssistantSession({ selected }: { selected: RiskRow[] }) {
  const { user, csrfToken } = useAccount();
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const [allowDraft, setAllowDraft] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(() => readPendingAssistant(user.id));
  const [turns, setTurns] = useState<Turn[]>([]);
  const [formError, setFormError] = useState('');
  const [activeResult, setActiveResult] = useState<AssistantResult | null>(null);
  const suppliers = useQuery({ queryKey: ['knowledge', user.id, user.role, 'suppliers'], queryFn: ({ signal }) => api.knowledgeSuppliers(signal), enabled: user.role === 'MANAGER' });
  const recovery = useQuery({ queryKey: ['assistant', user.id, user.role, pending?.runId], queryFn: ({ signal }) => api.assistantRun(pending?.runId ?? '', signal), enabled: Boolean(pending?.runId), retry: false,
    refetchOnWindowFocus: true, refetchInterval: (query) => query.state.error ? false : query.state.data?.status === 'RUNNING' ? 2000 : false });
  function accept(result: AssistantResult, request: PendingAssistant) {
    setActiveResult(result);
    if (result.status === 'RUNNING') {
      const saved = { ...request, runId: result.runId };
      try { savePendingAssistant(saved); } catch { setFormError('Unable to update recovery storage. The original saved key can still recover this request.'); }
      setPending(saved); return;
    }
    try { clearPendingAssistant(user.id); } catch { setFormError('Could not clear recovery storage. A reload may show this completed request again; recovering it will not create another draft.'); }
    setPending(null); setTurns((current) => [...current, { message: request.input.message, result }]);
    if (result.createdProposalIds.length) void refreshProcurement(client);
  }
  useEffect(() => { if (recovery.data && pending && recovery.data.runId === pending.runId && recovery.data !== activeResult) accept(recovery.data, pending); });
  const send = useMutation({ mutationFn: (request: PendingAssistant) => api.assistant(request.input, csrfToken, request.key), onSuccess: (data, request) => accept(data, request) });
  function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    if (pending || send.isPending) return;
    const parsed = assistantInputSchema.safeParse({ message, mode: allowDraft ? 'CREATE_DRAFT' : 'READ_ONLY',
      ...(selected.length ? { items: selected.map((row) => ({ productId: row.productId, ...(quantities[row.productId]?.trim() ? { quantity: Number(quantities[row.productId]) } : {}) })) } : {}),
      ...(user.role === 'MANAGER' && supplierId.trim() ? { supplierId: supplierId.trim() } : {}) });
    if (!parsed.success || (supplierId.trim() && !z.uuid().safeParse(supplierId.trim()).success)) { setFormError('Enter a question, a valid supplier ID if supplied, and positive whole quantities for selected products.'); return; }
    const saved: PendingAssistant = { userId: user.id, role: user.role, key: crypto.randomUUID(), input: parsed.data };
    try { savePendingAssistant(saved); } catch { setFormError('Enable session storage to save a recovery key before submitting.'); return; }
    setPending(saved); setActiveResult(null); setMessage(''); setAllowDraft(false); send.mutate(saved);
  }
  const busy = send.isPending || Boolean(pending?.runId && recovery.isFetching);
  return <Card aria-label="AI assistant" className="min-w-0">
    <CardHeader><div><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden />AI assistant</CardTitle><p className="mt-2 text-xs text-muted-foreground">Explore inventory, suppliers, budgets and policy guidance.</p></div></CardHeader>
    <div className="space-y-5 p-5">
      <p className="text-xs text-muted-foreground">Read-only by default. AI can create drafts with your permission; managers make approval decisions. Questions are independent; prior answers are not sent as conversation context.</p>
      {turns.length > 0 && <div role="log" aria-label="Assistant conversation" className="max-h-[650px] space-y-5 overflow-y-auto">{turns.map((turn) => <article key={turn.result.runId} className="space-y-3 border-b pb-5"><p className="whitespace-pre-wrap break-words rounded-lg bg-secondary p-3 text-sm"><strong>You: </strong>{turn.message}</p><p className="text-xs font-semibold">{turn.result.status === 'FAILED' ? 'Request failed' : 'Assistant'}</p><p className="whitespace-pre-wrap break-words text-sm">{turn.result.answer}</p>{turn.result.errorCode && <div className="space-y-2 text-xs text-destructive"><p>{assistantFailureMessage(turn.result.errorCode)}</p><details><summary>Technical details</summary><p>Error: {turn.result.errorCode}</p></details></div>}{turn.result.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-800">{warning}</p>)}{turn.result.data.map((entry, index) => <ToolResult key={index} entry={entry} />)}{turn.result.knowledge.map((result, index) => <Evidence key={index} result={result} />)}{turn.result.createdProposalIds.map((id, index) => <Link key={id} className="block rounded-lg border p-3 text-sm font-medium text-primary underline" to={`/proposals/${id}`}>Open draft proposal {index + 1}</Link>)}</article>)}</div>}
      {pending ? <div className="space-y-3">
        <Notice warning>{busy || activeResult?.status === 'RUNNING' ? 'Processing your saved request. This can take up to a minute.' : 'A request is awaiting a confirmed result. Recover it before starting another request.'}</Notice>
        {pending.role === user.role && <p className="whitespace-pre-wrap break-words text-sm">{pending.input.message}</p>}
        <p className="text-xs">Saved mode: {pending.input.mode === 'CREATE_DRAFT' ? 'Draft creation allowed' : 'Read-only'}</p>
        {pending.role !== user.role && <p className="text-xs text-amber-800">Your role has changed. Recovery will recheck your current access.</p>}
        {send.error && <ErrorNotice error={send.error} />}{recovery.error && <ErrorNotice error={recovery.error} />}
        <Button variant="outline" disabled={busy} onClick={() => pending.runId ? void recovery.refetch() : send.mutate(pending)}>{busy ? 'Working…' : 'Recover saved request'}</Button>
        <Link className="block text-xs text-primary underline" to="/proposals">Inspect existing proposals</Link>
      </div> : <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-medium" htmlFor="assistant-question">Ask the assistant</label>
        <textarea id="assistant-question" required rows={3} maxLength={2000} className="w-full rounded-md border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Which products are at risk? What do our policies say?" value={message} onChange={(event) => setMessage(event.target.value)} />
        {selected.length > 0 && <div className="space-y-3 rounded-lg border p-3"><p className="text-xs font-semibold">Selected inventory products ({selected.length})</p>{selected.map((row) => <label key={row.productId} className="block text-xs">{row.name} · {row.sku}<Input className="mt-1" aria-label={`Assistant quantity for ${row.sku}`} type="number" min={1} max={2147483647} step={1} placeholder="Use backend recommendation" value={quantities[row.productId] ?? ''} onChange={(event) => setQuantities((current) => ({ ...current, [row.productId]: event.target.value }))} /></label>)}</div>}
        {user.role === 'MANAGER' && <label className="block text-xs font-medium">Supplier for contract questions (optional)<select className={`${selectClass} mt-2 w-full`} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">No supplier selected</option>{suppliers.data?.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select><span className="mt-1 block font-normal text-muted-foreground">Contract questions require a specific supplier.</span>{suppliers.error && <ErrorNotice error={suppliers.error} retry={() => void suppliers.refetch()} />}</label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={allowDraft} onChange={(event) => setAllowDraft(event.target.checked)} />Allow draft proposals</label>
        {allowDraft && <p className="text-xs text-amber-800">Submitting an explicit draft request may save proposals for manager review. It does not reserve funds or place orders.</p>}
        <Button type="submit" disabled={!message.trim()}>Send question</Button>
      </form>}
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
    </div>
  </Card>;
}
