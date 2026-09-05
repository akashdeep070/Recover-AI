import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { SandboxActionExecutor } from "../src/domain/action-executor";
import {
  DeterministicDecisionProvider,
  type RecoveryDecisionProvider,
} from "../src/domain/decision-provider";
import { RecoveryEngine } from "../src/domain/recovery-engine";
import type { PaymentEvent, RecoveryDecision } from "../src/domain/types";
import { PrismaRecoveryStore } from "../src/server/prisma-recovery-store";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to seed RecoverAI.");
const db = new PrismaClient({ adapter: new PrismaPg(connectionString) });
const store = new PrismaRecoveryStore(db);
const defaultProvider = new DeterministicDecisionProvider();

class StaticDecisionProvider implements RecoveryDecisionProvider {
  readonly name = "seeded-contextual-provider";
  constructor(private readonly value: RecoveryDecision) {}
  async decide(): Promise<RecoveryDecision> {
    return this.value;
  }
}

interface SeedOverrides extends Partial<PaymentEvent["data"]> {
  id: string;
  name: string;
  amountRupees: number;
  failureReason: string;
}

function event(overrides: SeedOverrides): PaymentEvent {
  const { id, name, amountRupees, failureReason, ...data } = overrides;
  return {
    provider: "SIMULATOR",
    providerEventId: `evt_demo_${id}_failed`,
    type: "PAYMENT_FAILED",
    occurredAt: "2026-08-23T09:00:00.000Z",
    data: {
      paymentId: `pay_demo_${id}`,
      providerPaymentId: `pay_test_${id}`,
      amountPaisa: amountRupees * 100,
      currency: "INR",
      failureReason,
      customerId: `cus_demo_${id}`,
      customerName: name,
      email: `${id}@example.test`,
      phoneMasked: "+91 •••••• 00" + String(id.length).padStart(2, "0"),
      subscriptionId: `sub_demo_${id}`,
      providerSubscriptionId: `sub_test_${id}`,
      subscriptionStatus: "ACTIVE",
      mandateState: "ACTIVE",
      subscriptionAgeMonths: 10,
      successfulPayments: 8,
      failedPayments: 1,
      retryCount: 0,
      contactCount: 0,
      preferredChannel: "EMAIL",
      optedOut: false,
      valueSegment:
        amountRupees > 50_000 ? "STRATEGIC" : amountRupees > 15_000 ? "HIGH" : "STANDARD",
      previousRetrySucceeded: false,
      disputed: false,
      fraudSignal: false,
      inconsistentState: false,
      ...data,
    },
    rawMetadata: { synthetic: true, fixture: id },
  };
}

async function processEvent(
  paymentEvent: PaymentEvent,
  provider: RecoveryDecisionProvider = defaultProvider,
  executor = new SandboxActionExecutor(),
) {
  const engine = new RecoveryEngine(store, provider, executor);
  return engine.process(paymentEvent);
}

