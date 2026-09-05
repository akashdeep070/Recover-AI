import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RazorpayPaymentLinkApiClient,
  RazorpayPaymentLinkApiError,
  RazorpayTestModeExecutor,
  razorpayReferenceId,
  type PaymentLinkCreateInput,
  type PaymentLinkRecord,
  type RazorpayPaymentLinkClient,
} from "../action-executor";
import { DeterministicDecisionProvider } from "../decision-provider";
import { RecoveryEngine } from "../recovery-engine";
import { InMemoryRecoveryStore } from "../recovery-store";
import { normalizeRazorpayWebhook } from "../../server/razorpay-adapter";
import type { PaymentEvent } from "../types";

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakePaymentLinkClient implements RazorpayPaymentLinkClient {
  readonly createInputs: PaymentLinkCreateInput[] = [];
  readonly links = new Map<string, PaymentLinkRecord>();
  private readonly createBehaviors: Array<PaymentLinkRecord | Error> = [];

  queueCreateBehavior(...behaviors: Array<PaymentLinkRecord | Error>) {
    this.createBehaviors.push(...behaviors);
  }

  async createPaymentLink(input: PaymentLinkCreateInput): Promise<PaymentLinkRecord> {
    this.createInputs.push(input);
    const behavior = this.createBehaviors.shift();
    if (behavior instanceof Error) {
      const link =
        behavior instanceof FakeProviderTimeout
          ? behavior.link
          : (behavior as Error & { link?: PaymentLinkRecord }).link;
      if (link) {
        this.links.set(link.referenceId, link);
      }
      throw behavior;
    }
    const link = behavior ?? {
      id: `plink_${this.createInputs.length}`,
      shortUrl: `https://rzp.test/${this.createInputs.length}`,
      referenceId: input.referenceId,
      amountPaisa: input.amountPaisa,
      currency: input.currency,
      status: "created",
    };
    this.links.set(link.referenceId, link);
    return link;
  }

  async findPaymentLinkByReference(referenceId: string): Promise<PaymentLinkRecord | null> {
    return this.links.get(referenceId) ?? null;
  }
}

class FakeProviderTimeout extends RazorpayPaymentLinkApiError {
  constructor(public readonly link?: PaymentLinkRecord) {
    super(408, "provider state unknown", true, false);
  }
}

function request(actionId = "action_golden_001") {
  return {
    action: "SEND_PAYMENT_LINK" as const,
    actionId,
    idempotencyKey: `case_golden:decision_golden:SEND_PAYMENT_LINK`,
    context: {
      caseId: "case_golden",
      amountPaisa: 249_900,
      currency: "INR",
      paymentStatus: "FAILED" as const,
      failureReason: "BANK_DECLINED",
      retryCount: 0,
      contactCount: 0,
      optedOut: false,
      mandateState: "ACTIVE" as const,
      subscriptionStatus: "ACTIVE" as const,
      disputed: false,
      fraudSignal: false,
      inconsistentState: false,
      valueSegment: "STANDARD" as const,
      successfulPayments: 4,
      failedPayments: 1,
      preferredChannel: "EMAIL" as const,
      previousRetrySucceeded: false,
      now: "2026-09-04T00:00:00.000Z",
    },
  };
}

