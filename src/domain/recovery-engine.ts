import { ActionExecutionError, razorpayReferenceId, type ActionExecutor } from "./action-executor";
import {
  DecisionProviderError,
  validateDecision,
  type RecoveryDecisionProvider,
} from "./decision-provider";
import { evaluatePolicy } from "./policy-engine";
import type { RecoveryWorkflowStore } from "./recovery-store";
import { canTransition } from "./state-machine";
import {
  DEFAULT_POLICY,
  paymentEventSchema,
  type PaymentEvent,
  type PolicyResult,
  type RecoveryCaseRecord,
  type RecoveryDecision,
  type RecoveryPolicyConfig,
} from "./types";

export interface EngineResult {
  status: "PROCESSED" | "DUPLICATE" | "RECOVERED" | "ESCALATED" | "STOPPED" | "FAILED";
  case: RecoveryCaseRecord | null;
  decision?: RecoveryDecision;
  policy?: PolicyResult;
  message: string;
}

export class RecoveryEngine {
  constructor(
    private readonly store: RecoveryWorkflowStore,
    private readonly decisionProvider: RecoveryDecisionProvider,
    private readonly executor: ActionExecutor,
    private readonly policy: RecoveryPolicyConfig = DEFAULT_POLICY,
  ) {}

  async process(input: PaymentEvent | unknown, signatureVerified = false): Promise<EngineResult> {
    const event = paymentEventSchema.parse(input);
    const registered = await this.store.registerEvent(event, signatureVerified);
    if (registered.duplicate) {
      const existing = registered.recoveryCaseId
        ? await this.store.getCase(registered.recoveryCaseId)
        : null;
      return {
        status: "DUPLICATE",
        case: existing,
        message: "Duplicate event ignored; no workflow or external action was replayed.",
      };
    }

    if (event.type === "PAYMENT_SUCCEEDED") {
      return this.observePaymentSuccess(event, registered.id);
    }

    if (event.type !== "PAYMENT_FAILED") {
      const existing = await this.store.findCaseByPaymentId(event.data.paymentId);
      if (!existing) {
        return {
          status: "STOPPED",
          case: null,
          message: "No active recovery case matched the event.",
        };
      }
      await this.store.updateCase(existing.id, {
        subscriptionStatus:
          event.type === "SUBSCRIPTION_CANCELLED" ? "CANCELLED" : existing.subscriptionStatus,
        mandateState: event.type === "MANDATE_INVALIDATED" ? "INVALID" : existing.mandateState,
      });
      const stopped = await this.store.transition(existing.id, "STOPPED", {
        type: "WORKFLOW_STOPPED",
        message: "A provider lifecycle event made further recovery unsafe.",
        metadata: { eventType: event.type },
      });
      return { status: "STOPPED", case: stopped, message: "Workflow stopped safely." };
    }

    let recoveryCase = await this.store.createCaseFromFailedEvent(event, registered.id);
    recoveryCase = await this.store.transition(recoveryCase.id, "ANALYZING", {
      type: "CONTEXT_LOADING",
      message: "Recovery context is being assembled from payment, subscription, and customer data.",
    });
    await this.store.appendAudit(recoveryCase.id, {
      type: "CONTEXT_LOADED",
      message: "Observable context was loaded without simulator hidden-outcome fields.",
      metadata: {
        failureReason: recoveryCase.failureReason,
        successfulPayments: recoveryCase.successfulPayments,
        previousFailures: recoveryCase.failedPayments,
      },
    });

    let decision: RecoveryDecision;
    try {
      await this.store.appendAudit(recoveryCase.id, {
        type: "DECISION_PROVIDER_CALLED",
        message: `${this.decisionProvider.name} was called for bounded contextual judgment.`,
        metadata: { provider: this.decisionProvider.name },
      });
      decision = validateDecision(await this.decisionProvider.decide(recoveryCase));
    } catch (error) {
      return this.failDecisionSafely(recoveryCase, error);
    }

    const decisionId = await this.store.saveDecision(
      recoveryCase.id,
      this.decisionProvider.name,
      decision,
    );
    recoveryCase = await this.store.updateCase(recoveryCase.id, {
      currentAction: decision.action,
      aiConfidence: decision.confidence,
    });
    recoveryCase = await this.store.transition(recoveryCase.id, "DECISION_READY", {
      type: "AI_DECISION_RECORDED",
      message: `${decision.action} was proposed with ${(decision.confidence * 100).toFixed(0)}% confidence.`,
      metadata: {
        action: decision.action,
        confidence: decision.confidence,
        reasonCode: decision.reasonCode,
        explanation: decision.explanation,
      },
    });
    recoveryCase = await this.store.transition(recoveryCase.id, "POLICY_CHECK", {
      type: "POLICY_CHECK_STARTED",
      message: "The deterministic policy engine is authorizing the proposed action.",
    });

    const policy = evaluatePolicy(recoveryCase, decision, this.policy);
    await this.store.savePolicy(recoveryCase.id, decisionId, policy);
    await this.store.appendAudit(recoveryCase.id, {
      type: "POLICY_RESULT",
      message: `${policy.outcome}: ${policy.explanation}`,
      metadata: { outcome: policy.outcome, reasonCode: policy.reasonCode, checks: policy.checks },
    });

    if (policy.outcome === "ESCALATE") {
      recoveryCase = await this.escalate(recoveryCase, decision, policy);
      return {
        status: "ESCALATED",
        case: recoveryCase,
        decision,
        policy,
        message: "Policy routed the case to human review; no executor ran.",
      };
    }

    if (policy.outcome === "BLOCK") {
      recoveryCase = await this.handleBlock(recoveryCase, policy);
      return {
        status: recoveryCase.state === "RECOVERED" ? "RECOVERED" : "STOPPED",
        case: recoveryCase,
        decision,
        policy,
        message: "Policy blocked the model recommendation; no executor ran.",
      };
    }

    return this.executeAllowed(recoveryCase, decision, decisionId, policy);
  }

