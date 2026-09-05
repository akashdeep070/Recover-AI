-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'FAILED', 'SUCCEEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MandateState" AS ENUM ('ACTIVE', 'PENDING', 'INVALID', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RecoveryState" AS ENUM ('DETECTED', 'ANALYZING', 'DECISION_READY', 'POLICY_CHECK', 'SCHEDULED', 'ACTION_PENDING', 'ACTION_EXECUTED', 'WAITING', 'RECOVERED', 'ESCALATED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "RecoveryActionType" AS ENUM ('WAIT', 'SMART_RETRY', 'REQUEST_PAYMENT_METHOD_UPDATE', 'SEND_WHATSAPP', 'SEND_EMAIL', 'SEND_PAYMENT_LINK', 'ESCALATE', 'STOP');

-- CreateEnum
CREATE TYPE "PolicyOutcome" AS ENUM ('ALLOW', 'BLOCK', 'ESCALATE');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('SCHEDULED', 'PENDING', 'EXECUTED', 'FAILED', 'CANCELLED', 'NO_OP');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'MODIFIED', 'STOPPED');

-- CreateEnum
CREATE TYPE "EvaluationStrategy" AS ENUM ('BASELINE', 'RECOVER_AI');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phoneMasked" TEXT,
    "preferredChannel" TEXT NOT NULL DEFAULT 'EMAIL',
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "valueSegment" TEXT NOT NULL DEFAULT 'STANDARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "providerSubscriptionId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "mandateState" "MandateState" NOT NULL DEFAULT 'ACTIVE',
    "ageMonths" INTEGER NOT NULL DEFAULT 1,
    "successfulPayments" INTEGER NOT NULL DEFAULT 0,
    "failedPayments" INTEGER NOT NULL DEFAULT 0,
    "nextProviderRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "providerPaymentId" TEXT,
    "amountPaisa" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'FAILED',
    "failureReason" TEXT,
    "recoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryCase" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "paymentId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SIMULATOR',
    "state" "RecoveryState" NOT NULL DEFAULT 'DETECTED',
    "failureReason" TEXT NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactAt" TIMESTAMP(3),
    "aiConfidence" DOUBLE PRECISION,
    "currentAction" "RecoveryActionType",
    "nextActionAt" TIMESTAMP(3),
    "recoveredAmountPaisa" INTEGER NOT NULL DEFAULT 0,
    "escalationReason" TEXT,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "fraudSignal" BOOLEAN NOT NULL DEFAULT false,
    "inconsistentState" BOOLEAN NOT NULL DEFAULT false,
    "previousRetrySucceeded" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "recoveryCaseId" TEXT,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryDecision" (
    "id" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "action" "RecoveryActionType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "recommendedDelayHours" INTEGER,
    "communicationIntent" TEXT,
    "rawOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyEvaluation" (
    "id" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "decisionId" TEXT,
    "outcome" "PolicyOutcome" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryAction" (
    "id" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "decisionId" TEXT,
    "type" "RecoveryActionType" NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "providerOperationId" TEXT,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "recoveryCaseId" TEXT,
    "providerEventId" TEXT,
    "type" TEXT NOT NULL,
    "fromState" "RecoveryState",
    "toState" "RecoveryState",
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanReview" (
    "id" TEXT NOT NULL,
    "recoveryCaseId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "policyReasonCode" TEXT NOT NULL,
    "decidedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "HumanReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryPolicy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "maxContacts" INTEGER NOT NULL DEFAULT 3,
    "minContactIntervalHours" INTEGER NOT NULL DEFAULT 12,
    "highValueThresholdPaisa" INTEGER NOT NULL DEFAULT 5000000,
    "minAiConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
    "stopAfterSuccess" BOOLEAN NOT NULL DEFAULT true,
    "respectOptOut" BOOLEAN NOT NULL DEFAULT true,
    "disputeEscalation" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryEvaluationRun" (
    "id" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "datasetSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "baselineMetrics" JSONB,
    "recoverAiMetrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCase" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "syntheticCaseId" TEXT NOT NULL,
    "strategy" "EvaluationStrategy" NOT NULL,
    "observableContext" JSONB NOT NULL,
    "hiddenBehavior" JSONB NOT NULL,
    "decision" JSONB NOT NULL,
    "policy" JSONB NOT NULL,
    "outcome" JSONB NOT NULL,
    "amountPaisa" INTEGER NOT NULL,
    "recoveredPaisa" INTEGER NOT NULL DEFAULT 0,
    "contacts" INTEGER NOT NULL DEFAULT 0,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "policyViolations" INTEGER NOT NULL DEFAULT 0,
    "duplicateActions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubscriptionId_key" ON "Subscription"("providerSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCase_paymentId_key" ON "RecoveryCase"("paymentId");

-- CreateIndex
CREATE INDEX "RecoveryCase_state_idx" ON "RecoveryCase"("state");

-- CreateIndex
CREATE INDEX "RecoveryCase_updatedAt_idx" ON "RecoveryCase"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_providerEventId_key" ON "ProviderEvent"("providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAction_idempotencyKey_key" ON "RecoveryAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditEvent_recoveryCaseId_createdAt_idx" ON "AuditEvent"("recoveryCaseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HumanReview_recoveryCaseId_key" ON "HumanReview"("recoveryCaseId");

-- CreateIndex
CREATE INDEX "EvaluationCase_runId_strategy_idx" ON "EvaluationCase"("runId", "strategy");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCase_runId_syntheticCaseId_strategy_key" ON "EvaluationCase"("runId", "syntheticCaseId", "strategy");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCase" ADD CONSTRAINT "RecoveryCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCase" ADD CONSTRAINT "RecoveryCase_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryCase" ADD CONSTRAINT "RecoveryCase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryDecision" ADD CONSTRAINT "RecoveryDecision_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyEvaluation" ADD CONSTRAINT "PolicyEvaluation_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyEvaluation" ADD CONSTRAINT "PolicyEvaluation_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "RecoveryDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryAction" ADD CONSTRAINT "RecoveryAction_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryAction" ADD CONSTRAINT "RecoveryAction_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "RecoveryDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_providerEventId_fkey" FOREIGN KEY ("providerEventId") REFERENCES "ProviderEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanReview" ADD CONSTRAINT "HumanReview_recoveryCaseId_fkey" FOREIGN KEY ("recoveryCaseId") REFERENCES "RecoveryCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCase" ADD CONSTRAINT "EvaluationCase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RecoveryEvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
