import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeRazorpayWebhook, verifyRazorpaySignature } from "../razorpay-adapter";

const payload = {
  event: "payment.failed",
  payload: {
    payment: {
      entity: {
        id: "pay_test_adapter_001",
        amount: 499900,
        currency: "INR",
        customer_id: "cust_test_001",
        subscription_id: "sub_test_001",
        error_reason: "insufficient_funds",
        created_at: 1_777_130_400,
        notes: { customer_name: "Adapter Customer", successful_payments: 8 },
      },
    },
  },
};

describe("Razorpay adapter boundary", () => {
  it("verifies HMAC signatures with constant-time comparison", () => {
    const raw = JSON.stringify(payload);
    const secret = "test_webhook_secret";
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyRazorpaySignature(raw, signature, secret)).toBe(true);
    expect(verifyRazorpaySignature(raw, "bad", secret)).toBe(false);
  });

  it("normalizes provider data into the internal event model", () => {
    const raw = JSON.stringify(payload);
    const event = normalizeRazorpayWebhook(payload, raw, "evt_test_adapter_001");
    expect(event).toMatchObject({
      provider: "RAZORPAY",
      providerEventId: "evt_test_adapter_001",
      type: "PAYMENT_FAILED",
      data: {
        paymentId: "pay_test_adapter_001",
        amountPaisa: 499900,
        customerId: "cust_test_001",
        subscriptionId: "sub_test_001",
      },
    });
  });

  it("rejects provider events outside the supported domain boundary", () => {
    expect(() => normalizeRazorpayWebhook({ event: "refund.created" }, "{}")).toThrow(
      "Unsupported Razorpay event",
    );
  });

  it("normalizes Payment Link paid identity without replacing it with a case id", () => {
    const paidPayload = {
      event: "payment_link.paid",
      payload: {
        payment_link: {
          entity: {
            id: "plink_test_adapter_001",
            amount: 249900,
            currency: "INR",
            reference_id: "rec_adapter_reference_001",
            status: "paid",
            notes: {
              customer_id: "cust_test_001",
              customer_name: "Adapter Customer",
              subscription_id: "sub_test_001",
            },
          },
        },
        payment: {
          entity: {
            id: "pay_test_adapter_paid_001",
            amount: 249900,
            currency: "INR",
            customer_id: "cust_test_001",
            subscription_id: "sub_test_001",
          },
        },
      },
    };
    const raw = JSON.stringify(paidPayload);
    const event = normalizeRazorpayWebhook(paidPayload, raw, "evt_test_adapter_paid_001");
    expect(event).toMatchObject({
      provider: "RAZORPAY",
      type: "PAYMENT_SUCCEEDED",
      data: {
        paymentId: "pay_test_adapter_paid_001",
        amountPaisa: 249900,
        currency: "INR",
      },
      rawMetadata: {
        event: "payment_link.paid",
        paymentLinkId: "plink_test_adapter_001",
        referenceId: "rec_adapter_reference_001",
        paymentLinkStatus: "paid",
      },
    });
  });
});
