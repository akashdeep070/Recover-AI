import { describe, expect, it } from "vitest";
import { SandboxActionExecutor } from "../action-executor";
import { ChaosDecisionProvider, DeterministicDecisionProvider } from "../decision-provider";
import { RecoveryEngine } from "../recovery-engine";
import { InMemoryRecoveryStore } from "../recovery-store";
import type { PaymentEvent } from "../types";

function event(overrides: Partial<PaymentEvent["data"]> = {}): PaymentEvent {
  return {
    provider: "SIMULATOR",
    providerEventId: "evt_integration_failed_001",
    type: "PAYMENT_FAILED",
    occurredAt: "2026-08-23T18:00:00.000Z",
    data: {
      paymentId: "pay_integration_001",
      amountPaisa: 499_900,
      currency: "INR",
      failureReason: "BANK_DECLINED",
      customerId: "cus_integration_001",
      customerName: "Integration Customer",
      subscriptionId: "sub_integration_001",
      subscriptionStatus: "ACTIVE",
      mandateState: "ACTIVE",
      subscriptionAgeMonths: 10,
      successfulPayments: 8,
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
      ...overrides,
    },
    rawMetadata: { synthetic: true },
  };
}

describe("end-to-end recovery engine", () => {
  it("runs event -> decision -> policy -> action -> observation -> audit", async () => {
    const store = new InMemoryRecoveryStore();
    const result = await new RecoveryEngine(
      store,
      new DeterministicDecisionProvider(),
      new SandboxActionExecutor(),
    ).process(event());
    expect(result.status).toBe("PROCESSED");
    expect(result.case?.state).toBe("WAITING");
    expect(result.decision?.action).toBe("SEND_PAYMENT_LINK");
    expect(result.policy?.outcome).toBe("ALLOW");
    expect(await store.actionsForCase(result.case!.id)).toHaveLength(1);
    expect((await store.auditForCase(result.case!.id)).map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "EVENT_RECEIVED",
        "AI_DECISION_RECORDED",
        "POLICY_RESULT",
        "ACTION_EXECUTED",
      ]),
    );
  });

  it("ignores duplicate provider events without duplicate actions", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(
      store,
      new DeterministicDecisionProvider(),
      new SandboxActionExecutor(),
    );
    const first = await engine.process(event());
    const duplicate = await engine.process(event());
    expect(duplicate.status).toBe("DUPLICATE");
    expect(await store.actionsForCase(first.case!.id)).toHaveLength(1);
    expect(
      (await store.auditForCase(first.case!.id)).some(
        (item) => item.type === "DUPLICATE_EVENT_IGNORED",
      ),
    ).toBe(true);
  });

  it("cancels a scheduled action when payment succeeds during waiting", async () => {
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(
      store,
      new DeterministicDecisionProvider(),
      new SandboxActionExecutor(),
    );
    const failed = event({
      nextProviderRetryAt: "2026-08-24T08:00:00.000Z",
      failureReason: "INSUFFICIENT_FUNDS",
    });
    const waiting = await engine.process(failed);
    const success: PaymentEvent = {
      ...failed,
      providerEventId: "evt_integration_success_001",
      type: "PAYMENT_SUCCEEDED",
      occurredAt: "2026-08-23T21:00:00.000Z",
    };
    const recovered = await engine.process(success);
    expect(recovered.status).toBe("RECOVERED");
    expect(recovered.case?.recoveredAmountPaisa).toBe(499_900);
    expect((await store.actionsForCase(waiting.case!.id))[0]?.status).toBe("CANCELLED");
  });

  it("fails malformed AI output safe with no executor action", async () => {
    const store = new InMemoryRecoveryStore();
    const provider = new ChaosDecisionProvider(
      new DeterministicDecisionProvider(),
      "AI_INVALID_OUTPUT",
    );
    const result = await new RecoveryEngine(store, provider, new SandboxActionExecutor()).process(
      event(),
    );
    expect(result.status).toBe("ESCALATED");
    expect(await store.actionsForCase(result.case!.id)).toHaveLength(0);
    expect(store.reviews).toHaveLength(1);
  });

  it("fails AI timeout safe with no policy bypass", async () => {
    const store = new InMemoryRecoveryStore();
    const provider = new ChaosDecisionProvider(new DeterministicDecisionProvider(), "AI_TIMEOUT");
    const result = await new RecoveryEngine(store, provider, new SandboxActionExecutor()).process(
      event(),
    );
    expect(result.status).toBe("ESCALATED");
    expect(store.policyResults).toHaveLength(0);
    expect(await store.actionsForCase(result.case!.id)).toHaveLength(0);
  });

  it("records provider failure in a recoverable state behind one idempotency key", async () => {
    const store = new InMemoryRecoveryStore();
    const result = await new RecoveryEngine(
      store,
      new DeterministicDecisionProvider(),
      new SandboxActionExecutor("MESSAGE_PROVIDER_DOWN"),
    ).process(event());
    expect(result.status).toBe("FAILED");
    const actions = await store.actionsForCase(result.case!.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(
      (await store.auditForCase(result.case!.id)).some(
        (item) => item.type === "ACTION_EXECUTION_FAILURE",
      ),
    ).toBe(true);
  });

  it("blocks max retries without calling the executor", async () => {
    const store = new InMemoryRecoveryStore();
    const fixedRetryProvider = {
      name: "test",
      decide: async () => ({
        action: "SMART_RETRY",
        confidence: 0.9,
        reasonCode: "TEST_RETRY",
        explanation: "Test bounded retry recommendation.",
      }),
    };
    const result = await new RecoveryEngine(
      store,
      fixedRetryProvider,
      new SandboxActionExecutor(),
    ).process(event({ failureReason: "INSUFFICIENT_FUNDS", retryCount: 3 }));
    expect(result.status).toBe("STOPPED");
    expect(result.policy?.reasonCode).toBe("MAX_RETRIES_REACHED");
    expect(await store.actionsForCase(result.case!.id)).toHaveLength(0);
  });
});
