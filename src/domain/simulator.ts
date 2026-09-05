import type { RecoveryContext } from "./types";

export interface HiddenOutcomeBehavior {
  retryOutcomes: [boolean, boolean, boolean];
  paymentLinkRecovery: boolean;
  paymentMethodUpdateRecovery: boolean;
  emailRecovery: boolean;
  whatsappRecovery: boolean;
  spontaneousRecovery: boolean;
}

export interface SyntheticEvaluationCase {
  id: string;
  observable: Omit<RecoveryContext, "caseId" | "now">;
  hidden: HiddenOutcomeBehavior;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

function chance(random: () => number, probability: number): boolean {
  return random() < Math.max(0, Math.min(1, probability));
}

function weightedFailure(random: () => number): string {
  const roll = random();
  if (roll < 0.4) return "INSUFFICIENT_FUNDS";
  if (roll < 0.58) return "EXPIRED_CARD";
  if (roll < 0.7) return "MANDATE_INVALID";
  if (roll < 0.85) return "BANK_DECLINED";
  if (roll < 0.95) return "UNKNOWN";
  return "TECHNICAL_ERROR";
}

export function generateHeldOutDataset(seed = 20_260_823, size = 100): SyntheticEvaluationCase[] {
  const random = mulberry32(seed);
  const amountsRupees = [
    499, 799, 999, 1_499, 2_499, 4_999, 7_999, 12_499, 24_999, 52_000, 75_000,
  ] as const;
  const dataset: SyntheticEvaluationCase[] = [];

  for (let index = 0; index < size; index += 1) {
    const failureReason = weightedFailure(random);
    const successfulPayments = Math.floor(random() * 25);
    const previousRetrySucceeded = chance(random, successfulPayments > 6 ? 0.62 : 0.28);
    const amountPaisa = pick(random, amountsRupees) * 100;
    const optedOut = chance(random, 0.06);
    const disputed = chance(random, 0.05);
    const fraudSignal = chance(random, 0.02);
    const inconsistentState = chance(random, 0.03);
    const subscriptionStatus = chance(random, 0.04) ? "CANCELLED" : "ACTIVE";
    const mandateState =
      failureReason === "EXPIRED_CARD"
        ? "EXPIRED"
        : failureReason === "MANDATE_INVALID"
          ? "INVALID"
          : chance(random, 0.04)
            ? "PENDING"
            : "ACTIVE";
    const preferredChannel = pick(random, ["EMAIL", "WHATSAPP", "EMAIL", "EMAIL"] as const);
    const contactCount = Math.floor(random() * 4);
    const retryCount = Math.floor(random() * 4);
    const providerRetryScheduled =
      failureReason === "INSUFFICIENT_FUNDS" && chance(random, 0.24) && retryCount < 3;
    const recentContact = contactCount > 0 && chance(random, 0.58);
    const stableHistory = Math.min(0.28, successfulPayments * 0.012);

    const retryProbability =
      failureReason === "INSUFFICIENT_FUNDS"
        ? 0.34 + stableHistory + (previousRetrySucceeded ? 0.16 : 0)
        : failureReason === "TECHNICAL_ERROR"
          ? 0.42
          : failureReason === "BANK_DECLINED"
            ? 0.16
            : 0.03;
    const paymentLinkProbability = ["BANK_DECLINED", "UNKNOWN"].includes(failureReason)
      ? 0.9 + stableHistory / 2
      : 0.24;
    const updateProbability = ["EXPIRED_CARD", "MANDATE_INVALID"].includes(failureReason)
      ? 0.9 + stableHistory / 2
      : 0.18;
    const messageProbability = optedOut ? 0 : 0.12 + stableHistory / 3;
    const spontaneousProbability = providerRetryScheduled
      ? 0.58 + stableHistory
      : failureReason === "INSUFFICIENT_FUNDS"
        ? 0.13 + stableHistory / 2
        : 0.05;

    dataset.push({
      id: `heldout_${String(index + 1).padStart(3, "0")}`,
      observable: {
        amountPaisa,
        paymentStatus: "FAILED",
        failureReason,
        retryCount,
        contactCount,
        lastContactAt: recentContact ? "2026-08-23T17:00:00.000Z" : undefined,
        optedOut,
        mandateState,
        subscriptionStatus,
        nextProviderRetryAt: providerRetryScheduled ? "2026-08-24T12:00:00.000Z" : undefined,
        disputed,
        fraudSignal,
        inconsistentState,
        valueSegment:
          amountPaisa > 5_000_000 ? "STRATEGIC" : amountPaisa > 1_500_000 ? "HIGH" : "STANDARD",
        successfulPayments,
        failedPayments: 1 + Math.floor(random() * 5),
        preferredChannel,
        previousRetrySucceeded,
      },
      hidden: {
        retryOutcomes: [
          chance(random, retryProbability),
          chance(random, retryProbability * 0.72),
          chance(random, retryProbability * 0.5),
        ],
        paymentLinkRecovery: chance(random, paymentLinkProbability),
        paymentMethodUpdateRecovery: chance(random, updateProbability),
        emailRecovery: chance(random, messageProbability),
        whatsappRecovery: chance(random, messageProbability + 0.05),
        spontaneousRecovery: chance(random, spontaneousProbability),
      },
    });
  }
  return dataset;
}
