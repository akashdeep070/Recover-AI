import { PageHeader } from "@/components/page-header";
import { RecoveryLab, type LabCase, type LabResult } from "@/components/recovery-lab";
import { generateHeldOutDataset } from "@/domain/simulator";
import type { EvaluationMetrics } from "@/domain/evaluation";
import { getLatestEvaluation } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const latest = await getLatestEvaluation();
  const dataset = generateHeldOutDataset();
  const revenueAtRiskPaisa = dataset.reduce((sum, item) => sum + item.observable.amountPaisa, 0);
  let initial: LabResult | null = null;
  if (latest?.baselineMetrics && latest.recoverAiMetrics) {
    const baseline = latest.baselineMetrics as unknown as EvaluationMetrics;
    const recoverAi = latest.recoverAiMetrics as unknown as EvaluationMetrics;
    const persistedCases: LabCase[] = latest.cases.map((item) => {
      const outcome = item.outcome as Record<string, unknown>;
      return {
        caseId: item.syntheticCaseId,
        strategy: item.strategy,
        amountPaisa: item.amountPaisa,
        failureReason: String(
          (item.observableContext as Record<string, unknown>).failureReason ?? "UNKNOWN",
        ),
        decision: item.decision as LabCase["decision"],
        policy: item.policy as LabCase["policy"],
        recovered: outcome.recovered === true,
        recoveredPaisa: item.recoveredPaisa,
        contacts: item.contacts,
        escalated: item.escalated,
        policyViolations: item.policyViolations,
        duplicateActions: item.duplicateActions,
        outcome: String(outcome.status ?? "UNKNOWN"),
        timeline: Array.isArray(outcome.timeline) ? (outcome.timeline as LabCase["timeline"]) : [],
        observable: item.observableContext as Record<string, unknown>,
      };
    });
    initial = {
      id: latest.id,
      seed: latest.seed,
      datasetSize: latest.datasetSize,
      baseline: {
        metrics: baseline,
        cases: persistedCases.filter((item) => item.strategy === "BASELINE"),
      },
      recoverAi: {
        metrics: recoverAi,
        cases: persistedCases.filter((item) => item.strategy === "RECOVER_AI"),
      },
      comparison: {
        incrementalRevenuePaisa: recoverAi.revenueRecoveredPaisa - baseline.revenueRecoveredPaisa,
        recoveryRateUpliftPoints: (recoverAi.recoveryRate - baseline.recoveryRate) * 100,
        contactDelta: recoverAi.customerContacts - baseline.customerContacts,
      },
    };
  }
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Synthetic held-out evaluation"
        title="Recovery Lab"
        description="Compare a fixed recovery playbook with policy-governed contextual decisions, then deliberately break dependencies and inspect the safe response."
      />
      <RecoveryLab initial={initial} initialRevenueAtRiskPaisa={revenueAtRiskPaisa} />
    </div>
  );
}
