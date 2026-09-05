import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../policy-engine";
import { DEFAULT_POLICY, type RecoveryContext, type RecoveryDecision } from "../types";

const context: RecoveryContext = {
  caseId: "case_policy",
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
  successfulPayments: 8,
  failedPayments: 1,
  preferredChannel: "EMAIL",
  previousRetrySucceeded: true,
  now: "2026-08-23T20:00:00.000Z",
};

const retry: RecoveryDecision = {
  action: "SMART_RETRY",
  confidence: 0.88,
  reasonCode: "TEMPORARY_FAILURE",
  explanation: "A bounded retry is likely to recover this temporary balance failure.",
};

const email: RecoveryDecision = {
  action: "SEND_EMAIL",
  confidence: 0.88,
  reasonCode: "CUSTOMER_ASSISTANCE",
  explanation: "A concise email provides the customer with a recovery path.",
};

describe("deterministic policy engine", () => {
  it("allows a normal bounded retry", () => {
    expect(evaluatePolicy(context, retry).outcome).toBe("ALLOW");
  });

  it("blocks actions after payment recovery", () => {
    const result = evaluatePolicy({ ...context, paymentStatus: "SUCCEEDED" }, retry);
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "PAYMENT_ALREADY_RECOVERED" });
  });

  it("blocks retries at the maximum attempt count", () => {
    const result = evaluatePolicy({ ...context, retryCount: 3 }, retry);
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "MAX_RETRIES_REACHED" });
  });

  it("blocks contact at the maximum communication count", () => {
    const result = evaluatePolicy({ ...context, contactCount: 3 }, email);
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "MAX_CONTACTS_REACHED" });
  });

  it("blocks contact for opted-out customers", () => {
    const result = evaluatePolicy({ ...context, optedOut: true }, email);
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "CUSTOMER_OPTED_OUT" });
  });

  it("does not misapply communication opt-out to a valid bounded retry", () => {
    expect(evaluatePolicy({ ...context, optedOut: true }, retry).outcome).toBe("ALLOW");
  });

  it("blocks a retry on an invalid mandate", () => {
    const result = evaluatePolicy({ ...context, mandateState: "INVALID" }, retry);
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "MANDATE_INVALID" });
  });

  it("blocks inactive subscriptions", () => {
    const result = evaluatePolicy({ ...context, subscriptionStatus: "CANCELLED" }, retry);
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "SUBSCRIPTION_INACTIVE" });
  });

  it("requires review above the high-value threshold", () => {
    const result = evaluatePolicy({ ...context, amountPaisa: 5_000_001 }, retry);
    expect(result).toMatchObject({ outcome: "ESCALATE", reasonCode: "HIGH_VALUE_REVIEW_REQUIRED" });
  });

  it("requires review for a billing dispute", () => {
    const result = evaluatePolicy({ ...context, disputed: true }, email);
    expect(result).toMatchObject({ outcome: "ESCALATE", reasonCode: "BILLING_DISPUTE_REVIEW" });
  });

  it("requires review for fraud and inconsistent states", () => {
    expect(evaluatePolicy({ ...context, fraudSignal: true }, retry).reasonCode).toBe(
      "FRAUD_REVIEW_REQUIRED",
    );
    expect(evaluatePolicy({ ...context, inconsistentState: true }, retry).reasonCode).toBe(
      "INCONSISTENT_STATE_REVIEW",
    );
  });

  it("requires review below the AI confidence boundary", () => {
    const result = evaluatePolicy(context, { ...email, confidence: 0.69 });
    expect(result).toMatchObject({ outcome: "ESCALATE", reasonCode: "LOW_CONFIDENCE_REVIEW" });
  });

  it("blocks communication before the minimum interval", () => {
    const result = evaluatePolicy({ ...context, lastContactAt: "2026-08-23T16:00:00.000Z" }, email);
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "CONTACT_INTERVAL_NOT_MET" });
  });

  it("blocks an action outside the model schema", () => {
    const result = evaluatePolicy(context, { action: "CHARGE_CARD", confidence: 1 });
    expect(result).toMatchObject({ outcome: "BLOCK", reasonCode: "UNSUPPORTED_ACTION" });
  });

  it("permits safe no-action on high-value or disputed cases", () => {
    const wait = { ...retry, action: "WAIT" as const };
    expect(
      evaluatePolicy({ ...context, amountPaisa: 9_000_000, disputed: true }, wait).outcome,
    ).toBe("ALLOW");
  });

  it("honors a stricter configured retry limit", () => {
    const result = evaluatePolicy({ ...context, retryCount: 1 }, retry, {
      ...DEFAULT_POLICY,
      maxRetries: 1,
    });
    expect(result.reasonCode).toBe("MAX_RETRIES_REACHED");
  });
});
