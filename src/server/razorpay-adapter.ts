import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { paymentEventSchema, type PaymentEvent } from "@/domain/types";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function verifyRazorpaySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeRazorpayWebhook(
  payload: unknown,
  rawBody: string,
  eventIdHeader?: string,
): PaymentEvent {
  const root = object(payload);
  const eventName = string(root.event);
  const payloadRoot = object(root.payload);
  const payment = object(object(payloadRoot.payment).entity);
  const paymentLink = object(object(payloadRoot.payment_link).entity);
  const subscription = object(object(payloadRoot.subscription).entity);
  const eventType =
    eventName === "payment.failed"
      ? "PAYMENT_FAILED"
      : ["payment.captured", "payment.authorized", "payment_link.paid"].includes(eventName)
        ? "PAYMENT_SUCCEEDED"
        : eventName === "subscription.cancelled"
          ? "SUBSCRIPTION_CANCELLED"
          : eventName === "subscription.halted"
            ? "MANDATE_INVALIDATED"
            : null;
  if (!eventType)
    throw new Error(`Unsupported Razorpay event: ${eventName || "missing event name"}`);

  const paymentNotes = object(payment.notes);
  const paymentLinkNotes = object(paymentLink.notes);
  const notes = { ...paymentLinkNotes, ...paymentNotes };
  const customerId = string(
    payment.customer_id,
    string(notes.customer_id, "razorpay_customer_unknown"),
  );
  const subscriptionId = string(
    payment.subscription_id,
    string(subscription.id, string(notes.subscription_id, `subscription_${customerId}`)),
  );
  const paymentLinkId = string(paymentLink.id);
  const paymentId = string(
    payment.id,
    string(notes.payment_id, paymentLinkId ? `payment_link_${paymentLinkId}` : ""),
  );
  if (!paymentId) throw new Error("Razorpay event did not contain a payment identifier.");
  const createdAt = number(
    payment.created_at,
    number(paymentLink.created_at, Math.floor(Date.now() / 1000)),
  );
  const providerEventId =
    eventIdHeader ||
    string(root.id) ||
    `rzp_evt_${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;

  return paymentEventSchema.parse({
    provider: "RAZORPAY",
    providerEventId,
    type: eventType,
    occurredAt: new Date(createdAt * 1000).toISOString(),
    data: {
      paymentId,
      providerPaymentId: paymentId,
      amountPaisa: Math.max(
        1,
        number(payment.amount, number(paymentLink.amount, number(notes.amount_paisa, 1))),
      ),
      currency: string(payment.currency, string(paymentLink.currency, "INR")),
      failureReason: string(payment.error_reason, string(payment.error_code, "UNKNOWN")),
      customerId,
      customerName: string(notes.customer_name, "Razorpay Test Customer"),
      email: typeof payment.email === "string" ? payment.email : undefined,
      phoneMasked:
        typeof payment.contact === "string" ? `••••${payment.contact.slice(-4)}` : undefined,
      subscriptionId,
      providerSubscriptionId: subscriptionId,
      subscriptionStatus: eventType === "SUBSCRIPTION_CANCELLED" ? "CANCELLED" : "ACTIVE",
      mandateState: eventType === "MANDATE_INVALIDATED" ? "INVALID" : "ACTIVE",
      subscriptionAgeMonths: number(notes.subscription_age_months, 1),
      successfulPayments: number(notes.successful_payments, 0),
      failedPayments: number(notes.failed_payments, 1),
      retryCount: number(notes.retry_count, 0),
      contactCount: number(notes.contact_count, 0),
      preferredChannel: string(notes.preferred_channel, "EMAIL"),
      optedOut: notes.opted_out === true,
      valueSegment: string(notes.value_segment, "STANDARD"),
      previousRetrySucceeded: notes.previous_retry_succeeded === true,
      disputed: notes.disputed === true,
      fraudSignal: notes.fraud_signal === true,
      inconsistentState: notes.inconsistent_state === true,
    },
    rawMetadata: {
      event: eventName,
      accountId: root.account_id,
      testMode: true,
      paymentLinkId: paymentLinkId || undefined,
      referenceId: string(paymentLink.reference_id, string(notes.reference_id)) || undefined,
      paymentLinkStatus: string(paymentLink.status) || undefined,
      paymentLinkAmountPaisa: number(paymentLink.amount, 0) || undefined,
      paymentLinkCurrency: string(paymentLink.currency) || undefined,
      paymentLinkPaymentId: string(payment.id) || undefined,
    },
  });
}