function failedEvent(overrides: Partial<PaymentEvent["data"]> = {}): PaymentEvent {
  return {
    provider: "RAZORPAY",
    providerEventId: "evt_golden_failed_001",
    type: "PAYMENT_FAILED",
    occurredAt: "2026-09-04T00:00:00.000Z",
    data: {
      paymentId: "pay_golden_failed_001",
      providerPaymentId: "pay_golden_failed_001",
      amountPaisa: 249_900,
      currency: "INR",
      failureReason: "BANK_DECLINED",
      customerId: "cus_golden_001",
      customerName: "Golden Path Customer",
      subscriptionId: "sub_golden_001",
      providerSubscriptionId: "sub_golden_001",
      subscriptionStatus: "ACTIVE",
      mandateState: "ACTIVE",
      subscriptionAgeMonths: 14,
      successfulPayments: 4,
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
    rawMetadata: { testMode: true },
  };
}

function paidPayload(
  referenceId: string,
  paymentLinkId: string,
  amount = 249_900,
  currency = "INR",
) {
  return {
    event: "payment_link.paid",
    id: "evt_golden_paid_001",
    payload: {
      payment_link: {
        entity: {
          id: paymentLinkId,
          amount,
          currency,
          reference_id: referenceId,
          status: "paid",
          notes: {
            customer_id: "cus_golden_001",
            customer_name: "Golden Path Customer",
            subscription_id: "sub_golden_001",
            successful_payments: 4,
          },
        },
      },
      payment: {
        entity: {
          id: "pay_golden_paid_001",
          amount,
          currency,
          customer_id: "cus_golden_001",
          subscription_id: "sub_golden_001",
        },
      },
    },
  };
}

describe("Razorpay Payment Link safety boundary", () => {
  it("uses the Test API create and reference-filtered lookup boundaries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "plink_api_001",
            short_url: "https://rzp.test/api-001",
            reference_id: "rec_api_reference_001",
            amount: 249900,
            currency: "INR",
            status: "created",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new RazorpayPaymentLinkApiClient(
      "rzp_test_demo",
      "secret",
      "https://api.example.test/v1",
    );
    const referenceId = "rec_api_reference_001";
    expect(await client.findPaymentLinkByReference(referenceId)).toBeNull();
    const created = await client.createPaymentLink({
      amountPaisa: 249900,
      currency: "INR",
      referenceId,
      description: "RecoverAI TEST",
      notes: { mode: "test" },
    });

    expect(created).toMatchObject({ id: "plink_api_001", referenceId, amountPaisa: 249900 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/v1/payment_links?reference_id=${referenceId}`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.example.test/v1/payment_links");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("uses one stable reference and adopts an existing link on repeated execution", async () => {
    const client = new FakePaymentLinkClient();
    const executor = new RazorpayTestModeExecutor("rzp_test_demo", "secret", client);
    const first = await executor.execute(request());
    const second = await executor.execute(request());

    expect(client.createInputs).toHaveLength(1);
    expect(client.createInputs[0]?.referenceId).toBe(razorpayReferenceId("action_golden_001"));
    expect(second.providerOperationId).toBe(first.providerOperationId);
    expect(second.providerReferenceId).toBe(first.providerReferenceId);
  });

  it("adopts a link created before an ambiguous timeout", async () => {
    const client = new FakePaymentLinkClient();
    const referenceId = razorpayReferenceId("action_timeout_existing");
    const existing: PaymentLinkRecord = {
      id: "plink_timeout_existing",
      shortUrl: "https://rzp.test/timeout-existing",
      referenceId,
      amountPaisa: 249_900,
      currency: "INR",
      status: "created",
    };
    client.queueCreateBehavior(new FakeProviderTimeout(existing));
    const result = await new RazorpayTestModeExecutor("rzp_test_demo", "secret", client).execute(
      request("action_timeout_existing"),
    );

    expect(result.providerOperationId).toBe(existing.id);
    expect(result.metadata).toMatchObject({ resolution: "reconciled" });
    expect(client.createInputs).toHaveLength(1);
  });

  it("retries a missing ambiguous link with the same reference, never a new one", async () => {
    const client = new FakePaymentLinkClient();
    client.queueCreateBehavior(new FakeProviderTimeout());
    const result = await new RazorpayTestModeExecutor("rzp_test_demo", "secret", client).execute(
      request("action_timeout_missing"),
    );

    expect(client.createInputs).toHaveLength(2);
    expect(client.createInputs[0]?.referenceId).toBe(client.createInputs[1]?.referenceId);
    expect(result.providerReferenceId).toBe(client.createInputs[0]?.referenceId);
  });

  it("reconciles duplicate-reference responses instead of creating another link", async () => {
    const client = new FakePaymentLinkClient();
    const referenceId = razorpayReferenceId("action_duplicate_reference");
    const existing: PaymentLinkRecord = {
      id: "plink_duplicate_reference",
      shortUrl: "https://rzp.test/duplicate-reference",
      referenceId,
      amountPaisa: 249_900,
      currency: "INR",
      status: "created",
    };
    const duplicate = new RazorpayPaymentLinkApiError(
      400,
      "duplicate reference_id",
      false,
      true,
    ) as RazorpayPaymentLinkApiError & {
      link?: PaymentLinkRecord;
    };
    duplicate.link = existing;
    client.queueCreateBehavior(duplicate);
    const result = await new RazorpayTestModeExecutor("rzp_test_demo", "secret", client).execute(
      request("action_duplicate_reference"),
    );

    expect(result.providerOperationId).toBe(existing.id);
    expect(client.createInputs).toHaveLength(1);
  });
});

describe("Razorpay golden recovery flow", () => {
  it("reconciles payment_link.paid to the linked action and recovers exactly once", async () => {
    const client = new FakePaymentLinkClient();
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(
      store,
      new DeterministicDecisionProvider(),
      new RazorpayTestModeExecutor("rzp_test_demo", "secret", client),
    );
    const started = await engine.process(failedEvent());
    expect(started.case?.state).toBe("WAITING");
    const action = (await store.actionsForCase(started.case!.id))[0]!;
    expect(action.providerReferenceId).toBe(razorpayReferenceId(action.id));
    expect(action.providerOperationId).toBeTruthy();

    const paidRaw = JSON.stringify(
      paidPayload(action.providerReferenceId!, action.providerOperationId!),
    );
    const paid = normalizeRazorpayWebhook(JSON.parse(paidRaw), paidRaw, "evt_golden_paid_001");
    const recovered = await engine.process(paid, true);
    expect(recovered.status).toBe("RECOVERED");
    expect(recovered.case?.state).toBe("RECOVERED");
    expect(recovered.case?.recoveredAmountPaisa).toBe(249_900);

    const duplicate = await engine.process(paid, true);
    expect(duplicate.status).toBe("DUPLICATE");
    expect((await store.actionsForCase(started.case!.id))[0]?.status).toBe("EXECUTED");
    expect(
      (await store.auditForCase(started.case!.id)).filter(
        (event) => event.type === "PAYMENT_RECOVERED",
      ),
    ).toHaveLength(1);
  });

  it("rejects a matching Payment Link with an amount or currency mismatch", async () => {
    const client = new FakePaymentLinkClient();
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(
      store,
      new DeterministicDecisionProvider(),
      new RazorpayTestModeExecutor("rzp_test_demo", "secret", client),
    );
    const started = await engine.process(failedEvent());
    const action = (await store.actionsForCase(started.case!.id))[0]!;
    const raw = JSON.stringify(
      paidPayload(action.providerReferenceId!, action.providerOperationId!, 100),
    );
    const mismatch = await engine.process(
      normalizeRazorpayWebhook(JSON.parse(raw), raw, "evt_golden_paid_mismatch"),
      true,
    );

    expect(mismatch.status).toBe("FAILED");
    expect(mismatch.case?.state).toBe("FAILED");
    expect(mismatch.case?.recoveredAmountPaisa).toBe(0);
    expect(store.reviews).toHaveLength(1);
    expect(
      (await store.auditForCase(started.case!.id)).some(
        (event) => event.type === "PAYMENT_RECOVERY_MISMATCH",
      ),
    ).toBe(true);
  });

  it("does not recover a case for a different Payment Link identity", async () => {
    const client = new FakePaymentLinkClient();
    const store = new InMemoryRecoveryStore();
    const engine = new RecoveryEngine(
      store,
      new DeterministicDecisionProvider(),
      new RazorpayTestModeExecutor("rzp_test_demo", "secret", client),
    );
    const started = await engine.process(failedEvent());
    const wrong = normalizeRazorpayWebhook(
      paidPayload(razorpayReferenceId("other-action"), "plink_other"),
      JSON.stringify(paidPayload(razorpayReferenceId("other-action"), "plink_other")),
      "evt_golden_paid_wrong_link",
    );
    const result = await engine.process(wrong, true);

    expect(result.case).toBeNull();
    expect((await store.getCase(started.case!.id)).state).toBe("WAITING");
    expect((await store.getCase(started.case!.id)).recoveredAmountPaisa).toBe(0);
  });
});