  private async observePaymentSuccess(
    event: PaymentEvent,
    providerEventId: string,
  ): Promise<EngineResult> {
    let recoveryCase = await this.store.findCaseByPaymentId(event.data.paymentId);
    const paymentLinkPaid =
      event.provider === "RAZORPAY" && event.rawMetadata.event === "payment_link.paid";
    const providerReferenceId =
      typeof event.rawMetadata.referenceId === "string" ? event.rawMetadata.referenceId : undefined;
    const providerOperationId =
      typeof event.rawMetadata.paymentLinkId === "string"
        ? event.rawMetadata.paymentLinkId
        : undefined;
    if (!recoveryCase && paymentLinkPaid) {
      const linkedAction = await this.store.findActionByProviderIdentity({
        providerReferenceId,
        providerOperationId,
      });
      if (linkedAction) {
        if (
          linkedAction.type === "SEND_PAYMENT_LINK" &&
          (!providerReferenceId || linkedAction.providerReferenceId === providerReferenceId) &&
          (!providerOperationId ||
            !linkedAction.providerOperationId ||
            linkedAction.providerOperationId === providerOperationId)
        ) {
          recoveryCase = await this.store.getCase(linkedAction.recoveryCaseId);
        } else {
          await this.store.appendAudit(undefined, {
            type: "PAYMENT_LINK_IDENTITY_MISMATCH",
            message: "A paid Payment Link event did not match the stored recovery action identity.",
            metadata: {
              providerReferenceId,
              providerOperationId,
              actionId: linkedAction.id,
            },
            providerEventId,
          });
        }
      }
    }
    if (!recoveryCase) {
      await this.store.appendAudit(undefined, {
        type: "PAYMENT_SUCCESS_UNMATCHED",
        message: "A payment success event had no active recovery case.",
        metadata: { paymentId: event.data.paymentId, providerReferenceId, providerOperationId },
        providerEventId,
      });
      return {
        status: "RECOVERED",
        case: null,
        message: "Payment success recorded without an active case.",
      };
    }

    await this.store.linkProviderEventToCase(providerEventId, recoveryCase.id);

    if (recoveryCase.state === "RECOVERED") {
      await this.store.appendAudit(recoveryCase.id, {
        type: "PAYMENT_SUCCESS_ALREADY_ACCOUNTED",
        message: "A later success event was ignored because this case is already recovered.",
        metadata: { paymentId: event.data.paymentId, providerReferenceId, providerOperationId },
        providerEventId,
      });
      return { status: "RECOVERED", case: recoveryCase, message: "Case was already recovered." };
    }

    const paymentLinkAmountPaisa = event.rawMetadata.paymentLinkAmountPaisa;
    const paymentLinkCurrency = event.rawMetadata.paymentLinkCurrency;
    const mismatches = [
      event.data.amountPaisa !== recoveryCase.amountPaisa
        ? `event amount ${event.data.amountPaisa} does not match expected ${recoveryCase.amountPaisa}`
        : undefined,
      event.data.currency !== recoveryCase.currency
        ? `event currency ${event.data.currency} does not match expected ${recoveryCase.currency}`
        : undefined,
      typeof paymentLinkAmountPaisa === "number" &&
      paymentLinkAmountPaisa > 0 &&
      paymentLinkAmountPaisa !== recoveryCase.amountPaisa
        ? `Payment Link amount ${paymentLinkAmountPaisa} does not match expected ${recoveryCase.amountPaisa}`
        : undefined,
      typeof paymentLinkCurrency === "string" &&
      paymentLinkCurrency.length > 0 &&
      paymentLinkCurrency !== recoveryCase.currency
        ? `Payment Link currency ${paymentLinkCurrency} does not match expected ${recoveryCase.currency}`
        : undefined,
    ].filter((value): value is string => Boolean(value));
    if (mismatches.length > 0) {
      await this.store.appendAudit(recoveryCase.id, {
        type: "PAYMENT_RECOVERY_MISMATCH",
        message: "Provider success was rejected because payment identity or amount did not match.",
        metadata: {
          paymentId: event.data.paymentId,
          providerReferenceId,
          providerOperationId,
          mismatches,
        },
        providerEventId,
      });
      if (canTransition(recoveryCase.state, "FAILED")) {
        recoveryCase = await this.store.transition(recoveryCase.id, "FAILED", {
          type: "PAYMENT_RECONCILIATION_FAILED",
          message:
            "Payment success could not be safely reconciled to the expected recovery amount.",
          metadata: { mismatches },
        });
      }
      await this.store.createReview(
        recoveryCase.id,
        "Provider payment did not match the expected Payment Link amount or currency.",
        "Investigate the provider event before accounting recovery.",
        "PAYMENT_RECONCILIATION_MISMATCH",
      );
      return {
        status: "FAILED",
        case: recoveryCase,
        message: "Payment success rejected safely because reconciliation did not match.",
      };
    }

    await this.store.appendAudit(recoveryCase.id, {
      type: paymentLinkPaid ? "PAYMENT_LINK_PAID_RECEIVED" : "PAYMENT_SUCCESS_RECEIVED",
      message: paymentLinkPaid
        ? "Signed Razorpay Payment Link paid event matched the stored recovery action."
        : "A provider payment success event matched the recovery case.",
      metadata: { paymentId: event.data.paymentId, providerReferenceId, providerOperationId },
      providerEventId,
    });

    const cancelled = await this.store.cancelPendingActions(
      recoveryCase.id,
      "Cancelled because payment succeeded before execution.",
    );
    recoveryCase = await this.store.updateCase(recoveryCase.id, {
      paymentStatus: "SUCCEEDED",
      recoveredAmountPaisa: recoveryCase.amountPaisa,
      nextActionAt: undefined,
    });
    await this.store.appendAudit(recoveryCase.id, {
      type: "PAYMENT_VERIFIED",
      message: "Provider amount and currency matched the expected recovery payment.",
      metadata: { amountPaisa: event.data.amountPaisa, currency: event.data.currency },
      providerEventId,
    });
    recoveryCase = await this.store.transition(recoveryCase.id, "RECOVERED", {
      type: "PAYMENT_RECOVERED",
      message: "Payment succeeded; pending interventions were cancelled and the workflow stopped.",
      metadata: { amountPaisa: recoveryCase.amountPaisa, cancelledActions: cancelled },
    });
    return {
      status: "RECOVERED",
      case: recoveryCase,
      message: `Payment recovered; ${cancelled} pending action(s) cancelled.`,
    };
  }

