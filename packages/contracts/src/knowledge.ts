import { z } from 'zod';
export const documentTypeSchema = z.enum(['PROCUREMENT_POLICY', 'SUPPLIER_CONTRACT']);
export const documentStatusSchema = z.enum(['QUEUED', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED']);
export const documentInputSchema = z.object({ title: z.string().trim().min(1).max(200), type: documentTypeSchema, supplierId: z.uuid().optional() }).strict().superRefine((value, ctx) => {
  if ((value.type === 'SUPPLIER_CONTRACT') !== Boolean(value.supplierId)) ctx.addIssue({ code: 'custom', message: 'Only supplier contracts require supplierId.', path: ['supplierId'] });
});
export const knowledgeQuerySchema = z.object({ type: documentTypeSchema.default('PROCUREMENT_POLICY'), supplierId: z.uuid().optional(), page: z.coerce.number().int().min(1).max(1000000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }).strict().superRefine((value, ctx) => {
  if ((value.type === 'SUPPLIER_CONTRACT') !== Boolean(value.supplierId)) ctx.addIssue({ code: 'custom', message: 'Contract queries require supplierId.', path: ['supplierId'] });
});
export const knowledgeSearchSchema = z.object({ query: z.string().trim().min(1).max(1000), type: documentTypeSchema, supplierId: z.uuid().optional() }).strict().superRefine((value, ctx) => {
  if ((value.type === 'SUPPLIER_CONTRACT') !== Boolean(value.supplierId)) ctx.addIssue({ code: 'custom', message: 'Contract searches require supplierId.', path: ['supplierId'] });
});
export const documentMetadataSchema = z.object({ id: z.uuid(), title: z.string(), type: documentTypeSchema, supplierId: z.uuid().nullable(), originalFilename: z.string(), pageCount: z.number().int().nullable(), status: documentStatusSchema, errorCode: z.string().nullable(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const documentListSchema = z.object({ items: z.array(documentMetadataSchema), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive() });
export type DocumentMetadata = z.infer<typeof documentMetadataSchema>;
export const knowledgeSuppliersSchema = z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string() }));
export const citationSchema = z.object({ documentId: z.uuid(), chunkId: z.uuid(), pageNumber: z.number().int().min(1).max(50), supportingText: z.string().min(1).max(20000) }).strict();
export const knowledgeResultSchema = z.object({ outcome: z.enum(['EVIDENCE_FOUND', 'INSUFFICIENT_EVIDENCE', 'UNAVAILABLE']), scope: z.object({ type: documentTypeSchema, supplierId: z.uuid().nullable() }).optional(), advisory: z.literal(true), findings: z.string(), citations: z.array(citationSchema).max(5) });
export type KnowledgeSearch = z.infer<typeof knowledgeSearchSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type KnowledgeResult = z.infer<typeof knowledgeResultSchema>;
export const intentSchema = z.enum(['INVENTORY_QUERY', 'PROCUREMENT_QUERY', 'PURCHASE_RECOMMENDATION', 'POLICY_QUERY', 'SUPPLIER_CONTRACT_QUERY', 'DRAFT_REQUEST', 'FORBIDDEN_ACTION', 'CLARIFICATION', 'UNSUPPORTED']);
export const assistantInputSchema = z.object({
  message: z.string().trim().min(1).max(2000), mode: z.enum(['READ_ONLY', 'CREATE_DRAFT']).default('READ_ONLY'),
  items: z.array(z.object({ productId: z.uuid(), quantity: z.number().int().positive().max(2147483647).optional() }).strict()).min(1).max(50).optional(),
  supplierId: z.uuid().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.items && new Set(input.items.map((item) => item.productId)).size !== input.items.length) ctx.addIssue({ code: 'custom', message: 'Duplicate products.' });
});
export const assistantResultSchema = z.object({
  runId: z.uuid(), status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']), intent: intentSchema.nullable(),
  answer: z.string(), createdProposalIds: z.array(z.uuid()), warnings: z.array(z.string()),
  knowledge: z.array(knowledgeResultSchema), data: z.array(z.object({ tool: z.string(), result: z.json() })),
  toolCalls: z.number().int().min(0).max(12), errorCode: z.string().nullable(),
});
export type AssistantInput = z.infer<typeof assistantInputSchema>;
export type AssistantResult = z.infer<typeof assistantResultSchema>;
