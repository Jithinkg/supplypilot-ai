import { Link } from 'react-router-dom';
import type { ProposalSummary } from '@supplypilot/contracts';
import { ArrowUpRight } from 'lucide-react';
import { StatusBadge, tableClass } from '@/components/common';
import { money, dateTime } from '@/lib/format';

export function ProposalTable({ items }: { items: ProposalSummary[] }) {
  if (!items.length) return <p className="px-5 py-10 text-center text-sm text-muted-foreground">No proposals match this view. Create a draft to get started.</p>;
  return <div className="overflow-x-auto"><table className={tableClass}><thead className="bg-muted/40"><tr><th>Supplier / proposal</th><th>Status</th><th>Total</th><th>Created by</th><th>Created</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{items.map((proposal) => <tr key={proposal.id}>
    <td><Link className="font-medium text-primary hover:underline" to={`/proposals/${proposal.id}`}>{proposal.supplier.name}</Link><p className="mt-1 font-mono text-[11px] text-muted-foreground">{proposal.id.slice(0, 8)}</p></td>
    <td><StatusBadge status={proposal.status} /></td><td className="whitespace-nowrap font-medium">{money(proposal.totalPaise)}{proposal.affordability?.overBudget && <p className="mt-1 text-xs font-normal text-amber-800">Over budget</p>}</td>
    <td className="text-xs text-muted-foreground">{proposal.creator.email}</td><td className="whitespace-nowrap text-xs text-muted-foreground">{dateTime(proposal.createdAt)}</td>
    <td><Link aria-label={`Review proposal ${proposal.id.slice(0, 8)}`} to={`/proposals/${proposal.id}`} className="inline-flex rounded-md p-2 text-primary hover:bg-secondary"><ArrowUpRight className="size-4" /></Link></td>
  </tr>)}</tbody></table></div>;
}