  private async failDecisionSafely(
    recoveryCase: RecoveryCaseRecord,
    error: unknown,
  ): Promise<EngineResult> {
    const code = error instanceof DecisionProviderError ? error.code : "UNAVAILABLE";
    const message = error instanceof Error ? error.message : "Decision provider failed.";
    await this.store.appendAudit(recoveryCase.id, {
      type: "DECISION_PROVIDER_FAILURE",
      message:
        "The decision failed validation or availability checks; no policy or executor bypass occurred.",
      metadata: { code, error: message },
    });
    const escalated = await this.store.transition(recoveryCase.id, "ESCALATED", {
      type: "SAFE_FALLBACK_ESCALATION",
      message: "Case was routed to manual review after decision-provider failure.",
      metadata: { code },
    });
    await this.store.createReview(
      recoveryCase.id,
      `Decision provider failure: ${code}`,
      "Review the case context; no external action was executed.",
      `AI_${code}`,
    );
    return {
      status: "ESCALATED",
      case: escalated,
      message: "AI failure handled by safe human escalation.",
    };
  }

  private async escalate(
    recoveryCase: RecoveryCaseRecord,
    decision: RecoveryDecision,
    policy: PolicyResult,
  ): Promise<RecoveryCaseRecord> {
    const updated = await this.store.updateCase(recoveryCase.id, {
      escalationReason: policy.reasonCode,
    });
    const escalated = await this.store.transition(updated.id, "ESCALATED", {
      type: "HUMAN_REVIEW_REQUIRED",
      message: policy.explanation,
      metadata: { recommendation: decision.action, policyReasonCode: policy.reasonCode },
    });
    await this.store.createReview(
      recoveryCase.id,
      policy.explanation,
      decision.action,
      policy.reasonCode,
    );
    return escalated;
  }

