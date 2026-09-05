-- Add durable provider identity fields so one logical recovery action can be
-- reconciled with at most one Razorpay Payment Link after retries/timeouts.
ALTER TABLE "RecoveryAction"
  ADD COLUMN "providerReferenceId" TEXT,
  ADD COLUMN "providerResourceUrl" TEXT;

CREATE UNIQUE INDEX "RecoveryAction_providerReferenceId_key"
  ON "RecoveryAction"("providerReferenceId");
