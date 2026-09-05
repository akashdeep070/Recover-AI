import type { EvaluationMetrics } from "./evaluation";
import type { PolicyOutcome, RecoveryAction, RecoveryState } from "./types";

type ActionStatus = "SCHEDULED" | "PENDING" | "EXECUTED" | "FAILED" | "CANCELLED" | "NO_OP";

export interface OverviewAnalyticsCase {
  amountPaisa: number;
  recoveredAmountPaisa: number;
  state: RecoveryState;
  optedOut: boolean;
  successfulPayments: number;
  contactCount: number;
  decisions: Array<{ action: RecoveryAction }>;
  policyEvaluations: Array<{ outcome: PolicyOutcome }>;
  actions: Array<{ type: RecoveryAction; status: ActionStatus }>;
}

export interface OverviewEvaluationSnapshot {
  datasetSize: number;
  completedAt: Date | null;
  baseline: EvaluationMetrics;
  recoverAi: EvaluationMetrics;
}

export interface OverviewAnalytics {
  funnel: Array<{
    id: string;
    label: string;
    count: number;
    amountPaisa: number;
    shareOfDetected: number;
    conversionFromPrevious: number;
  }>;
  recoveredMix: Array<{
    id: "SMART_RETRY" | "CUSTOMER_LED" | "MANUAL_PROVIDER";
    label: string;
    amountPaisa: number;
    cases: number;
    share: number;
    tone: "green" | "blue" | "pink";
  }>;
  paymentHistory: Array<{
    id: string;
    label: string;
    totalCases: number;
    recoveredCases: number;
    recoveryRate: number;
  }>;
  actionHealth: {
    total: number;
    executed: number;
    scheduled: number;
    failed: number;
    safelyClosed: number;
  };
  friction: {
    recordedContacts: number;
    noContactDecisions: number;
    optedOutCustomers: number;
    protectedCases: number;
    contactsPerTenThousandRecovered: number;
  };
  latestEvaluation: null | {
    datasetSize: number;
    completedAt: Date | null;
    incrementalRevenuePaisa: number;
    recoveryRateUpliftPoints: number;
    contactDelta: number;
    baselineRecoveredPaisa: number;
    recoverAiRecoveredPaisa: number;
    policyViolations: number;
    duplicateActions: number;
  };
}

const customerContactActions = new Set<RecoveryAction>([
  "REQUEST_PAYMENT_METHOD_UPDATE",
  "SEND_WHATSAPP",
  "SEND_EMAIL",
  "SEND_PAYMENT_LINK",
]);

const noContactActions = new Set<RecoveryAction>(["WAIT", "ESCALATE", "STOP"]);

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function totalAmount(cases: OverviewAnalyticsCase[]): number {
  return cases.reduce((sum, item) => sum + item.amountPaisa, 0);
}

