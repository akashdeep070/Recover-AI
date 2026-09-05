import type { EvaluationMetrics } from "@/domain/evaluation";
import { buildOverviewAnalytics } from "@/domain/overview-analytics";
import { buildRecoveryTrend } from "@/domain/recovery-trend";
import { DEFAULT_POLICY, type RecoveryPolicyConfig } from "@/domain/types";
import { prisma } from "@/lib/db";

function eventOccurredAt(payload: unknown): Date | undefined {
  if (!payload || typeof payload !== "object" || !("occurredAt" in payload)) return undefined;
  const occurredAt = (payload as { occurredAt?: unknown }).occurredAt;
  if (typeof occurredAt !== "string") return undefined;
  const parsed = new Date(occurredAt);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function eventPaymentId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return undefined;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !("paymentId" in data)) return undefined;
  const paymentId = (data as { paymentId?: unknown }).paymentId;
  return typeof paymentId === "string" ? paymentId : undefined;
}

export async function getPolicyConfig(): Promise<RecoveryPolicyConfig> {
  const policy = await prisma.recoveryPolicy.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  return {
    maxRetries: policy.maxRetries,
    maxContacts: policy.maxContacts,
    minContactIntervalHours: policy.minContactIntervalHours,
    highValueThresholdPaisa: policy.highValueThresholdPaisa,
    minAiConfidence: policy.minAiConfidence,
    stopAfterSuccess: policy.stopAfterSuccess,
    respectOptOut: policy.respectOptOut,
    disputeEscalation: policy.disputeEscalation,
  } satisfies RecoveryPolicyConfig;
}

export async function getOverviewData() {
  const [cases, successEvents, reviews, latestEvaluation] = await Promise.all([
    prisma.recoveryCase.findMany({
      include: {
        customer: true,
        subscription: true,
        actions: { orderBy: { createdAt: "asc" } },
        decisions: { orderBy: { createdAt: "asc" }, select: { action: true } },
        policyEvaluations: {
          orderBy: { createdAt: "asc" },
          select: { outcome: true },
        },
        payment: true,
        providerEvents: { select: { eventType: true, payload: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.providerEvent.findMany({
      where: { eventType: "PAYMENT_SUCCEEDED" },
      select: { payload: true },
    }),
    prisma.humanReview.count({ where: { status: "PENDING" } }),
    prisma.recoveryEvaluationRun.findFirst({
      where: { status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: {
        datasetSize: true,
        completedAt: true,
        baselineMetrics: true,
        recoverAiMetrics: true,
      },
    }),
  ]);
  const revenueAtRiskPaisa = cases
    .filter((item) => !["RECOVERED", "STOPPED"].includes(item.state))
    .reduce((sum, item) => sum + item.amountPaisa, 0);
  const revenueRecoveredPaisa = cases.reduce((sum, item) => sum + item.recoveredAmountPaisa, 0);
  const razorpayTestCases = cases.filter((item) => item.source === "RAZORPAY");
  const razorpayTestRecoveredPaisa = razorpayTestCases.reduce(
    (sum, item) => sum + item.recoveredAmountPaisa,
    0,
  );
  const totalRevenuePaisa = cases.reduce((sum, item) => sum + item.amountPaisa, 0);
  const stateCounts = cases.reduce<Record<string, number>>((counts, item) => {
    counts[item.state] = (counts[item.state] ?? 0) + 1;
    return counts;
  }, {});
  const methodCounts = cases
    .flatMap((item) => item.actions)
    .reduce<Record<string, number>>((counts, action) => {
      counts[action.type] = (counts[action.type] ?? 0) + 1;
      return counts;
    }, {});
  const observedEventTimes = cases
    .flatMap((item) => item.providerEvents)
    .concat(
      successEvents.map((event) => ({ eventType: "PAYMENT_SUCCEEDED", payload: event.payload })),
    )
    .map((event) => eventOccurredAt(event.payload))
    .filter((value): value is Date => value !== undefined)
    .sort((a, b) => a.getTime() - b.getTime());
  const recoveryTrend = buildRecoveryTrend(
    cases
      .filter((item) => item.recoveredAmountPaisa > 0)
      .map((item) => {
        const successEvent = successEvents.find(
          (event) => eventPaymentId(event.payload) === item.paymentId,
        );
        return {
          occurredAt:
            eventOccurredAt(successEvent?.payload) ?? item.payment.recoveredAt ?? item.updatedAt,
          amountPaisa: item.recoveredAmountPaisa,
        };
      }),
    observedEventTimes[0],
  );
  const evaluationSnapshot =
    latestEvaluation?.baselineMetrics && latestEvaluation.recoverAiMetrics
      ? {
          datasetSize: latestEvaluation.datasetSize,
          completedAt: latestEvaluation.completedAt,
          baseline: latestEvaluation.baselineMetrics as unknown as EvaluationMetrics,
          recoverAi: latestEvaluation.recoverAiMetrics as unknown as EvaluationMetrics,
        }
      : null;
  const analytics = buildOverviewAnalytics(
    cases.map((item) => ({
      amountPaisa: item.amountPaisa,
      recoveredAmountPaisa: item.recoveredAmountPaisa,
      state: item.state,
      optedOut: item.customer.optedOut,
      successfulPayments: item.subscription?.successfulPayments ?? 0,
      contactCount: item.contactCount,
      decisions: item.decisions,
      policyEvaluations: item.policyEvaluations,
      actions: item.actions.map((action) => ({ type: action.type, status: action.status })),
    })),
    evaluationSnapshot,
  );
  return {
    revenueAtRiskPaisa,
    revenueRecoveredPaisa,
    razorpayTestRecoveredPaisa,
    razorpayTestRecoveredCases: razorpayTestCases.filter((item) => item.recoveredAmountPaisa > 0)
      .length,
    recoveryRate: totalRevenuePaisa === 0 ? 0 : revenueRecoveredPaisa / totalRevenuePaisa,
    activeRecoveries: cases.filter(
      (item) => !["RECOVERED", "STOPPED", "ESCALATED"].includes(item.state),
    ).length,
    humanReviews: reviews,
    stateCounts,
    methodCounts,
    recoveryTrend,
    analytics,
    recentCases: cases.slice(0, 5),
  };
}

export async function getRecoveries() {
  return prisma.recoveryCase.findMany({
    include: {
      customer: true,
      payment: true,
      decisions: { orderBy: { createdAt: "desc" }, take: 1 },
      actions: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getRecoveryCase(id: string) {
  return prisma.recoveryCase.findUnique({
    where: { id },
    include: {
      customer: true,
      subscription: true,
      payment: true,
      decisions: { orderBy: { createdAt: "desc" } },
      policyEvaluations: { orderBy: { createdAt: "desc" } },
      actions: { orderBy: { createdAt: "desc" } },
      auditEvents: { orderBy: { createdAt: "asc" } },
      humanReview: true,
      providerEvents: { orderBy: { receivedAt: "desc" } },
    },
  });
}

export async function getReviews() {
  return prisma.humanReview.findMany({
    include: {
      recoveryCase: {
        include: {
          customer: true,
          payment: true,
          decisions: { orderBy: { createdAt: "desc" }, take: 1 },
          policyEvaluations: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function getLatestEvaluation() {
  return prisma.recoveryEvaluationRun.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    include: { cases: { orderBy: [{ syntheticCaseId: "asc" }, { strategy: "asc" }] } },
  });
}

export { DEFAULT_POLICY };
