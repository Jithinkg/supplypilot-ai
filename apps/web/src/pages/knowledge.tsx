import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { documentInputSchema, type DocumentMetadata, type KnowledgeSearch } from '@supplypilot/contracts';
import { useAccount } from '@/features/queries';
import { api } from '@/lib/api';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorNotice, Loading, Notice, Pagination, selectClass, StatusBadge } from '@/components/common';
import { dateTime } from '@/lib/format';
import { Evidence, documentFileUrl } from '@/features/assistant/evidence';
import { Dialog } from '@/components/ui/dialog';
type DocType = 'PROCUREMENT_POLICY' | 'SUPPLIER_CONTRACT';
export function KnowledgePage() {
  const { user, csrfToken } = useAccount();
  return <KnowledgeSession key={`${user.id}-${user.role}-${csrfToken}`} />;
}
function KnowledgeSession() {
  const { user } = useAccount();
  const [type, setType] = useState<DocType>('PROCUREMENT_POLICY');
  const [supplierId, setSupplierId] = useState('');
  const suppliers = useQuery({ queryKey: ['knowledge', user.id, user.role, 'suppliers'], queryFn: ({ signal }) => api.knowledgeSuppliers(signal), enabled: user.role === 'MANAGER' });
  return <main className="mx-auto max-w-[1400px] space-y-6 px-5 py-8 md:px-8">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Evidence library</p><h1 className="mt-2 text-3xl font-semibold">Knowledge</h1><p className="mt-2 text-sm text-muted-foreground">Search source documents for advisory guidance. Manual procurement remains available independently.</p></div>
    <div className="flex flex-wrap gap-4"><label className="text-sm font-medium">Document type<select className={`${selectClass} mt-2 block`} value={type} onChange={(event) => setType(event.target.value === 'SUPPLIER_CONTRACT' ? 'SUPPLIER_CONTRACT' : 'PROCUREMENT_POLICY')}><option value="PROCUREMENT_POLICY">Procurement policies</option>{user.role === 'MANAGER' && <option value="SUPPLIER_CONTRACT">Supplier contracts</option>}</select></label>
      {type === 'SUPPLIER_CONTRACT' && user.role === 'MANAGER' && <label className="min-w-0 text-sm font-medium">Supplier<select className={`${selectClass} mt-2 block max-w-full`} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Select a supplier</option>{suppliers.data?.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} · {supplier.name}</option>)}</select></label>}
    </div>
    {suppliers.error && user.role === 'MANAGER' && <ErrorNotice error={suppliers.error} retry={() => void suppliers.refetch()} />}
    {type === 'SUPPLIER_CONTRACT' && !z.uuid().safeParse(supplierId).success ? <Notice>Select a supplier to view or search its contracts.</Notice> : <KnowledgeScope key={`${type}-${supplierId}`} type={type} supplierId={type === 'SUPPLIER_CONTRACT' ? supplierId : undefined} />}
  </main>;
}
function KnowledgeScope({ type, supplierId }: { type: DocType; supplierId?: string | undefined }) {
  const { user, csrfToken } = useAccount();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<DocumentMetadata | null>(null);
  const list = useQuery({ queryKey: ['knowledge', user.id, user.role, type, supplierId, page], queryFn: ({ signal }) => api.documents({ type, ...(supplierId ? { supplierId } : {}), page }, signal), refetchInterval: (value) => value.state.data?.items.some((item) => item.status === 'QUEUED' || item.status === 'PROCESSING') ? 2000 : false });
  const search = useMutation({ mutationFn: (input: KnowledgeSearch) => api.searchKnowledge(input, csrfToken) });
  const action = useMutation({ mutationFn: ({ document, operation }: { document: DocumentMetadata; operation: 'retry' | 'archive' }) => api.documentAction(document.id, operation, csrfToken, supplierId),
    onSuccess: async () => { setConfirm(null); search.reset(); await client.invalidateQueries({ queryKey: ['knowledge'] }); } });
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>Search {type === 'SUPPLIER_CONTRACT' ? 'supplier contracts' : 'policies'}</CardTitle></CardHeader><div className="space-y-4 p-5"><form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); search.reset(); search.mutate({ query: query.trim(), type, ...(supplierId ? { supplierId } : {}) }); }}><Input aria-label="Search knowledge" maxLength={1000} required placeholder="e.g. How should delivery time affect supplier selection?" className="min-w-0 flex-1 basis-64" value={query} onChange={(event) => setQuery(event.target.value)} /><Button disabled={search.isPending || !query.trim()}>{search.isPending ? 'Searching…' : 'Search documents'}</Button></form>{search.error && <ErrorNotice error={search.error} />}{search.data && <Evidence result={search.data} />}</div></Card>
    {user.role === 'MANAGER' && <Upload type={type} supplierId={supplierId} onUploaded={() => { setPage(1); void client.invalidateQueries({ queryKey: ['knowledge'] }); }} />}
    <Card><CardHeader><CardTitle>Documents</CardTitle><Button variant="outline" size="sm" onClick={() => void list.refetch()} disabled={list.isFetching}>Refresh documents</Button></CardHeader>
      {list.isPending && <Loading label="Loading documents…" />}{list.error && <ErrorNotice error={list.error} retry={() => void list.refetch()} />}
      {list.data && <>{!list.data.items.length && <p className="p-5 text-sm text-muted-foreground">No documents in this scope.</p>}<div className="divide-y">{list.data.items.map((document) => <article key={document.id} className="space-y-3 p-5"><div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-medium">{document.title}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{document.originalFilename} · {document.pageCount ?? '—'} pages · {dateTime(document.updatedAt)}</p></div><StatusBadge status={document.status} /></div>{document.errorCode && <p className="text-xs text-destructive">Ingestion error: {document.errorCode}. Retry after addressing the source or service issue.</p>}<div className="flex flex-wrap gap-3">{document.status !== 'ARCHIVED' && <a className="text-sm text-primary underline" href={documentFileUrl(document.id, supplierId)} target="_blank" rel="noreferrer">Download PDF</a>}{user.role === 'MANAGER' && document.status === 'FAILED' && <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => { action.mutate({ document, operation: 'retry' }); }}>Retry ingestion</Button>}{user.role === 'MANAGER' && document.status !== 'ARCHIVED' && <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => { action.reset(); setConfirm(document); }}>Archive</Button>}</div></article>)}</div><Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /></>}
    </Card>
    {action.error && !confirm && <ErrorNotice error={action.error} />}
    {confirm && <Dialog open onOpenChange={(open) => { if (!open) setConfirm(null); }} title="Archive document?" description="Archiving removes this document from retrieval and prevents access through citations and downloads." locked={action.isPending}><p className="break-words text-sm">{confirm.title}</p>{action.error && <ErrorNotice error={action.error} />}<div className="mt-5 flex gap-3"><Button disabled={action.isPending} onClick={() => action.mutate({ document: confirm, operation: 'archive' })}>Confirm archive</Button><Button variant="outline" disabled={action.isPending} onClick={() => setConfirm(null)}>Cancel</Button></div></Dialog>}
  </div>;
}
function Upload({ type, supplierId, onUploaded }: { type: DocType; supplierId?: string | undefined; onUploaded: () => void }) {
  const { csrfToken } = useAccount();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({ mutationFn: ({ metadata, source }: { metadata: z.infer<typeof documentInputSchema>; source: File }) => api.uploadDocument(metadata, source, csrfToken), onSuccess: () => { setTitle(''); setFile(null); if (fileInput.current) fileInput.current.value = ''; onUploaded(); } });
  function submit(event: FormEvent) {
    event.preventDefault(); setError(''); upload.reset();
    const parsed = documentInputSchema.safeParse({ title, type, ...(supplierId ? { supplierId } : {}) });
    if (!parsed.success || !file || !file.name.toLowerCase().endsWith('.pdf') || file.size === 0 || file.size > 10 * 1024 * 1024) { setError('Enter a title and select one PDF of at most 10 MiB.'); return; }
    upload.mutate({ metadata: parsed.data, source: file });
  }
  return <Card><CardHeader><CardTitle>Upload {type === 'SUPPLIER_CONTRACT' ? 'supplier contract' : 'procurement policy'}</CardTitle></CardHeader><form onSubmit={submit} className="space-y-4 p-5"><p className="text-xs text-muted-foreground">English text-based PDFs only · Maximum 10 MiB / 50 pages · Scanned PDFs and OCR are not supported.</p><label className="block text-sm font-medium">Document title<Input required maxLength={200} className="mt-2" value={title} disabled={upload.isPending} onChange={(event) => setTitle(event.target.value)} /></label><label className="block text-sm font-medium">PDF file<Input ref={fileInput} className="mt-2" type="file" accept=".pdf,application/pdf" required disabled={upload.isPending} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{upload.error && <ErrorNotice error={upload.error} />}{upload.data && <Notice>Upload received. Current status: {upload.data.status}. The document list updates while ingestion is queued or processing.</Notice>}<Button disabled={upload.isPending}>{upload.isPending ? 'Uploading…' : 'Upload PDF'}</Button></form></Card>;
}