export function buildOverviewAnalytics(
  cases: OverviewAnalyticsCase[],
  evaluation: OverviewEvaluationSnapshot | null = null,
): OverviewAnalytics {
  const detected = cases;
  const decided = detected.filter((item) => item.decisions.length > 0);
  const governed = decided.filter((item) => item.policyEvaluations.length > 0);
  const authorized = governed.filter((item) =>
    item.policyEvaluations.some((policy) => policy.outcome === "ALLOW"),
  );
  const acted = authorized.filter((item) => item.actions.length > 0);
  const recoveredAfterAction = acted.filter((item) => item.recoveredAmountPaisa > 0);
  const funnelCases = [detected, decided, governed, acted, recoveredAfterAction];
  const funnelLabels = [
    ["DETECTED", "Payment failures"],
    ["DECIDED", "Decision produced"],
    ["GOVERNED", "Policy evaluated"],
    ["ACTED", "Bounded action"],
    ["RECOVERED", "Action-attributed recovery"],
  ] as const;

  const recoveredTotal = cases.reduce((sum, item) => sum + item.recoveredAmountPaisa, 0);
  const recoveredBuckets = {
    SMART_RETRY: { amountPaisa: 0, cases: 0 },
    CUSTOMER_LED: { amountPaisa: 0, cases: 0 },
    MANUAL_PROVIDER: { amountPaisa: 0, cases: 0 },
  };
  cases
    .filter((item) => item.recoveredAmountPaisa > 0)
    .forEach((item) => {
      const executedAction = [...item.actions]
        .reverse()
        .find((action) => action.status === "EXECUTED");
      const bucket =
        executedAction?.type === "SMART_RETRY"
          ? "SMART_RETRY"
          : executedAction && customerContactActions.has(executedAction.type)
            ? "CUSTOMER_LED"
            : "MANUAL_PROVIDER";
      recoveredBuckets[bucket].amountPaisa += item.recoveredAmountPaisa;
      recoveredBuckets[bucket].cases += 1;
    });

  const paymentHistoryBuckets = [
    { id: "LOW", label: "0–3 prior payments", min: 0, max: 3 },
    { id: "ESTABLISHED", label: "4–9 prior payments", min: 4, max: 9 },
    { id: "LOYAL", label: "10+ prior payments", min: 10, max: Number.POSITIVE_INFINITY },
  ];

  const allActions = cases.flatMap((item) => item.actions);
  const recordedContacts = cases.reduce((sum, item) => sum + item.contactCount, 0);
  const noContactDecisions = cases.filter((item) => {
    const latest = item.decisions.at(-1);
    return latest ? noContactActions.has(latest.action) : false;
  }).length;
  const protectedCases = cases.filter((item) => {
    const latest = item.decisions.at(-1);
    return item.optedOut || (latest ? noContactActions.has(latest.action) : false);
  }).length;

  return {
    funnel: funnelCases.map((stageCases, index) => ({
      id: funnelLabels[index][0],
      label: funnelLabels[index][1],
      count: stageCases.length,
      amountPaisa: totalAmount(stageCases),
      shareOfDetected: ratio(stageCases.length, detected.length),
      conversionFromPrevious:
        index === 0 ? 1 : ratio(stageCases.length, funnelCases[index - 1].length),
    })),
    recoveredMix: [
      {
        id: "SMART_RETRY",
        label: "Smart retry",
        ...recoveredBuckets.SMART_RETRY,
        share: ratio(recoveredBuckets.SMART_RETRY.amountPaisa, recoveredTotal),
        tone: "green",
      },
      {
        id: "CUSTOMER_LED",
        label: "Customer-led",
        ...recoveredBuckets.CUSTOMER_LED,
        share: ratio(recoveredBuckets.CUSTOMER_LED.amountPaisa, recoveredTotal),
        tone: "blue",
      },
      {
        id: "MANUAL_PROVIDER",
        label: "Manual / provider",
        ...recoveredBuckets.MANUAL_PROVIDER,
        share: ratio(recoveredBuckets.MANUAL_PROVIDER.amountPaisa, recoveredTotal),
        tone: "pink",
      },
    ],
    paymentHistory: paymentHistoryBuckets.map((bucket) => {
      const bucketCases = cases.filter(
        (item) => item.successfulPayments >= bucket.min && item.successfulPayments <= bucket.max,
      );
      const recoveredCases = bucketCases.filter((item) => item.recoveredAmountPaisa > 0).length;
      return {
        id: bucket.id,
        label: bucket.label,
        totalCases: bucketCases.length,
        recoveredCases,
        recoveryRate: ratio(recoveredCases, bucketCases.length),
      };
    }),
    actionHealth: {
      total: allActions.length,
      executed: allActions.filter((action) => action.status === "EXECUTED").length,
      scheduled: allActions.filter((action) => ["SCHEDULED", "PENDING"].includes(action.status))
        .length,
      failed: allActions.filter((action) => action.status === "FAILED").length,
      safelyClosed: allActions.filter((action) => ["CANCELLED", "NO_OP"].includes(action.status))
        .length,
    },
    friction: {
      recordedContacts,
      noContactDecisions,
      optedOutCustomers: cases.filter((item) => item.optedOut).length,
      protectedCases,
      contactsPerTenThousandRecovered:
        recoveredTotal === 0 ? 0 : recordedContacts / (recoveredTotal / 1_000_000),
    },
    latestEvaluation: evaluation
      ? {
          datasetSize: evaluation.datasetSize,
          completedAt: evaluation.completedAt,
          incrementalRevenuePaisa:
            evaluation.recoverAi.revenueRecoveredPaisa - evaluation.baseline.revenueRecoveredPaisa,
          recoveryRateUpliftPoints:
            (evaluation.recoverAi.recoveryRate - evaluation.baseline.recoveryRate) * 100,
          contactDelta:
            evaluation.recoverAi.customerContacts - evaluation.baseline.customerContacts,
          baselineRecoveredPaisa: evaluation.baseline.revenueRecoveredPaisa,
          recoverAiRecoveredPaisa: evaluation.recoverAi.revenueRecoveredPaisa,
          policyViolations: evaluation.recoverAi.policyViolations,
          duplicateActions: evaluation.recoverAi.duplicateActions,
        }
      : null,
  };
}