  private async handleBlock(
    recoveryCase: RecoveryCaseRecord,
    policy: PolicyResult,
  ): Promise<RecoveryCaseRecord> {
    if (policy.reasonCode === "PAYMENT_ALREADY_RECOVERED") {
      const updated = await this.store.updateCase(recoveryCase.id, {
        paymentStatus: "SUCCEEDED",
        recoveredAmountPaisa: recoveryCase.amountPaisa,
      });
      return this.store.transition(updated.id, "RECOVERED", {
        type: "WORKFLOW_STOPPED_AFTER_SUCCESS",
        message: policy.explanation,
      });
    }
    return this.store.transition(recoveryCase.id, "STOPPED", {
      type: "POLICY_BLOCKED_ACTION",
      message: policy.explanation,
      metadata: { reasonCode: policy.reasonCode },
    });
  }

  private async executeAllowed(
    recoveryCase: RecoveryCaseRecord,
    decision: RecoveryDecision,
    decisionId: string,
    policy: PolicyResult,
  ): Promise<EngineResult> {
    const idempotencyKey = `${recoveryCase.id}:${decisionId}:${decision.action}`;
    const existing = await this.store.findAction(idempotencyKey);
    if (existing) {
      await this.store.appendAudit(recoveryCase.id, {
        type: "DUPLICATE_ACTION_PREVENTED",
        message: "Existing action idempotency key prevented a replay.",
        metadata: { idempotencyKey, actionId: existing.id },
      });
      return {
        status: "PROCESSED",
        case: recoveryCase,
        decision,
        policy,
        message: "Duplicate action prevented.",
      };
    }

    if (decision.action === "WAIT") {
      const delay = decision.recommendedDelayHours ?? 12;
      const scheduledFor = new Date(
        new Date(recoveryCase.now).getTime() + delay * 3_600_000,
      ).toISOString();
      recoveryCase = await this.store.transition(recoveryCase.id, "SCHEDULED", {
        type: "ACTION_SCHEDULED",
        message: `Intentional wait scheduled for ${delay} hours.`,
        metadata: { action: "WAIT", scheduledFor },
      });
      await this.store.createAction({
        recoveryCaseId: recoveryCase.id,
        decisionId,
        type: "WAIT",
        status: "SCHEDULED",
        idempotencyKey,
        scheduledFor,
        attempts: 0,
      });
      recoveryCase = await this.store.updateCase(recoveryCase.id, { nextActionAt: scheduledFor });
      recoveryCase = await this.store.transition(recoveryCase.id, "WAITING", {
        type: "WORKFLOW_WAITING",
        message: "No external action was taken; the workflow is waiting for a provider outcome.",
        metadata: { reasonCode: decision.reasonCode },
      });
      return {
        status: "PROCESSED",
        case: recoveryCase,
        decision,
        policy,
        message: "Intelligent wait scheduled.",
      };
    }

    if (decision.action === "STOP") {
      await this.store.createAction({
        recoveryCaseId: recoveryCase.id,
        decisionId,
        type: "STOP",
        status: "NO_OP",
        idempotencyKey,
        attempts: 0,
      });
      recoveryCase = await this.store.transition(recoveryCase.id, "STOPPED", {
        type: "WORKFLOW_STOPPED",
        message: decision.explanation,
        metadata: { reasonCode: decision.reasonCode },
      });
      return {
        status: "STOPPED",
        case: recoveryCase,
        decision,
        policy,
        message: "Workflow stopped without side effects.",
      };
    }

    recoveryCase = await this.store.transition(recoveryCase.id, "ACTION_PENDING", {
      type: "ACTION_AUTHORIZED",
      message: `${decision.action} passed deterministic policy validation.`,
      metadata: { idempotencyKey, policyReasonCode: policy.reasonCode },
    });
    const action = await this.store.createAction({
      recoveryCaseId: recoveryCase.id,
      decisionId,
      type: decision.action,
      status: "PENDING",
      idempotencyKey,
      attempts: 1,
    });
    if (decision.action === "SEND_PAYMENT_LINK") {
      const providerReferenceId = razorpayReferenceId(action.id);
      await this.store.updateAction(action.id, { providerReferenceId });
      await this.store.appendAudit(recoveryCase.id, {
        type: "PAYMENT_LINK_CREATE_STARTED",
        message: "Payment Link creation started with a stable provider reference.",
        metadata: { providerReferenceId, idempotencyKey },
      });
    }

    try {
      const result = await this.executor.execute({
        action: decision.action,
        context: recoveryCase,
        actionId: action.id,
        idempotencyKey,
        communicationIntent: decision.communicationIntent,
      });
      const actionPatch: Parameters<RecoveryWorkflowStore["updateAction"]>[1] = {
        status: result.status === "SCHEDULED" ? "SCHEDULED" : result.status,
        providerOperationId: result.providerOperationId,
        result: result.metadata,
        executedAt: new Date().toISOString(),
      };
      if (result.providerReferenceId) actionPatch.providerReferenceId = result.providerReferenceId;
      if (result.providerResourceUrl) actionPatch.providerResourceUrl = result.providerResourceUrl;
      await this.store.updateAction(action.id, actionPatch);
      if (decision.action === "SEND_PAYMENT_LINK") {
        await this.store.appendAudit(recoveryCase.id, {
          type: "PAYMENT_LINK_CREATED",
          message: "Payment Link identity was persisted for provider reconciliation.",
          metadata: {
            providerOperationId: result.providerOperationId,
            providerReferenceId: result.providerReferenceId,
            providerResourceUrl: result.providerResourceUrl,
            ...result.metadata,
          },
        });
      }
      if (decision.action === "SMART_RETRY") {
        recoveryCase = await this.store.updateCase(recoveryCase.id, {
          retryCount: recoveryCase.retryCount + 1,
        });
      }
      if (
        [
          "SEND_EMAIL",
          "SEND_WHATSAPP",
          "SEND_PAYMENT_LINK",
          "REQUEST_PAYMENT_METHOD_UPDATE",
        ].includes(decision.action)
      ) {
        recoveryCase = await this.store.updateCase(recoveryCase.id, {
          contactCount: recoveryCase.contactCount + 1,
          lastContactAt: new Date().toISOString(),
        });
      }
      recoveryCase = await this.store.transition(recoveryCase.id, "ACTION_EXECUTED", {
        type: "ACTION_EXECUTED",
        message: result.message,
        metadata: {
          action: decision.action,
          providerOperationId: result.providerOperationId,
          ...result.metadata,
        },
      });
      if (result.recovered) {
        recoveryCase = await this.store.updateCase(recoveryCase.id, {
          paymentStatus: "SUCCEEDED",
          recoveredAmountPaisa: result.recoveredAmountPaisa,
        });
        recoveryCase = await this.store.transition(recoveryCase.id, "RECOVERED", {
          type: "PAYMENT_RECOVERED",
          message: "The observed action outcome recovered the payment.",
          metadata: { recoveredAmountPaisa: result.recoveredAmountPaisa },
        });
        return {
          status: "RECOVERED",
          case: recoveryCase,
          decision,
          policy,
          message: "Payment recovered.",
        };
      }
      recoveryCase = await this.store.transition(recoveryCase.id, "WAITING", {
        type: "OUTCOME_OBSERVATION_PENDING",
        message: "Action completed safely; the workflow is waiting for a payment outcome.",
      });
      return {
        status: "PROCESSED",
        case: recoveryCase,
        decision,
        policy,
        message: "Action executed; outcome pending.",
      };
    } catch (error) {
      const executionError =
        error instanceof ActionExecutionError
          ? error
          : new ActionExecutionError(
              "PROVIDER_DOWN",
              error instanceof Error ? error.message : "Executor failed.",
              true,
            );
      await this.store.updateAction(action.id, {
        status: "FAILED",
        error: executionError.message,
        result: { recoverable: executionError.recoverable, code: executionError.code },
      });
      await this.store.appendAudit(recoveryCase.id, {
        type: "ACTION_EXECUTION_FAILURE",
        message: executionError.message,
        metadata: {
          code: executionError.code,
          recoverable: executionError.recoverable,
          idempotencyKey,
          retryRequiresSameKey: true,
        },
      });
      recoveryCase = await this.store.transition(recoveryCase.id, "FAILED", {
        type: "WORKFLOW_RECOVERABLE_FAILURE",
        message:
          "Execution failed in a recoverable state; unsafe replay is prevented by idempotency.",
        metadata: { idempotencyKey },
      });
      return {
        status: "FAILED",
        case: recoveryCase,
        decision,
        policy,
        message: executionError.message,
      };
    }
  }
}
