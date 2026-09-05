import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChaosDecisionProvider,
  DecisionProviderError,
  DeterministicDecisionProvider,
  OpenRouterDecisionProvider,
  validateDecision,
} from "../decision-provider";
import type { RecoveryContext } from "../types";

const base: RecoveryContext = {
  caseId: "case_decision",
  amountPaisa: 499_900,
  paymentStatus: "FAILED",
  failureReason: "INSUFFICIENT_FUNDS",
  retryCount: 0,
  contactCount: 0,
  optedOut: false,
  mandateState: "ACTIVE",
  subscriptionStatus: "ACTIVE",
  disputed: false,
  fraudSignal: false,
  inconsistentState: false,
  valueSegment: "STANDARD",
  successfulPayments: 10,
  failedPayments: 1,
  preferredChannel: "EMAIL",
  previousRetrySucceeded: true,
  now: "2026-08-23T20:00:00.000Z",
};

describe("decision providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const provider = new DeterministicDecisionProvider();

  it("produces one schema-valid bounded action", async () => {
    expect(validateDecision(await provider.decide(base)).action).toBe("SMART_RETRY");
  });

  it("selects WAIT when a provider retry is already scheduled", async () => {
    const result = await provider.decide({
      ...base,
      nextProviderRetryAt: "2026-08-24T08:00:00.000Z",
    });
    expect(result).toMatchObject({ action: "WAIT", reasonCode: "PROVIDER_RETRY_SCHEDULED" });
  });

  it("selects payment-method update instead of retrying an expired mandate", async () => {
    expect((await provider.decide({ ...base, mandateState: "EXPIRED" })).action).toBe(
      "REQUEST_PAYMENT_METHOD_UPDATE",
    );
  });

  it("rejects malformed and arbitrary model output", () => {
    expect(() => validateDecision({ action: "CHARGE_ANY_AMOUNT", confidence: "yes" })).toThrow(
      DecisionProviderError,
    );
  });

  it("injects invalid output without turning it into a valid action", async () => {
    const chaos = new ChaosDecisionProvider(provider, "AI_INVALID_OUTPUT");
    await expect(chaos.decide(base)).resolves.toMatchObject({ action: "CHARGE_ANY_AMOUNT" });
    expect(() =>
      validateDecision({ action: "CHARGE_ANY_AMOUNT", confidence: "certain" }),
    ).toThrow();
  });

  it("injects a typed timeout failure", async () => {
    const chaos = new ChaosDecisionProvider(provider, "AI_TIMEOUT");
    await expect(chaos.decide(base)).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("accepts strict structured output from OpenRouter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  action: "WAIT",
                  confidence: 0.88,
                  reasonCode: "PROVIDER_RETRY_SCHEDULED",
                  explanation: "Wait for the provider retry before contacting the customer.",
                  recommendedDelayHours: 12,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterDecisionProvider("test-key", ["test/model"]).decide(base);

    expect(result).toMatchObject({ action: "WAIT", reasonCode: "PROVIDER_RETRY_SCHEDULED" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<
      string,
      unknown
    >;
    expect(request).toMatchObject({
      model: "test/model",
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "recovery_decision", strict: true },
      },
    });
  });

  it("falls back across OpenRouter models when the first model returns invalid output", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    action: "STOP",
                    confidence: 0.99,
                    reasonCode: "CUSTOMER_OPTED_OUT",
                    explanation: "The customer opted out, so automated recovery must stop.",
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OpenRouterDecisionProvider("test-key", ["first/model", "second/model"]).decide(base),
    ).resolves.toMatchObject({ action: "STOP", reasonCode: "CUSTOMER_OPTED_OUT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((JSON.parse(fetchMock.mock.calls[1][1].body as string) as { model: string }).model).toBe(
      "second/model",
    );
  });

  it("fails safely when every OpenRouter model is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
        ),
    );

    await expect(
      new OpenRouterDecisionProvider("test-key", ["first/model", "second/model"]).decide(base),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
