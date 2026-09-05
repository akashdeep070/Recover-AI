import { runRecoveryEvaluation, type EvaluationMetrics } from "@/domain/evaluation";
import type { RecoveryPolicyConfig } from "@/domain/types";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPolicyConfig } from "./queries";

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function runAndPersistEvaluation(seed = 20_260_823, size = 100) {
  const policy: RecoveryPolicyConfig = await getPolicyConfig();
  const run = await prisma.recoveryEvaluationRun.create({
    data: { seed, datasetSize: size, status: "RUNNING" },
  });
  try {
    const result = await runRecoveryEvaluation(seed, size, policy);
    const rows = [...result.baseline.cases, ...result.recoverAi.cases].map((item) => ({
      runId: run.id,
      syntheticCaseId: item.caseId,
      strategy: item.strategy,
      observableContext: json(item.observable),
      hiddenBehavior: json(item.hidden),
      decision: json(item.decision),
      policy: json(item.policy),
      outcome: json({ status: item.outcome, timeline: item.timeline, recovered: item.recovered }),
      amountPaisa: item.amountPaisa,
      recoveredPaisa: item.recoveredPaisa,
      contacts: item.contacts,
      escalated: item.escalated,
      policyViolations: item.policyViolations,
      duplicateActions: item.duplicateActions,
    }));
    await prisma.$transaction([
      prisma.evaluationCase.createMany({ data: rows }),
      prisma.recoveryEvaluationRun.update({
        where: { id: run.id },
        data: {
          status: "COMPLETED",
          baselineMetrics: json(result.baseline.metrics),
          recoverAiMetrics: json(result.recoverAi.metrics),
          completedAt: new Date(),
        },
      }),
    ]);
    return { id: run.id, ...result };
  } catch (error) {
    await prisma.recoveryEvaluationRun.update({
      where: { id: run.id },
      data: { status: "FAILED" },
    });
    throw error;
  }
}

export function parseMetrics(value: Prisma.JsonValue | null): EvaluationMetrics | null {
  return value as EvaluationMetrics | null;
}
