import { assertTransition } from "@/domain/state-machine";
import type { RecoveryWorkflowStore, RegisteredEvent } from "@/domain/recovery-store";
import type {
  AuditRecord,
  PaymentEvent,
  PolicyResult,
  RecoveryCaseRecord,
  RecoveryDecision as DomainDecision,
  RecoveryState as DomainState,
  StoredAction,
} from "@/domain/types";
import {
  Prisma,
  type PrismaClient,
  type RecoveryActionType,
  type RecoveryState,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

const caseInclude = {
  customer: true,
  subscription: true,
  payment: true,
} satisfies Prisma.RecoveryCaseInclude;

type CaseRow = Prisma.RecoveryCaseGetPayload<{ include: typeof caseInclude }>;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toCase(row: CaseRow): RecoveryCaseRecord {
  return {
    id: row.id,
    caseId: row.id,
    state: row.state,
    customerId: row.customerId,
    customerName: row.customer.name,
    paymentId: row.paymentId,
    providerPaymentId: row.payment.providerPaymentId ?? undefined,
    subscriptionId: row.subscriptionId ?? "",
    source: row.source === "RAZORPAY" ? "RAZORPAY" : "SIMULATOR",
    amountPaisa: row.amountPaisa,
    currency: row.payment.currency,
    paymentStatus: row.payment.status,
    failureReason: row.failureReason,
    retryCount: row.retryCount,
    contactCount: row.contactCount,
    lastContactAt: row.lastContactAt?.toISOString(),
    optedOut: row.customer.optedOut,
    mandateState: row.subscription?.mandateState ?? "INVALID",
    subscriptionStatus: row.subscription?.status ?? "CANCELLED",
    nextProviderRetryAt: row.subscription?.nextProviderRetryAt?.toISOString(),
    disputed: row.disputed,
    fraudSignal: row.fraudSignal,
    inconsistentState: row.inconsistentState,
    valueSegment: row.customer.valueSegment as RecoveryCaseRecord["valueSegment"],
    successfulPayments: row.subscription?.successfulPayments ?? 0,
    failedPayments: row.subscription?.failedPayments ?? 0,
    preferredChannel: row.customer.preferredChannel as RecoveryCaseRecord["preferredChannel"],
    previousRetrySucceeded: row.previousRetrySucceeded,
    currentAction: row.currentAction ?? undefined,
    recoveredAmountPaisa: row.recoveredAmountPaisa,
    aiConfidence: row.aiConfidence ?? undefined,
    nextActionAt: row.nextActionAt?.toISOString(),
    escalationReason: row.escalationReason ?? undefined,
    version: row.version,
    now: new Date().toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toStoredAction(row: {
  id: string;
  recoveryCaseId: string;
  decisionId: string | null;
  type: RecoveryActionType;
  status: "SCHEDULED" | "PENDING" | "EXECUTED" | "FAILED" | "CANCELLED" | "NO_OP";
  idempotencyKey: string;
  providerReferenceId: string | null;
  providerResourceUrl: string | null;
  scheduledFor: Date | null;
  providerOperationId: string | null;
  result: Prisma.JsonValue | null;
  attempts: number;
  error: string | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): StoredAction {
  return {
    id: row.id,
    recoveryCaseId: row.recoveryCaseId,
    decisionId: row.decisionId ?? undefined,
    type: row.type,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    providerReferenceId: row.providerReferenceId ?? undefined,
    providerResourceUrl: row.providerResourceUrl ?? undefined,
    scheduledFor: row.scheduledFor?.toISOString(),
    providerOperationId: row.providerOperationId ?? undefined,
    result: (row.result as Record<string, unknown> | null) ?? undefined,
    attempts: row.attempts,
    error: row.error ?? undefined,
    executedAt: row.executedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaRecoveryStore implements RecoveryWorkflowStore {
  constructor(private readonly db: PrismaClient = prisma) {}

  async registerEvent(event: PaymentEvent, signatureVerified = false): Promise<RegisteredEvent> {
    const existing = await this.db.providerEvent.findUnique({
      where: { providerEventId: event.providerEventId },
    });
    if (existing) {
      const updated = await this.db.providerEvent.update({
        where: { id: existing.id },
        data: { duplicateCount: { increment: 1 } },
      });
      if (existing.recoveryCaseId) {
        await this.appendAudit(existing.recoveryCaseId, {
          type: "DUPLICATE_EVENT_IGNORED",
          message: "Duplicate provider event was recorded without replaying the workflow.",
          metadata: {
            providerEventId: event.providerEventId,
            duplicateCount: updated.duplicateCount,
          },
          providerEventId: existing.id,
        });
      }
      return {
        id: existing.id,
        duplicate: true,
        recoveryCaseId: existing.recoveryCaseId ?? undefined,
      };
    }
    const created = await this.db.providerEvent.create({
      data: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.type,
        payload: json(event),
        signatureVerified,
      },
    });
    return { id: created.id, duplicate: false };
  }

  async linkProviderEventToCase(providerEventId: string, caseId: string): Promise<void> {
    await this.db.providerEvent.update({
      where: { id: providerEventId },
      data: { recoveryCaseId: caseId, processedAt: new Date() },
    });
  }

  async createCaseFromFailedEvent(
    event: PaymentEvent,
    providerEventId: string,
  ): Promise<RecoveryCaseRecord> {
    const existing = await this.db.recoveryCase.findFirst({
      where: { paymentId: event.data.paymentId },
      include: caseInclude,
    });
    if (existing) return toCase(existing);

    const id = `case_${event.data.paymentId}`;
    await this.db.$transaction(async (tx) => {
      await tx.customer.upsert({
        where: { id: event.data.customerId },
        create: {
          id: event.data.customerId,
          name: event.data.customerName,
          email: event.data.email,
          phoneMasked: event.data.phoneMasked,
          preferredChannel: event.data.preferredChannel,
          optedOut: event.data.optedOut,
          valueSegment: event.data.valueSegment,
        },
        update: {
          name: event.data.customerName,
          email: event.data.email,
          phoneMasked: event.data.phoneMasked,
          preferredChannel: event.data.preferredChannel,
          optedOut: event.data.optedOut,
          valueSegment: event.data.valueSegment,
        },
      });
      await tx.subscription.upsert({
        where: { id: event.data.subscriptionId },
        create: {
          id: event.data.subscriptionId,
          customerId: event.data.customerId,
          providerSubscriptionId: event.data.providerSubscriptionId,
          status: event.data.subscriptionStatus,
          mandateState: event.data.mandateState,
          ageMonths: event.data.subscriptionAgeMonths,
          successfulPayments: event.data.successfulPayments,
          failedPayments: event.data.failedPayments,
          nextProviderRetryAt: event.data.nextProviderRetryAt
            ? new Date(event.data.nextProviderRetryAt)
            : undefined,
        },
        update: {
          status: event.data.subscriptionStatus,
          mandateState: event.data.mandateState,
          successfulPayments: event.data.successfulPayments,
          failedPayments: event.data.failedPayments,
          nextProviderRetryAt: event.data.nextProviderRetryAt
            ? new Date(event.data.nextProviderRetryAt)
            : null,
        },
      });
      await tx.payment.upsert({
        where: { id: event.data.paymentId },
        create: {
          id: event.data.paymentId,
          customerId: event.data.customerId,
          subscriptionId: event.data.subscriptionId,
          providerPaymentId: event.data.providerPaymentId,
          amountPaisa: event.data.amountPaisa,
          currency: event.data.currency,
          status: "FAILED",
          failureReason: event.data.failureReason,
        },
        update: {
          status: "FAILED",
          failureReason: event.data.failureReason,
          amountPaisa: event.data.amountPaisa,
        },
      });
      await tx.recoveryCase.create({
        data: {
          id,
          customerId: event.data.customerId,
          subscriptionId: event.data.subscriptionId,
          paymentId: event.data.paymentId,
          source: event.provider,
          failureReason: event.data.failureReason,
          amountPaisa: event.data.amountPaisa,
          retryCount: event.data.retryCount,
          contactCount: event.data.contactCount,
          lastContactAt: event.data.lastContactAt ? new Date(event.data.lastContactAt) : undefined,
          disputed: event.data.disputed,
          fraudSignal: event.data.fraudSignal,
          inconsistentState: event.data.inconsistentState,
          previousRetrySucceeded: event.data.previousRetrySucceeded,
        },
      });
      await tx.providerEvent.update({
        where: { id: providerEventId },
        data: { recoveryCaseId: id, processedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          recoveryCaseId: id,
          providerEventId,
          type: "EVENT_RECEIVED",
          message: "Normalized failed-payment event created a recovery case.",
          metadata: json({ provider: event.provider, providerEventId: event.providerEventId }),
        },
      });
    });
    return this.getCase(id);
  }

  async findCaseByPaymentId(paymentId: string): Promise<RecoveryCaseRecord | null> {
    const found = await this.db.recoveryCase.findFirst({
      where: { paymentId },
      include: caseInclude,
    });
    return found ? toCase(found) : null;
  }

  async getCase(caseId: string): Promise<RecoveryCaseRecord> {
    const found = await this.db.recoveryCase.findUnique({
      where: { id: caseId },
      include: caseInclude,
    });
    if (!found) throw new Error(`Recovery case ${caseId} was not found.`);
    return toCase(found);
  }

  async transition(
    caseId: string,
    to: DomainState,
    event: { type: string; message: string; metadata?: Record<string, unknown> },
  ): Promise<RecoveryCaseRecord> {
    const current = await this.db.recoveryCase.findUniqueOrThrow({ where: { id: caseId } });
    assertTransition(current.state, to);
    await this.db.$transaction(async (tx) => {
      const updated = await tx.recoveryCase.updateMany({
        where: { id: caseId, version: current.version },
        data: { state: to as RecoveryState, version: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new Error("Recovery case changed concurrently; transition was not applied.");
      await tx.auditEvent.create({
        data: {
          recoveryCaseId: caseId,
          type: event.type,
          fromState: current.state,
          toState: to as RecoveryState,
          message: event.message,
          metadata: json(event.metadata ?? {}),
        },
      });
    });
    return this.getCase(caseId);
  }

  async updateCase(
    caseId: string,
    patch: Partial<RecoveryCaseRecord>,
  ): Promise<RecoveryCaseRecord> {
    const caseData: Prisma.RecoveryCaseUpdateInput = {};
    if ("currentAction" in patch) caseData.currentAction = patch.currentAction ?? null;
    if ("aiConfidence" in patch) caseData.aiConfidence = patch.aiConfidence ?? null;
    if ("nextActionAt" in patch)
      caseData.nextActionAt = patch.nextActionAt ? new Date(patch.nextActionAt) : null;
    if ("recoveredAmountPaisa" in patch) caseData.recoveredAmountPaisa = patch.recoveredAmountPaisa;
    if ("retryCount" in patch) caseData.retryCount = patch.retryCount;
    if ("contactCount" in patch) caseData.contactCount = patch.contactCount;
    if ("lastContactAt" in patch)
      caseData.lastContactAt = patch.lastContactAt ? new Date(patch.lastContactAt) : null;
    if ("escalationReason" in patch) caseData.escalationReason = patch.escalationReason ?? null;
    caseData.version = { increment: 1 };

    await this.db.$transaction(async (tx) => {
      const current = await tx.recoveryCase.findUniqueOrThrow({ where: { id: caseId } });
      await tx.recoveryCase.update({ where: { id: caseId }, data: caseData });
      if (patch.paymentStatus) {
        await tx.payment.update({
          where: { id: current.paymentId },
          data: {
            status: patch.paymentStatus,
            recoveredAt: patch.paymentStatus === "SUCCEEDED" ? new Date() : undefined,
          },
        });
      }
      if (current.subscriptionId && (patch.subscriptionStatus || patch.mandateState)) {
        await tx.subscription.update({
          where: { id: current.subscriptionId },
          data: {
            status: patch.subscriptionStatus,
            mandateState: patch.mandateState,
          },
        });
      }
    });
    return this.getCase(caseId);
  }

  async appendAudit(
    caseId: string | undefined,
    event: {
      type: string;
      message: string;
      metadata?: Record<string, unknown>;
      providerEventId?: string;
    },
  ): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        recoveryCaseId: caseId,
        providerEventId: event.providerEventId,
        type: event.type,
        message: event.message,
        metadata: json(event.metadata ?? {}),
      },
    });
  }

  async saveDecision(caseId: string, provider: string, decision: DomainDecision): Promise<string> {
    const created = await this.db.recoveryDecision.create({
      data: {
        recoveryCaseId: caseId,
        provider,
        action: decision.action,
        confidence: decision.confidence,
        reasonCode: decision.reasonCode,
        explanation: decision.explanation,
        recommendedDelayHours: decision.recommendedDelayHours,
        communicationIntent: decision.communicationIntent,
        rawOutput: json(decision),
      },
    });
    return created.id;
  }

  async savePolicy(
    caseId: string,
    decisionId: string | undefined,
    result: PolicyResult,
  ): Promise<string> {
    const created = await this.db.policyEvaluation.create({
      data: {
        recoveryCaseId: caseId,
        decisionId,
        outcome: result.outcome,
        reasonCode: result.reasonCode,
        explanation: result.explanation,
        checks: json(result.checks),
      },
    });
    return created.id;
  }

  async findAction(idempotencyKey: string): Promise<StoredAction | null> {
    const found = await this.db.recoveryAction.findUnique({ where: { idempotencyKey } });
    return found ? toStoredAction(found) : null;
  }

  async findActionByProviderIdentity(identity: {
    providerReferenceId?: string;
    providerOperationId?: string;
  }): Promise<StoredAction | null> {
    if (!identity.providerReferenceId && !identity.providerOperationId) return null;
    const found = await this.db.recoveryAction.findFirst({
      where: {
        OR: [
          identity.providerReferenceId
            ? { providerReferenceId: identity.providerReferenceId }
            : undefined,
          identity.providerOperationId
            ? { providerOperationId: identity.providerOperationId }
            : undefined,
        ].filter(Boolean) as Prisma.RecoveryActionWhereInput[],
      },
    });
    return found ? toStoredAction(found) : null;
  }

  async createAction(
    input: Omit<StoredAction, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoredAction> {
    const created = await this.db.recoveryAction.create({
      data: {
        recoveryCaseId: input.recoveryCaseId,
        decisionId: input.decisionId,
        type: input.type,
        status: input.status,
        idempotencyKey: input.idempotencyKey,
        providerReferenceId: input.providerReferenceId,
        providerResourceUrl: input.providerResourceUrl,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
        providerOperationId: input.providerOperationId,
        result: input.result ? json(input.result) : undefined,
        attempts: input.attempts,
        error: input.error,
        executedAt: input.executedAt ? new Date(input.executedAt) : undefined,
      },
    });
    return toStoredAction(created);
  }

  async updateAction(
    id: string,
    patch: Partial<Omit<StoredAction, "id" | "recoveryCaseId" | "idempotencyKey" | "createdAt">>,
  ): Promise<StoredAction> {
    const updated = await this.db.recoveryAction.update({
      where: { id },
      data: {
        type: patch.type,
        status: patch.status,
        providerReferenceId: patch.providerReferenceId,
        providerResourceUrl: patch.providerResourceUrl,
        scheduledFor: patch.scheduledFor ? new Date(patch.scheduledFor) : undefined,
        providerOperationId: patch.providerOperationId,
        result: patch.result ? json(patch.result) : undefined,
        attempts: patch.attempts,
        error: patch.error,
        executedAt: patch.executedAt ? new Date(patch.executedAt) : undefined,
      },
    });
    return toStoredAction(updated);
  }

  async cancelPendingActions(caseId: string, reason: string): Promise<number> {
    const updated = await this.db.recoveryAction.updateMany({
      where: { recoveryCaseId: caseId, status: { in: ["PENDING", "SCHEDULED"] } },
      data: { status: "CANCELLED", error: reason },
    });
    return updated.count;
  }

  async createReview(
    caseId: string,
    reason: string,
    recommendation: string,
    policyReasonCode: string,
  ): Promise<void> {
    await this.db.humanReview.upsert({
      where: { recoveryCaseId: caseId },
      create: { recoveryCaseId: caseId, reason, recommendation, policyReasonCode },
      update: { reason, recommendation, policyReasonCode, status: "PENDING" },
    });
  }

  async auditForCase(caseId: string): Promise<AuditRecord[]> {
    const rows = await this.db.auditEvent.findMany({
      where: { recoveryCaseId: caseId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      recoveryCaseId: row.recoveryCaseId ?? undefined,
      providerEventId: row.providerEventId ?? undefined,
      type: row.type,
      fromState: row.fromState ?? undefined,
      toState: row.toState ?? undefined,
      message: row.message,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async actionsForCase(caseId: string): Promise<StoredAction[]> {
    const rows = await this.db.recoveryAction.findMany({
      where: { recoveryCaseId: caseId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toStoredAction);
  }
}
