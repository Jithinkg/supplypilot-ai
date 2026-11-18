-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STAFF', 'MANAGER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('HUMAN', 'AI');

-- CreateEnum
CREATE TYPE "RunMode" AS ENUM ('READ_ONLY', 'CREATE_DRAFT');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySale" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DailySale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,

    CONSTRAINT "SupplierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'SHARED',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "allocatedPaise" INTEGER NOT NULL,
    "reservedPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseProposal" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "source" "ActorKind" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "totalPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "agentRunId" UUID,
    "decisionMakerId" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalLine" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPricePaise" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL,
    "lineTotalPaise" INTEGER NOT NULL,

    CONSTRAINT "ProposalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetReservation" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "budgetId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "mode" "RunMode" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "result" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "actorKind" "ActorKind" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "requestId" TEXT NOT NULL,
    "runId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "DailySale_productId_date_key" ON "DailySale"("productId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuote_supplierId_productId_key" ON "SupplierQuote"("supplierId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_key_key" ON "Budget"("key");

-- CreateIndex
CREATE INDEX "PurchaseProposal_status_createdAt_idx" ON "PurchaseProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseProposal_createdAt_idx" ON "PurchaseProposal"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseProposal_agentRunId_supplierId_key" ON "PurchaseProposal"("agentRunId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalLine_proposalId_productId_key" ON "ProposalLine"("proposalId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetReservation_proposalId_key" ON "BudgetReservation"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_userId_requestKey_key" ON "AgentRun"("userId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operation_key_key" ON "IdempotencyRecord"("userId", "operation", "key");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySale" ADD CONSTRAINT "DailySale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposal" ADD CONSTRAINT "PurchaseProposal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposal" ADD CONSTRAINT "PurchaseProposal_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposal" ADD CONSTRAINT "PurchaseProposal_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposal" ADD CONSTRAINT "PurchaseProposal_decisionMakerId_fkey" FOREIGN KEY ("decisionMakerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseProposal" ADD CONSTRAINT "PurchaseProposal_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalLine" ADD CONSTRAINT "ProposalLine_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "PurchaseProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalLine" ADD CONSTRAINT "ProposalLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalLine" ADD CONSTRAINT "ProposalLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SupplierQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "PurchaseProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Day 1 database invariants. PostgreSQL INTEGER supplies the paise upper bound.
-- These checks complement request validation; future services own business transitions.

ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("stockQuantity" >= 0);
ALTER TABLE "DailySale" ADD CONSTRAINT "DailySale_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "SupplierQuote" ADD CONSTRAINT "SupplierQuote_price_positive" CHECK ("unitPricePaise" > 0),
  ADD CONSTRAINT "SupplierQuote_lead_positive" CHECK ("leadTimeDays" > 0);
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_funds_valid" CHECK ("allocatedPaise" >= 0 AND "reservedPaise" >= 0 AND "reservedPaise" <= "allocatedPaise"),
  ADD CONSTRAINT "Budget_single_currency" CHECK ("currency" = 'INR'),
  ADD CONSTRAINT "Budget_shared_only" CHECK ("key" = 'SHARED');
ALTER TABLE "PurchaseProposal" ADD CONSTRAINT "PurchaseProposal_total_positive" CHECK ("totalPaise" > 0);
ALTER TABLE "ProposalLine" ADD CONSTRAINT "ProposalLine_values_positive" CHECK ("quantity" > 0 AND "unitPricePaise" > 0 AND "leadTimeDays" > 0 AND "lineTotalPaise" > 0),
  ADD CONSTRAINT "ProposalLine_total_exact" CHECK ("lineTotalPaise"::bigint = "quantity"::bigint * "unitPricePaise"::bigint);
ALTER TABLE "BudgetReservation" ADD CONSTRAINT "BudgetReservation_amount_positive" CHECK ("amountPaise" > 0);

