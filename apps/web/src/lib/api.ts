import { authResponseSchema, healthSchema, dashboardSchema, riskListSchema, proposalListSchema, proposalDetailSchema, draftBatchSchema, supplierComparisonSchema, type CreateProposalInput } from '@supplypilot/contracts';
import { z } from 'zod';
import { assistantInputSchema, assistantResultSchema, citationSchema, documentInputSchema, documentMetadataSchema, documentListSchema, knowledgeQuerySchema, knowledgeSuppliersSchema, knowledgeSearchSchema, knowledgeResultSchema, type KnowledgeSearch, type AssistantInput, type Citation } from '@supplypilot/contracts';

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }) });
export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED', public requestId: string | undefined = undefined, public protectedRequest = true) { super(message); }
}
async function request(path: string, init: RequestInit = {}) {
  const protectedRequest = path !== '/auth/login' && path !== '/health';
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, credentials: 'include', headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Connection interrupted. Check your connection and try again.', 'NETWORK_ERROR', undefined, protectedRequest);
  }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(await response.json().catch(() => null));
    throw new ApiError(response.status, parsed.success ? parsed.data.error.message : 'Service unavailable. Please try again.', parsed.success ? parsed.data.error.code : 'REQUEST_FAILED', parsed.success ? parsed.data.error.requestId : undefined, protectedRequest);
  }
  if (response.status === 204) return undefined;
  try { return await response.json() as unknown; }
  catch { throw new ApiError(502, 'The response was interrupted. Please retry the same request.', 'INVALID_RESPONSE', undefined, protectedRequest); }
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(502, 'The server returned unexpected data. Please refresh or retry.', 'INVALID_RESPONSE');
  return result.data;
}
function get(path: string, signal?: AbortSignal) { return request(path, signal ? { signal } : {}); }
function params(input: Record<string, string | number | undefined>) {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') values.set(key, String(value));
  return values.size ? `?${values}` : '';
}
function mutation(body: unknown, csrfToken: string, key?: string): RequestInit {
  return { method: 'POST', headers: { 'x-csrf-token': csrfToken, ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) };
}
export const api = {
  knowledgeSuppliers: async (signal?: AbortSignal) => parse(knowledgeSuppliersSchema, await get('/knowledge/suppliers', signal)),
  searchKnowledge: async (input: KnowledgeSearch, csrf: string) => parse(knowledgeResultSchema, await request('/knowledge/search', mutation(knowledgeSearchSchema.parse(input), csrf))),
  assistant: async (input: AssistantInput, csrf: string, key: string) => parse(assistantResultSchema, await request('/assistant/runs', { ...mutation(assistantInputSchema.parse(input), csrf, key), signal: AbortSignal.timeout(75_000) })),
  assistantRun: async (id: string, signal?: AbortSignal) => parse(assistantResultSchema, await get(`/assistant/runs/${encodeURIComponent(id)}`, signal)),
  citation: async (citation: Citation, csrf: string, supplierId?: string) => parse(citationSchema, await request(`/knowledge/citations/resolve${params({ supplierId })}`, mutation(citationSchema.parse(citation), csrf))),
  documents: async (query: { type: 'PROCUREMENT_POLICY' | 'SUPPLIER_CONTRACT'; supplierId?: string; page?: number }, signal?: AbortSignal) => parse(documentListSchema, await get(`/knowledge/documents${params(knowledgeQuerySchema.parse(query))}`, signal)),
  uploadDocument: async (input: z.infer<typeof documentInputSchema>, file: File, csrf: string) => {
    const metadata = documentInputSchema.parse(input);
    const body = new FormData();
    body.append('file', file); body.append('title', metadata.title); body.append('type', metadata.type);
    if (metadata.supplierId) body.append('supplierId', metadata.supplierId);
    return parse(documentMetadataSchema, await request('/knowledge/documents', { method: 'POST', headers: { 'x-csrf-token': csrf }, body }));
  },
  documentAction: async (id: string, action: 'retry' | 'archive', csrf: string, supplierId?: string) => parse(documentMetadataSchema, await request(`/knowledge/documents/${encodeURIComponent(id)}/${action}${params({ supplierId })}`, mutation({}, csrf))),
  me: async (signal?: AbortSignal) => parse(authResponseSchema, await get('/auth/me', signal)),
  login: async (email: string, password: string) => parse(authResponseSchema, await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })),
  logout: async (csrfToken: string) => { await request('/auth/logout', mutation({}, csrfToken)); },
  health: async () => parse(healthSchema, await get('/health')),
  dashboard: async (signal?: AbortSignal) => parse(dashboardSchema, await get('/dashboard', signal)),
  inventory: async (query: { search?: string; risk?: string; page?: number; pageSize?: number }, signal?: AbortSignal) => parse(riskListSchema, await get(`/inventory/risks${params(query)}`, signal)),
  proposals: async (query: { status?: string; page?: number; pageSize?: number }, signal?: AbortSignal) => parse(proposalListSchema, await get(`/proposals${params(query)}`, signal)),
  proposal: async (id: string, signal?: AbortSignal) => parse(proposalDetailSchema, await get(`/proposals/${encodeURIComponent(id)}`, signal)),
  quotes: async (id: string, quantity?: number, signal?: AbortSignal) => parse(supplierComparisonSchema, await get(`/products/${encodeURIComponent(id)}/quotes${params({ quantity })}`, signal)),
  create: async (input: CreateProposalInput, csrfToken: string, key: string) => parse(draftBatchSchema, await request('/proposals', mutation(input, csrfToken, key))),
  approve: async (id: string, csrfToken: string) => parse(proposalDetailSchema, await request(`/proposals/${encodeURIComponent(id)}/approve`, mutation({}, csrfToken))),
  reject: async (id: string, reason: string, csrfToken: string) => parse(proposalDetailSchema, await request(`/proposals/${encodeURIComponent(id)}/reject`, mutation({ reason }, csrfToken))),
};
