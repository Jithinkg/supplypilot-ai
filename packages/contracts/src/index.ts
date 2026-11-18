import { z } from 'zod';

export const roleSchema = z.enum(['STAFF', 'MANAGER']);
export const paiseSchema = z.number().int().min(0).max(2_147_483_647);
export const loginSchema = z.object({
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();
export const userSchema = z.object({ id: z.uuid(), email: z.email(), role: roleSchema });
export const authResponseSchema = z.object({ user: userSchema, csrfToken: z.string().min(32) });
export const healthSchema = z.object({ status: z.enum(['ok', 'degraded']), database: z.enum(['up', 'down']) });
export const calculatorSchema = z.object({
  operation: z.enum(['add', 'multiply']),
  a: z.number().int().min(-1_000_000).max(1_000_000),
  b: z.number().int().min(-1_000_000).max(1_000_000),
}).strict();
export type User = z.infer<typeof userSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const quantitySchema = z.number().int().min(0).max(2_147_483_647);
export const positiveQuantitySchema = quantitySchema.min(1);
export const riskLevelSchema = z.enum(['CRITICAL', 'HIGH', 'LOW']);
export const inventoryQuerySchema = z.object({
  search: z.string().trim().max(100).default(''),
  risk: riskLevelSchema.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export const quoteQuerySchema = z.object({ quantity: z.coerce.number().int().min(1).max(2_147_483_647).optional() }).strict();
export const productIdSchema = z.uuid();
export const riskRowSchema = z.object({
  productId: z.uuid(), sku: z.string(), name: z.string(), stock: quantitySchema,
  averageDailySales: z.number().nonnegative(),
  estimatedDaysUntilStockout: z.number().nonnegative().nullable(),
  riskLevel: riskLevelSchema,
  recommendedQuantity: quantitySchema,
  hasPendingReplenishment: z.boolean(),
  eligibleForAutomaticReplenishment: z.boolean(),
  exclusionReason: z.enum(['EXISTING_PROPOSAL', 'NO_RECENT_DEMAND', 'TARGET_STOCK_MET']).nullable(),
});
export const riskSummarySchema = z.object({ totalProducts: quantitySchema, atRiskNext14Days: quantitySchema, stockoutWithin7Days: quantitySchema });
export const riskListSchema = z.object({
  items: z.array(riskRowSchema), total: quantitySchema, page: z.number().int().positive(), pageSize: z.number().int().positive(),
  summary: riskSummarySchema, asOf: z.iso.datetime(), windowStart: z.iso.date(), windowEnd: z.iso.date(),
});
export const budgetSnapshotSchema = z.object({
  budgetId: z.uuid(), currency: z.literal('INR'), allocatedPaise: paiseSchema, reservedPaise: paiseSchema,
  availablePaise: paiseSchema, asOf: z.iso.datetime(),
});
export type RiskRow = z.infer<typeof riskRowSchema>;
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

export const proposalStatusSchema = z.enum(['DRAFT', 'APPROVED', 'REJECTED']);
export const proposalIdSchema = z.uuid();
export const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const createProposalSchema = z.object({
  items: z.array(z.object({ productId: z.uuid(), quantity: positiveQuantitySchema.optional() }).strict()).min(1).max(50),
  reason: z.string().trim().min(1).max(1000),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.items.forEach((item, index) => {
    if (seen.has(item.productId)) context.addIssue({ code: 'custom', path: ['items', index, 'productId'], message: 'Duplicate product.' });
    seen.add(item.productId);
  });
});
export const approveProposalSchema = z.object({}).strict();
export const rejectProposalSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
export const proposalQuerySchema = z.object({
  status: proposalStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export const auditQuerySchema = z.object({
  entityType: z.enum(['PurchaseProposal', 'Session']).optional(), entityId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export const affordabilitySchema = z.object({ overBudget: z.boolean(), shortfallPaise: paiseSchema });
export const supplierSummarySchema = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
export const proposalSummarySchema = z.object({
  id: z.uuid(), supplier: supplierSummarySchema, status: proposalStatusSchema, source: z.enum(['HUMAN', 'AI']),
  creator: userSchema, decisionMaker: userSchema.nullable(), reason: z.string(), rejectionReason: z.string().nullable(),
  totalPaise: paiseSchema, createdAt: z.iso.datetime(), decidedAt: z.iso.datetime().nullable(),
  affordability: affordabilitySchema.nullable(),
});
export const draftBatchSchema = z.object({
  proposals: z.array(proposalSummarySchema.extend({ affordability: affordabilitySchema })),
  exclusions: z.array(z.object({ productId: z.uuid(), reason: z.enum(['EXISTING_PROPOSAL', 'TARGET_STOCK_MET']) })),
  warnings: z.array(z.object({ productId: z.uuid(), code: z.enum(['LATE_DELIVERY', 'EXISTING_REPLENISHMENT']) })),
  batchTotalPaise: paiseSchema, budget: budgetSnapshotSchema, affordability: affordabilitySchema, asOf: z.iso.datetime(),
});
export const proposalListSchema = z.object({ items: z.array(proposalSummarySchema), total: quantitySchema, page: z.number().int().positive(), pageSize: z.number().int().positive() });
export const auditEventSchema = z.object({
  id: z.uuid(), actorUserId: z.uuid().nullable(), actorKind: z.enum(['HUMAN', 'AI']), action: z.string(),
  entityType: z.string(), entityId: z.string().nullable(), requestId: z.string(), createdAt: z.iso.datetime(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export const proposalDetailSchema = proposalSummarySchema.extend({
  budget: budgetSnapshotSchema, affordability: affordabilitySchema.nullable(),
  lines: z.array(z.object({
    id: z.uuid(), product: z.object({ id: z.uuid(), sku: z.string(), name: z.string(), unit: z.string() }),
    quoteId: z.uuid(), quantity: positiveQuantitySchema, unitPricePaise: paiseSchema,
    leadTimeDays: positiveQuantitySchema, lineTotalPaise: paiseSchema, lateDeliveryRisk: z.boolean(), hasPendingReplenishment: z.boolean(),
  })),
  audit: z.array(auditEventSchema),
});
export const dashboardSchema = riskSummarySchema.extend({
  pendingProposals: quantitySchema, availableBudgetPaise: paiseSchema, currency: z.literal('INR'),
  budget: budgetSnapshotSchema, proposalCounts: z.object({ DRAFT: quantitySchema, APPROVED: quantitySchema, REJECTED: quantitySchema }),
  recentProposals: z.array(proposalSummarySchema).max(5), asOf: z.iso.datetime(),
});
export type CreateProposalInput = z.infer<typeof createProposalSchema>;
export type ProposalQuery = z.infer<typeof proposalQuerySchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const supplierComparisonSchema = z.object({
  productId: z.uuid(), quantity: positiveQuantitySchema.nullable(), selectedQuoteId: z.uuid().nullable(),
  quantityRequired: z.boolean(), lateDeliveryRisk: z.boolean(), hasPendingReplenishment: z.boolean(),
  automaticReplenishmentExcluded: z.boolean(),
  exclusionReason: z.enum(['EXISTING_PROPOSAL', 'NO_RECENT_DEMAND', 'TARGET_STOCK_MET']).nullable(),
  selectionReason: z.enum(['FASTEST_AVAILABLE', 'LOWEST_PRICE_NO_RECENT_DEMAND', 'LOWEST_PRICE_BEFORE_STOCKOUT']),
  quotes: z.array(z.object({
    quoteId: z.uuid(), supplierId: z.uuid(), supplierCode: z.string(), supplierName: z.string(),
    unitPricePaise: paiseSchema, leadTimeDays: positiveQuantitySchema,
    arrivesBeforeStockout: z.boolean().nullable(), lineTotalPaise: paiseSchema.nullable(),
  })),
  budget: budgetSnapshotSchema, affordability: affordabilitySchema.nullable(), asOf: z.iso.datetime(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;
export type ProposalDetail = z.infer<typeof proposalDetailSchema>;
export type DraftBatch = z.infer<typeof draftBatchSchema>;
export type SupplierComparison = z.infer<typeof supplierComparisonSchema>;

export * from './knowledge.js';
