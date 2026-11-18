import { useMutation } from '@tanstack/react-query';
import type { KnowledgeResult, Citation } from '@supplypilot/contracts';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/common';
import { api } from '@/lib/api';
import { useAccount } from '@/features/queries';
export function documentFileUrl(id: string, supplierId?: string) {
  return `/api/knowledge/documents/${encodeURIComponent(id)}/file${supplierId ? `?supplierId=${encodeURIComponent(supplierId)}` : ''}`;
}
function CitationSource({ citation, supplierId, index }: { citation: Citation; supplierId?: string | undefined; index: number }) {
  const { csrfToken } = useAccount();
  const resolve = useMutation({ mutationFn: () => api.citation(citation, csrfToken, supplierId) });
  return <div className="space-y-2 rounded-lg border p-3">
    <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => { resolve.reset(); resolve.mutate(); }}>{resolve.isPending ? 'Checking source access…' : `View source ${index + 1} · page ${citation.pageNumber}`}</Button>
    {resolve.error && <ErrorNotice error={resolve.error} />}
    {resolve.data && <><blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary pl-3 text-xs leading-relaxed">{resolve.data.supportingText}</blockquote><a className="text-xs text-primary underline" href={documentFileUrl(citation.documentId, supplierId)} target="_blank" rel="noreferrer">Download source PDF · page {citation.pageNumber}</a></>}
  </div>;
}
export function Evidence({ result }: { result: KnowledgeResult }) {
  const { user } = useAccount();
  if (result.scope?.type === 'SUPPLIER_CONTRACT' && (user.role !== 'MANAGER' || !result.scope.supplierId)) return null;
  // Older or malformed scope-less evidence cannot safely identify contract access.
  if (!result.scope && result.citations.length) return <p className="text-sm">Source scope is unavailable. Request a fresh review.</p>;
  return <div className="space-y-3 rounded-lg bg-muted/40 p-4">
    <h4 className="text-sm font-semibold">{result.scope?.type === 'SUPPLIER_CONTRACT' ? 'Supplier contract guidance' : 'Policy guidance'} · Advisory</h4>
    {result.scope?.supplierId && <p className="break-all text-xs text-muted-foreground">Supplier: {result.scope.supplierId}</p>}
    <p className="text-xs font-medium">{result.outcome === 'EVIDENCE_FOUND' ? 'Supporting evidence found' : result.outcome === 'INSUFFICIENT_EVIDENCE' ? 'Insufficient evidence' : 'Retrieval unavailable'}</p>
    <p className="whitespace-pre-wrap break-words text-sm">{result.findings}</p>
    <p className="text-xs text-muted-foreground">Guidance only. This is not compliance approval.</p>
    {result.citations.map((citation, index) => <CitationSource key={`${citation.chunkId}-${index}`} citation={citation} index={index} supplierId={result.scope?.supplierId ?? undefined} />)}
  </div>;
}
