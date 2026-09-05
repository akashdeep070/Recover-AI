import { describe, expect, it } from "vitest";
import type { EvaluationMetrics } from "../evaluation";
import { buildOverviewAnalytics, type OverviewAnalyticsCase } from "../overview-analytics";

function recoveryCase(overrides: Partial<OverviewAnalyticsCase> = {}): OverviewAnalyticsCase {
  return {
    amountPaisa: 1_000_000,
    recoveredAmountPaisa: 0,
    state: "WAITING",
    optedOut: false,
    successfulPayments: 5,
    contactCount: 0,
    decisions: [{ action: "WAIT" }],
    policyEvaluations: [{ outcome: "ALLOW" }],
    actions: [{ type: "WAIT", status: "EXECUTED" }],
    ...overrides,
  };
}

function metrics(overrides: Partial<EvaluationMetrics> = {}): EvaluationMetrics {
  return {
    revenueAtRiskPaisa: 10_000_000,
    revenueRecoveredPaisa: 4_000_000,
    recoveredCases: 4,
    totalCases: 10,
    recoveryRate: 0.4,
    customerContacts: 5,
    contactsPerTenThousandRecovered: 1.25,
    humanEscalations: 1,
    automationRate: 0.9,
    policyViolations: 0,
    duplicateActions: 0,
    ...overrides,
  };
}

describe("overview analytics", () => {
  it("builds a nested control funnel and attributes observed recovered money", () => {
    const analytics = buildOverviewAnalytics([
      recoveryCase({
        recoveredAmountPaisa: 1_000_000,
        state: "RECOVERED",
        successfulPayments: 12,
        decisions: [{ action: "SMART_RETRY" }],
        actions: [{ type: "SMART_RETRY", status: "EXECUTED" }],
      }),
      recoveryCase({
        amountPaisa: 2_000_000,
        recoveredAmountPaisa: 2_000_000,
        state: "RECOVERED",
        successfulPayments: 2,
        actions: [{ type: "WAIT", status: "EXECUTED" }],
      }),
      recoveryCase({
        optedOut: true,
        state: "STOPPED",
        decisions: [{ action: "STOP" }],
        policyEvaluations: [{ outcome: "BLOCK" }],
        actions: [],
      }),
    ]);

    expect(analytics.funnel.map((stage) => stage.count)).toEqual([3, 3, 3, 2, 2]);
    expect(analytics.recoveredMix).toMatchObject([
      { id: "SMART_RETRY", amountPaisa: 1_000_000, cases: 1 },
      { id: "CUSTOMER_LED", amountPaisa: 0, cases: 0 },
      { id: "MANUAL_PROVIDER", amountPaisa: 2_000_000, cases: 1 },
    ]);
    expect(analytics.recoveredMix.reduce((sum, item) => sum + item.amountPaisa, 0)).toBe(3_000_000);
  });

  it("calculates customer-friction protection without double counting cases", () => {
    const analytics = buildOverviewAnalytics([
      recoveryCase({ contactCount: 2, decisions: [{ action: "SEND_EMAIL" }] }),
      recoveryCase({ optedOut: true, decisions: [{ action: "STOP" }] }),
      recoveryCase({ decisions: [{ action: "WAIT" }] }),
    ]);

    expect(analytics.friction).toMatchObject({
      recordedContacts: 2,
      noContactDecisions: 2,
      optedOutCustomers: 1,
      protectedCases: 2,
    });
  });

  it("derives the latest persisted experiment comparison and handles empty inputs", () => {
    const analytics = buildOverviewAnalytics([], {
      datasetSize: 100,
      completedAt: new Date("2026-08-24T00:00:00.000Z"),
      baseline: metrics(),
      recoverAi: metrics({
        revenueRecoveredPaisa: 5_250_000,
        recoveryRate: 0.525,
        customerContacts: 3,
      }),
    });

    expect(analytics.funnel.every((stage) => stage.shareOfDetected === 0)).toBe(true);
    expect(analytics.friction.contactsPerTenThousandRecovered).toBe(0);
    expect(analytics.latestEvaluation).toMatchObject({
      incrementalRevenuePaisa: 1_250_000,
      recoveryRateUpliftPoints: 12.5,
      contactDelta: -2,
    });
  });
});
