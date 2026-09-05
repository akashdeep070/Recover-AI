import { describe, expect, it } from "vitest";
import { calculateMetrics, runRecoveryEvaluation } from "../evaluation";
import { generateHeldOutDataset } from "../simulator";

describe("Recovery Lab evaluation", () => {
  it("generates exactly 100 reproducible held-out cases", () => {
    const first = generateHeldOutDataset(20_260_823, 100);
    const second = generateHeldOutDataset(20_260_823, 100);
    expect(first).toHaveLength(100);
    expect(first).toEqual(second);
    expect(generateHeldOutDataset(20_260_824, 100)).not.toEqual(first);
  });

  it("keeps hidden outcome behavior outside observable context", () => {
    const item = generateHeldOutDataset()[0]!;
    expect(item.observable).not.toHaveProperty("hidden");
    expect(item.observable).not.toHaveProperty("retryOutcomes");
    expect(item.hidden).toHaveProperty("retryOutcomes");
  });

  it("runs baseline and RecoverAI on identical case IDs and amounts", async () => {
    const result = await runRecoveryEvaluation();
    expect(result.baseline.cases.map((item) => [item.caseId, item.amountPaisa])).toEqual(
      result.recoverAi.cases.map((item) => [item.caseId, item.amountPaisa]),
    );
  });

  it("calculates a deterministic positive contextual uplift for the documented seed", async () => {
    const first = await runRecoveryEvaluation();
    const second = await runRecoveryEvaluation();
    expect(first.comparison).toEqual(second.comparison);
    expect(first.comparison.incrementalRevenuePaisa).toBe(5_399_000);
    expect(first.comparison.contactDelta).toBe(-4);
  });

  it("reports authoritative zero policy violations and duplicate actions", async () => {
    const result = await runRecoveryEvaluation();
    expect(result.baseline.metrics.policyViolations).toBe(0);
    expect(result.recoverAi.metrics.policyViolations).toBe(0);
    expect(result.baseline.metrics.duplicateActions).toBe(0);
    expect(result.recoverAi.metrics.duplicateActions).toBe(0);
  });

  it("calculates money-weighted recovery and friction without divide-by-zero", () => {
    const metrics = calculateMetrics([]);
    expect(metrics).toMatchObject({
      revenueAtRiskPaisa: 0,
      revenueRecoveredPaisa: 0,
      recoveryRate: 0,
      contactsPerTenThousandRecovered: 0,
    });
  });
});
