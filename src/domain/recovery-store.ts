import { assertTransition } from "./state-machine";
import type {
  AuditRecord,
  PaymentEvent,
  PolicyResult,
  RecoveryCaseRecord,
  RecoveryDecision,
  RecoveryState,
  StoredAction,
} from "./types";

export interface RegisteredEvent {
  id: string;
  duplicate: boolean;
  recoveryCaseId?: string;
}

export interface RecoveryWorkflowStore {
  registerEvent(event: PaymentEvent, signatureVerified?: boolean): Promise<RegisteredEvent>;
  linkProviderEventToCase(providerEventId: string, caseId: string): Promise<void>;
  createCaseFromFailedEvent(
    event: PaymentEvent,
    providerEventId: string,
  ): Promise<RecoveryCaseRecord>;
  findCaseByPaymentId(paymentId: string): Promise<RecoveryCaseRecord | null>;
  getCase(caseId: string): Promise<RecoveryCaseRecord>;
  transition(
    caseId: string,
    to: RecoveryState,
    event: { type: string; message: string; metadata?: Record<string, unknown> },
  ): Promise<RecoveryCaseRecord>;
  updateCase(
    caseId: string,
    patch: Partial<
      Pick<
        RecoveryCaseRecord,
        | "currentAction"
        | "aiConfidence"
        | "nextActionAt"
        | "recoveredAmountPaisa"
        | "retryCount"
        | "contactCount"
        | "lastContactAt"
        | "escalationReason"
        | "paymentStatus"
        | "subscriptionStatus"
        | "mandateState"
      >
    >,
  ): Promise<RecoveryCaseRecord>;
  appendAudit(
    caseId: string | undefined,
    event: {
      type: string;
      message: string;
      metadata?: Record<string, unknown>;
      providerEventId?: string;
    },
  ): Promise<void>;
  saveDecision(caseId: string, provider: string, decision: RecoveryDecision): Promise<string>;
  savePolicy(caseId: string, decisionId: string | undefined, result: PolicyResult): Promise<string>;
  findAction(idempotencyKey: string): Promise<StoredAction | null>;
  findActionByProviderIdentity(identity: {
    providerReferenceId?: string;
    providerOperationId?: string;
  }): Promise<StoredAction | null>;
  createAction(input: Omit<StoredAction, "id" | "createdAt" | "updatedAt">): Promise<StoredAction>;
  updateAction(
    id: string,
    patch: Partial<Omit<StoredAction, "id" | "recoveryCaseId" | "idempotencyKey" | "createdAt">>,
  ): Promise<StoredAction>;
  cancelPendingActions(caseId: string, reason: string): Promise<number>;
  createReview(
    caseId: string,
    reason: string,
    recommendation: string,
    policyReasonCode: string,
  ): Promise<void>;
  auditForCase(caseId: string): Promise<AuditRecord[]>;
  actionsForCase(caseId: string): Promise<StoredAction[]>;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export class InMemoryRecoveryStore implements RecoveryWorkflowStore {
  readonly cases = new Map<string, RecoveryCaseRecord>();
  readonly events = new Map<
    string,
    { id: string; recoveryCaseId?: string; duplicateCount: number }
  >();
  readonly audits: AuditRecord[] = [];
  readonly decisions: Array<{
    id: string;
    caseId: string;
    provider: string;
    decision: RecoveryDecision;
  }> = [];
  readonly policyResults: Array<{ id: string; caseId: string; result: PolicyResult }> = [];
  readonly actions = new Map<string, StoredAction>();
  readonly reviews: Array<{
    caseId: string;
    reason: string;
    recommendation: string;
    policyReasonCode: string;
  }> = [];

  async registerEvent(event: PaymentEvent): Promise<RegisteredEvent> {
    const existing = this.events.get(event.providerEventId);
    if (existing) {
      existing.duplicateCount += 1;
      if (existing.recoveryCaseId) {
        await this.appendAudit(existing.recoveryCaseId, {
          type: "DUPLICATE_EVENT_IGNORED",
          message: "Duplicate provider event was recorded without replaying the workflow.",
          metadata: {
            providerEventId: event.providerEventId,
            duplicateCount: existing.duplicateCount,
          },
          providerEventId: existing.id,
        });
      }
      return { id: existing.id, duplicate: true, recoveryCaseId: existing.recoveryCaseId };
    }
    const id = uid("event");
    this.events.set(event.providerEventId, { id, duplicateCount: 0 });
    return { id, duplicate: false };
  }

  async linkProviderEventToCase(providerEventId: string, caseId: string): Promise<void> {
    for (const [providerEvent, value] of this.events) {
      if (value.id === providerEventId) {
        value.recoveryCaseId = caseId;
        this.events.set(providerEvent, value);
        return;
      }
    }
  }

  async createCaseFromFailedEvent(
    event: PaymentEvent,
    providerEventId: string,
  ): Promise<RecoveryCaseRecord> {
    const existing = await this.findCaseByPaymentId(event.data.paymentId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = `case_${event.data.paymentId}`;
    const record: RecoveryCaseRecord = {
      id,
      caseId: id,
      state: "DETECTED",
      customerId: event.data.customerId,
      customerName: event.data.customerName,
      paymentId: event.data.paymentId,
      currency: event.data.currency,
      providerPaymentId: event.data.providerPaymentId,
      subscriptionId: event.data.subscriptionId,
      source: event.provider,
      amountPaisa: event.data.amountPaisa,
      paymentStatus: "FAILED",
      failureReason: event.data.failureReason,
      retryCount: event.data.retryCount,
      contactCount: event.data.contactCount,
      lastContactAt: event.data.lastContactAt,
      optedOut: event.data.optedOut,
      mandateState: event.data.mandateState,
      subscriptionStatus: event.data.subscriptionStatus,
      nextProviderRetryAt: event.data.nextProviderRetryAt,
      disputed: event.data.disputed,
      fraudSignal: event.data.fraudSignal,
      inconsistentState: event.data.inconsistentState,
      valueSegment: event.data.valueSegment,
      successfulPayments: event.data.successfulPayments,
      failedPayments: event.data.failedPayments,
      preferredChannel: event.data.preferredChannel,
      previousRetrySucceeded: event.data.previousRetrySucceeded,
      recoveredAmountPaisa: 0,
      version: 1,
      now,
      createdAt: now,
      updatedAt: now,
    };
    this.cases.set(id, record);
    for (const value of this.events.values()) {
      if (value.id === providerEventId) value.recoveryCaseId = id;
    }
    await this.appendAudit(id, {
      type: "EVENT_RECEIVED",
      message: "Normalized failed-payment event created a recovery case.",
      metadata: { provider: event.provider, providerEventId: event.providerEventId },
      providerEventId,
    });
    return record;
  }

  async findCaseByPaymentId(paymentId: string): Promise<RecoveryCaseRecord | null> {
    return [...this.cases.values()].find((item) => item.paymentId === paymentId) ?? null;
  }

  async getCase(caseId: string): Promise<RecoveryCaseRecord> {
    const found = this.cases.get(caseId);
    if (!found) throw new Error(`Recovery case ${caseId} was not found.`);
    return found;
  }

  async transition(
    caseId: string,
    to: RecoveryState,
    event: { type: string; message: string; metadata?: Record<string, unknown> },
  ): Promise<RecoveryCaseRecord> {
    const current = await this.getCase(caseId);
    assertTransition(current.state, to);
    const now = new Date().toISOString();
    const updated = { ...current, state: to, version: current.version + 1, now, updatedAt: now };
    this.cases.set(caseId, updated);
    this.audits.push({
      id: uid("audit"),
      recoveryCaseId: caseId,
      type: event.type,
      fromState: current.state,
      toState: to,
      message: event.message,
      metadata: event.metadata ?? {},
      createdAt: now,
    });
    return updated;
  }

  async updateCase(
    caseId: string,
    patch: Partial<RecoveryCaseRecord>,
  ): Promise<RecoveryCaseRecord> {
    const current = await this.getCase(caseId);
    const now = new Date().toISOString();
    const updated = { ...current, ...patch, version: current.version + 1, now, updatedAt: now };
    this.cases.set(caseId, updated);
    return updated;
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
    this.audits.push({
      id: uid("audit"),
      recoveryCaseId: caseId,
      providerEventId: event.providerEventId,
      type: event.type,
      message: event.message,
      metadata: event.metadata ?? {},
      createdAt: new Date().toISOString(),
    });
  }

  async saveDecision(
    caseId: string,
    provider: string,
    decision: RecoveryDecision,
  ): Promise<string> {
    const id = uid("decision");
    this.decisions.push({ id, caseId, provider, decision });
    return id;
  }

  async savePolicy(
    caseId: string,
    _decisionId: string | undefined,
    result: PolicyResult,
  ): Promise<string> {
    const id = uid("policy");
    this.policyResults.push({ id, caseId, result });
    return id;
  }

  async findAction(idempotencyKey: string): Promise<StoredAction | null> {
    return this.actions.get(idempotencyKey) ?? null;
  }

  async findActionByProviderIdentity(identity: {
    providerReferenceId?: string;
    providerOperationId?: string;
  }): Promise<StoredAction | null> {
    return (
      [...this.actions.values()].find(
        (action) =>
          (identity.providerReferenceId &&
            action.providerReferenceId === identity.providerReferenceId) ||
          (identity.providerOperationId &&
            action.providerOperationId === identity.providerOperationId),
      ) ?? null
    );
  }

  async createAction(
    input: Omit<StoredAction, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoredAction> {
    const existing = await this.findAction(input.idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    const action: StoredAction = { ...input, id: uid("action"), createdAt: now, updatedAt: now };
    this.actions.set(input.idempotencyKey, action);
    return action;
  }

  async updateAction(id: string, patch: Partial<StoredAction>): Promise<StoredAction> {
    const entry = [...this.actions.entries()].find(([, value]) => value.id === id);
    if (!entry) throw new Error(`Action ${id} was not found.`);
    const [key, current] = entry;
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.actions.set(key, updated);
    return updated;
  }

  async cancelPendingActions(caseId: string, reason: string): Promise<number> {
    let count = 0;
    for (const [key, action] of this.actions) {
      if (action.recoveryCaseId === caseId && ["SCHEDULED", "PENDING"].includes(action.status)) {
        this.actions.set(key, {
          ...action,
          status: "CANCELLED",
          error: reason,
          updatedAt: new Date().toISOString(),
        });
        count += 1;
      }
    }
    return count;
  }

  async createReview(
    caseId: string,
    reason: string,
    recommendation: string,
    policyReasonCode: string,
  ): Promise<void> {
    if (!this.reviews.some((review) => review.caseId === caseId)) {
      this.reviews.push({ caseId, reason, recommendation, policyReasonCode });
    }
  }

  async auditForCase(caseId: string): Promise<AuditRecord[]> {
    return this.audits.filter((audit) => audit.recoveryCaseId === caseId);
  }

  async actionsForCase(caseId: string): Promise<StoredAction[]> {
    return [...this.actions.values()].filter((action) => action.recoveryCaseId === caseId);
  }
}