async function main() {
  await db.recoveryPolicy.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });

  const existingDemoCases = await db.recoveryCase.count({
    where: { id: { startsWith: "case_pay_demo_" } },
  });
  if (existingDemoCases >= 12) {
    console.log(`Seed already present: ${existingDemoCases} demo cases. No workflows replayed.`);
    return;
  }

  await processEvent(
    event({
      id: "smart_retry",
      name: "Aarav Shah",
      amountRupees: 4_999,
      failureReason: "INSUFFICIENT_FUNDS",
      successfulPayments: 13,
      previousRetrySucceeded: true,
    }),
  );
  await processEvent(
    event({
      id: "expired_method",
      name: "Meera Iyer",
      amountRupees: 7_499,
      failureReason: "EXPIRED_CARD",
      mandateState: "EXPIRED",
    }),
  );
  await processEvent(
    event({
      id: "intentional_wait",
      name: "Vikram Rao",
      amountRupees: 2_499,
      failureReason: "INSUFFICIENT_FUNDS",
      contactCount: 1,
      lastContactAt: "2026-08-23T04:00:00.000Z",
      nextProviderRetryAt: "2026-08-24T09:00:00.000Z",
      successfulPayments: 18,
    }),
  );
  await processEvent(
    event({
      id: "high_value",
      name: "Orion Systems",
      amountRupees: 85_000,
      failureReason: "INSUFFICIENT_FUNDS",
      valueSegment: "STRATEGIC",
    }),
    new StaticDecisionProvider({
      action: "SMART_RETRY",
      confidence: 0.89,
      reasonCode: "STRONG_PAYMENT_HISTORY",
      explanation: "A bounded retry is likely to resolve a temporary balance failure.",
      recommendedDelayHours: 12,
    }),
  );
  await processEvent(
    event({
      id: "opt_out",
      name: "Nisha Gupta",
      amountRupees: 1_999,
      failureReason: "BANK_DECLINED",
      optedOut: true,
      preferredChannel: "NONE",
    }),
  );
  await processEvent(
    event({
      id: "billing_dispute",
      name: "Kiteworks Labs",
      amountRupees: 18_500,
      failureReason: "BANK_DECLINED",
      disputed: true,
      valueSegment: "HIGH",
    }),
    new StaticDecisionProvider({
      action: "SEND_PAYMENT_LINK",
      confidence: 0.86,
      reasonCode: "ALTERNATE_PAYMENT_PATH",
      explanation: "A secure alternate payment path may resolve the failed instrument.",
    }),
  );
  await processEvent(
    event({
      id: "max_attempts",
      name: "Kabir Singh",
      amountRupees: 3_299,
      failureReason: "INSUFFICIENT_FUNDS",
      retryCount: 3,
      contactCount: 3,
      failedPayments: 4,
    }),
  );

  const manualEvent = event({
    id: "manual_payment",
    name: "Ananya Bose",
    amountRupees: 9_999,
    failureReason: "INSUFFICIENT_FUNDS",
    nextProviderRetryAt: "2026-08-24T10:00:00.000Z",
  });
  await processEvent(manualEvent);
  await processEvent({
    ...manualEvent,
    providerEventId: "evt_demo_manual_payment_succeeded",
    type: "PAYMENT_SUCCEEDED",
    occurredAt: "2026-08-23T12:00:00.000Z",
  });

  await processEvent(
    event({
      id: "provider_failure",
      name: "Devika Menon",
      amountRupees: 5_499,
      failureReason: "BANK_DECLINED",
    }),
    defaultProvider,
    new SandboxActionExecutor("MESSAGE_PROVIDER_DOWN"),
  );

  const duplicateEvent = event({
    id: "duplicate_webhook",
    name: "Rohan Das",
    amountRupees: 6_499,
    failureReason: "INSUFFICIENT_FUNDS",
    previousRetrySucceeded: true,
  });
  await processEvent(duplicateEvent);
  await processEvent(duplicateEvent);

  await processEvent(
    event({
      id: "low_confidence",
      name: "Sana Retail",
      amountRupees: 12_000,
      failureReason: "UNKNOWN",
      valueSegment: "HIGH",
    }),
  );

  const paymentLinkEvent = event({
    id: "payment_link",
    name: "Arjun Malhotra",
    amountRupees: 14_999,
    failureReason: "BANK_DECLINED",
    successfulPayments: 11,
  });
  await processEvent(paymentLinkEvent);
  await processEvent({
    ...paymentLinkEvent,
    providerEventId: "evt_demo_payment_link_succeeded",
    type: "PAYMENT_SUCCEEDED",
    occurredAt: "2026-08-23T15:00:00.000Z",
  });

  const counts = await Promise.all([
    db.recoveryCase.count(),
    db.auditEvent.count(),
    db.recoveryAction.count(),
    db.humanReview.count(),
  ]);
  console.log(
    `Seed complete: ${counts[0]} cases, ${counts[1]} audit events, ${counts[2]} actions, ${counts[3]} reviews.`,
  );
}

main()
  .finally(async () => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
