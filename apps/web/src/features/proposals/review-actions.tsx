import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ProposalDetail } from '@supplypilot/contracts';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Notice } from '@/components/common';
import { useAccount } from '@/features/queries';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { refreshProcurement } from '@/app/query-client';

export function ReviewActions({ proposal }: { proposal: ProposalDetail }) {
  const { user, csrfToken } = useAccount();
  const client = useQueryClient();
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const decision = useMutation({ mutationFn: (choice: 'approve' | 'reject') => choice === 'approve' ? api.approve(proposal.id, csrfToken) : api.reject(proposal.id, reason.trim(), csrfToken),
    onSuccess: async (data) => { client.setQueryData(['business', user.id, 'proposal', proposal.id], data); setAction(null); setNotice(data.status === 'APPROVED' ? 'Proposal approved. Budget has been reserved; no supplier order was placed.' : 'Proposal rejected. No funds were reserved.'); await refreshProcurement(client); },
    onError: async (error) => { if (error instanceof ApiError && [403, 409].includes(error.status)) await refreshProcurement(client); },
  });
  const manager = user.role === 'MANAGER';
  const draft = proposal.status === 'DRAFT';
  return <div className="space-y-4">
    {notice && <Notice>{notice}</Notice>}
    {decision.error && !action && <ErrorNotice error={decision.error} />}
    {draft && proposal.affordability?.overBudget && <Notice warning>Insufficient available funds. This proposal exceeds the budget by {money(proposal.affordability.shortfallPaise)}. Approval is blocked until sufficient funds are available.</Notice>}
    {draft && manager ? <><div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5"><div><h2 className="text-sm font-semibold">Manager decision</h2><p className="mt-1 text-xs text-muted-foreground">Approval reserves funds only. No supplier order is placed.</p></div><div className="flex gap-3"><Button variant="outline" onClick={() => { decision.reset(); setValidation(''); setReason(''); setAction('reject'); }} disabled={decision.isPending}><X className="size-4" />Reject</Button><Button onClick={() => { decision.reset(); setValidation(''); setAction('approve'); }} disabled={decision.isPending || proposal.affordability?.overBudget}><Check className="size-4" />Approve</Button></div></div></> : draft ? <Notice>A manager must review this proposal. Your account can view details and create drafts.</Notice> : null}
    <AlertDialog.Root open={action !== null} onOpenChange={(open) => { if (!open && !decision.isPending) setAction(null); }}><AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[2px]" /><AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-2xl focus:outline-none">
      <AlertDialog.Title className="text-xl font-semibold">{action === 'approve' ? 'Approve proposal?' : 'Reject proposal?'}</AlertDialog.Title><AlertDialog.Description className="mt-3 text-sm leading-relaxed text-muted-foreground">{action === 'approve' ? `This will reserve ${money(proposal.totalPaise)} for ${proposal.supplier.name}. It does not place a supplier order. The server will check current funds again.` : 'Explain why this purchase is not needed. Your decision and reason will be recorded.'}</AlertDialog.Description>
      {action === 'reject' && <div className="mt-5"><label htmlFor="rejection-reason" className="mb-2 block text-sm font-medium">Rejection reason</label><textarea id="rejection-reason" rows={3} maxLength={1000} className="w-full rounded-md border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" value={reason} onChange={(event) => setReason(event.target.value)} disabled={decision.isPending} /></div>}
      {validation && <p role="alert" className="mt-3 text-sm text-destructive">{validation}</p>}{decision.error && <div className="mt-4"><ErrorNotice error={decision.error} /></div>}
      {decision.error instanceof ApiError && decision.error.status === 409 && <p className="mt-3 text-xs text-muted-foreground">Current proposal and budget data have been refreshed. Close this dialog and review the latest state before deciding again.</p>}
      <div className="mt-6 flex justify-end gap-3"><AlertDialog.Cancel asChild><Button variant="outline" disabled={decision.isPending}>Cancel</Button></AlertDialog.Cancel><Button disabled={decision.isPending || !draft || (decision.error instanceof ApiError && decision.error.status === 409) || (action === 'approve' && proposal.affordability?.overBudget === true)} onClick={() => { if (!action) return; if (action === 'reject' && !reason.trim()) { setValidation('Enter a rejection reason.'); return; } decision.mutate(action); }}>{decision.isPending ? 'Saving decision…' : action === 'approve' ? 'Confirm approval' : 'Confirm rejection'}</Button></div>
    </AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
  </div>;
}
