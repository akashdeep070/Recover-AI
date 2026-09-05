import { SandboxActionExecutor } from "./action-executor";
import { ChaosDecisionProvider, DeterministicDecisionProvider } from "./decision-provider";
import { RecoveryEngine } from "./recovery-engine";
import { InMemoryRecoveryStore } from "./recovery-store";
import type { ChaosScenario, PaymentEvent } from "./types";

export interface ChaosResult {
  scenario: ChaosScenario;
  outcome: string;
  safe: boolean;
  actionCount: number;
  audit: Awaited<ReturnType<InMemoryRecoveryStore["auditForCase"]>>;
  summary: string;
}

function chaosEvent(providerEventId: string): PaymentEvent {
  return {
    provider: "SIMULATOR",
    providerEventId,
    type: "PAYMENT_FAILED",
    occurredAt: "2026-08-23T18:00:00.000Z",
    data: {
      paymentId: "payment_chaos_001",
      amountPaisa: 499_900,
      currency: "INR",
      failureReason: "BANK_DECLINED",
      customerId: "customer_chaos_001",
      customerName: "Chaos Test Customer",
      subscriptionId: "subscription_chaos_001",
      subscriptionStatus: "ACTIVE",
      mandateState: "ACTIVE",
      subscriptionAgeMonths: 8,
      successfulPayments: 7,
      failedPayments: 1,
      retryCount: 0,
      contactCount: 0,
      preferredChannel: "EMAIL",
      optedOut: false,
      valueSegment: "STANDARD",
      previousRetrySucceeded: false,
      disputed: false,
      fraudSignal: false,
      inconsistentState: false,
    },
    rawMetadata: { synthetic: true, scenario: providerEventId },
  };
}

export async function runChaosScenario(
  scenario: Exclude<ChaosScenario, "NONE">,
): Promise<ChaosResult> {
  const store = new InMemoryRecoveryStore();
  const baseProvider = new DeterministicDecisionProvider();
  const provider =
    scenario === "AI_TIMEOUT" || scenario === "AI_INVALID_OUTPUT"
      ? new ChaosDecisionProvider(baseProvider, scenario)
      : baseProvider;
  const executor = new SandboxActionExecutor(scenario);
  const engine = new RecoveryEngine(store, provider, executor);
  const event = chaosEvent(`event_${scenario.toLowerCase()}`);
  const first = await engine.process(event);

  if (scenario === "DUPLICATE_WEBHOOK") {
    const duplicate = await engine.process(event);
    const caseId = first.case!.id;
    return {
      scenario,
      outcome: duplicate.status,
      safe: duplicate.status === "DUPLICATE" && (await store.actionsForCase(caseId)).length === 1,
      actionCount: (await store.actionsForCase(caseId)).length,
      audit: await store.auditForCase(caseId),
      summary:
        "The second provider event was retained as an audit fact without replaying the workflow.",
    };
  }

  if (scenario === "PAYMENT_SUCCESS_DURING_WAIT") {
    const waitStore = new InMemoryRecoveryStore();
    const waitEvent = chaosEvent("event_payment_success_wait");
    waitEvent.data.failureReason = "INSUFFICIENT_FUNDS";
    waitEvent.data.nextProviderRetryAt = "2026-08-24T12:00:00.000Z";
    const waitEngine = new RecoveryEngine(waitStore, baseProvider, executor);
    const waiting = await waitEngine.process(waitEvent);
    const successEvent: PaymentEvent = {
      ...waitEvent,
      providerEventId: "event_payment_success_observed",
      type: "PAYMENT_SUCCEEDED",
      occurredAt: "2026-08-23T21:00:00.000Z",
    };
    const recovered = await waitEngine.process(successEvent);
    const caseId = waiting.case!.id;
    const actions = await waitStore.actionsForCase(caseId);
    return {
      scenario,
      outcome: recovered.status,
      safe:
        recovered.status === "RECOVERED" &&
        actions.every((action) => action.status === "CANCELLED"),
      actionCount: actions.length,
      audit: await waitStore.auditForCase(caseId),
      summary:
        "Payment success cancelled the scheduled wait action before any reminder could execute.",
    };
  }

  const caseId = first.case!.id;
  const actions = await store.actionsForCase(caseId);
  const safe =
    scenario === "AI_TIMEOUT" || scenario === "AI_INVALID_OUTPUT"
      ? first.status === "ESCALATED" && actions.length === 0
      : first.status === "FAILED" && actions.length === 1;
  return {
    scenario,
    outcome: first.status,
    safe,
    actionCount: actions.length,
    audit: await store.auditForCase(caseId),
    summary:
      first.status === "ESCALATED"
        ? "Invalid or unavailable AI output produced a safe manual-review fallback with no execution."
        : "Executor failure remained recoverable behind the original idempotency key.",
  };
}
