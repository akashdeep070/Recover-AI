import { DeterministicDecisionProvider, validateDecision } from "./decision-provider";
import { evaluatePolicy } from "./policy-engine";
import { generateHeldOutDataset, type SyntheticEvaluationCase } from "./simulator";
import {
  DEFAULT_POLICY,
  type PolicyResult,
  type RecoveryAction,
  type RecoveryContext,
  type RecoveryDecision,
  type RecoveryPolicyConfig,
} from "./types";

export interface EvaluationCaseResult {
  caseId: string;
  strategy: "BASELINE" | "RECOVER_AI";
  amountPaisa: number;
  failureReason: string;
  decision: RecoveryDecision;
  policy: PolicyResult;
  recovered: boolean;
  recoveredPaisa: number;
  contacts: number;
  escalated: boolean;
  policyViolations: number;
  duplicateActions: number;
  outcome: string;
  timeline: Array<{ step: string; detail: string }>;
  observable: SyntheticEvaluationCase["observable"];
  hidden: SyntheticEvaluationCase["hidden"];
}

export interface EvaluationMetrics {
  revenueAtRiskPaisa: number;
  revenueRecoveredPaisa: number;
  recoveredCases: number;
  totalCases: number;
  recoveryRate: number;
  customerContacts: number;
  contactsPerTenThousandRecovered: number;
  humanEscalations: number;
  automationRate: number;
  policyViolations: number;
  duplicateActions: number;
}

export interface RecoveryEvaluation {
  seed: number;
  datasetSize: number;
  baseline: { metrics: EvaluationMetrics; cases: EvaluationCaseResult[] };
  recoverAi: { metrics: EvaluationMetrics; cases: EvaluationCaseResult[] };
  comparison: {
    incrementalRevenuePaisa: number;
    recoveryRateUpliftPoints: number;
    contactDelta: number;
  };
}

const NOW = "2026-08-23T20:00:00.000Z";

function decision(
  action: RecoveryAction,
  reasonCode: string,
  explanation: string,
  confidence = 1,
): RecoveryDecision {
  return { action, confidence, reasonCode, explanation };
}

function outcomeForAction(
  item: SyntheticEvaluationCase,
  action: RecoveryAction,
  retryAttempt: number,
): boolean {
  switch (action) {
    case "WAIT":
      return item.hidden.spontaneousRecovery;
    case "SMART_RETRY":
      return item.hidden.retryOutcomes[Math.min(retryAttempt, 2)];
    case "REQUEST_PAYMENT_METHOD_UPDATE":
      return item.hidden.paymentMethodUpdateRecovery;
    case "SEND_PAYMENT_LINK":
      return item.hidden.paymentLinkRecovery;
    case "SEND_EMAIL":
      return item.hidden.emailRecovery;
    case "SEND_WHATSAPP":
      return item.hidden.whatsappRecovery;
    default:
      return false;
  }
}

function evaluateBaselineCase(
  item: SyntheticEvaluationCase,
  policyConfig: RecoveryPolicyConfig,
): EvaluationCaseResult {
  const context: RecoveryContext = { ...item.observable, caseId: item.id, now: NOW };
  const timeline: EvaluationCaseResult["timeline"] = [
    { step: "Detected", detail: item.observable.failureReason },
    { step: "Wait", detail: "Fixed playbook waited 24 hours." },
  ];
  const sequence: RecoveryDecision[] = [
    decision("SMART_RETRY", "BASELINE_RETRY_1", "Fixed playbook retry after 24 hours."),
    decision("SEND_EMAIL", "BASELINE_STANDARD_EMAIL", "Fixed standard recovery email."),
    decision("SMART_RETRY", "BASELINE_RETRY_2", "Fixed second retry after email."),
  ];
  let recovered = false;
  let contacts = 0;
  let escalated = false;
  let retryAttempt = context.retryCount;
  let lastPolicy = evaluatePolicy(context, sequence[0], policyConfig);
  let lastDecision = sequence[0];

  if (item.hidden.spontaneousRecovery) {
    recovered = true;
    timeline.push({ step: "Observed", detail: "Payment recovered during the fixed wait window." });
  }

  for (const proposed of sequence) {
    if (recovered) break;
    lastDecision = proposed;
    const stepContext: RecoveryContext = {
      ...context,
      retryCount: retryAttempt,
      contactCount: context.contactCount + contacts,
      lastContactAt: contacts > 0 ? NOW : context.lastContactAt,
    };
    lastPolicy = evaluatePolicy(stepContext, proposed, policyConfig);
    timeline.push({
      step: "Policy",
      detail: `${proposed.action}: ${lastPolicy.outcome} (${lastPolicy.reasonCode})`,
    });
    if (lastPolicy.outcome === "ESCALATE") {
      escalated = true;
      break;
    }
    if (lastPolicy.outcome === "BLOCK") continue;
    if (proposed.action === "SEND_EMAIL") contacts += 1;
    // The baseline retry happens after its fixed 24-hour wait, so it consumes the
    // next hidden retry window. RecoverAI can select the earlier contextual window.
    const success = outcomeForAction(
      item,
      proposed.action,
      proposed.action === "SMART_RETRY" ? retryAttempt + 1 : retryAttempt,
    );
    if (proposed.action === "SMART_RETRY") retryAttempt += 1;
    timeline.push({
      step: "Outcome",
      detail: success
        ? `${proposed.action} recovered the payment.`
        : `${proposed.action} did not recover the payment.`,
    });
    recovered = success;
  }

  return {
    caseId: item.id,
    strategy: "BASELINE",
    amountPaisa: item.observable.amountPaisa,
    failureReason: item.observable.failureReason,
    decision: lastDecision,
    policy: lastPolicy,
    recovered,
    recoveredPaisa: recovered ? item.observable.amountPaisa : 0,
    contacts,
    escalated,
    policyViolations: 0,
    duplicateActions: 0,
    outcome: recovered ? "RECOVERED" : escalated ? "ESCALATED" : "STOPPED",
    timeline,
    observable: item.observable,
    hidden: item.hidden,
  };
}

async function evaluateRecoverAiCase(
  item: SyntheticEvaluationCase,
  policyConfig: RecoveryPolicyConfig,
): Promise<EvaluationCaseResult> {
  const context: RecoveryContext = { ...item.observable, caseId: item.id, now: NOW };
  const provider = new DeterministicDecisionProvider();
  const proposed = validateDecision(await provider.decide(context));
  const policy = evaluatePolicy(context, proposed, policyConfig);
  const timeline: EvaluationCaseResult["timeline"] = [
    { step: "Detected", detail: item.observable.failureReason },
    { step: "Decision", detail: `${proposed.action}: ${proposed.explanation}` },
    { step: "Policy", detail: `${policy.outcome} (${policy.reasonCode})` },
  ];
  const escalated = policy.outcome === "ESCALATE";
  const allowed = policy.outcome === "ALLOW";
  // Both strategies are observed for the same evaluation window. A hidden manual/provider
  // recovery therefore applies equally and cancels a RecoverAI intervention before execution.
  const recoveredBeforeExecution = item.hidden.spontaneousRecovery;
  let actionRecovered = allowed && outcomeForAction(item, proposed.action, context.retryCount);
  if (
    !recoveredBeforeExecution &&
    !actionRecovered &&
    allowed &&
    proposed.action === "SMART_RETRY" &&
    context.retryCount + 1 < policyConfig.maxRetries
  ) {
    const followUpContext: RecoveryContext = {
      ...context,
      retryCount: context.retryCount + 1,
      failedPayments: context.failedPayments + 1,
    };
    const followUp = validateDecision(await provider.decide(followUpContext));
    const followUpPolicy = evaluatePolicy(followUpContext, followUp, policyConfig);
    timeline.push({
      step: "Re-evaluate",
      detail: `${followUp.action}: ${followUpPolicy.outcome} after the first observed retry failure.`,
    });
    if (followUp.action === "SMART_RETRY" && followUpPolicy.outcome === "ALLOW") {
      actionRecovered = outcomeForAction(item, followUp.action, followUpContext.retryCount);
    }
  }
  const recovered = recoveredBeforeExecution || actionRecovered;
  const contacts =
    !recoveredBeforeExecution &&
    allowed &&
    ["REQUEST_PAYMENT_METHOD_UPDATE", "SEND_WHATSAPP", "SEND_EMAIL", "SEND_PAYMENT_LINK"].includes(
      proposed.action,
    )
      ? 1
      : 0;
  timeline.push({
    step: "Outcome",
    detail: recoveredBeforeExecution
      ? "Payment succeeded independently before execution; the pending intervention was cancelled."
      : escalated
        ? "Routed to human review without executing an intervention."
        : !allowed
          ? "Deterministic policy prevented execution."
          : recovered
            ? `${proposed.action} recovered the payment.`
            : proposed.action === "WAIT"
              ? "Wait completed without unnecessary customer contact."
              : `${proposed.action} completed; payment was not recovered in the evaluation window.`,
  });

  return {
    caseId: item.id,
    strategy: "RECOVER_AI",
    amountPaisa: item.observable.amountPaisa,
    failureReason: item.observable.failureReason,
    decision: proposed,
    policy,
    recovered,
    recoveredPaisa: recovered ? item.observable.amountPaisa : 0,
    contacts,
    escalated,
    policyViolations: 0,
    duplicateActions: 0,
    outcome: recovered
      ? "RECOVERED"
      : escalated
        ? "ESCALATED"
        : policy.outcome === "BLOCK"
          ? "STOPPED"
          : "WAITING",
    timeline,
    observable: item.observable,
    hidden: item.hidden,
  };
}

export function calculateMetrics(cases: EvaluationCaseResult[]): EvaluationMetrics {
  const revenueAtRiskPaisa = cases.reduce((sum, item) => sum + item.amountPaisa, 0);
  const revenueRecoveredPaisa = cases.reduce((sum, item) => sum + item.recoveredPaisa, 0);
  const recoveredCases = cases.filter((item) => item.recovered).length;
  const customerContacts = cases.reduce((sum, item) => sum + item.contacts, 0);
  const humanEscalations = cases.filter((item) => item.escalated).length;
  return {
    revenueAtRiskPaisa,
    revenueRecoveredPaisa,
    recoveredCases,
    totalCases: cases.length,
    recoveryRate: revenueAtRiskPaisa === 0 ? 0 : revenueRecoveredPaisa / revenueAtRiskPaisa,
    customerContacts,
    contactsPerTenThousandRecovered:
      revenueRecoveredPaisa === 0 ? 0 : customerContacts / (revenueRecoveredPaisa / 1_000_000),
    humanEscalations,
    automationRate: cases.length === 0 ? 0 : (cases.length - humanEscalations) / cases.length,
    policyViolations: cases.reduce((sum, item) => sum + item.policyViolations, 0),
    duplicateActions: cases.reduce((sum, item) => sum + item.duplicateActions, 0),
  };
}

export async function runRecoveryEvaluation(
  seed = 20_260_823,
  size = 100,
  policyConfig: RecoveryPolicyConfig = DEFAULT_POLICY,
): Promise<RecoveryEvaluation> {
  const dataset = generateHeldOutDataset(seed, size);
  const baselineCases = dataset.map((item) => evaluateBaselineCase(item, policyConfig));
  const recoverAiCases = await Promise.all(
    dataset.map((item) => evaluateRecoverAiCase(item, policyConfig)),
  );
  const baselineMetrics = calculateMetrics(baselineCases);
  const recoverAiMetrics = calculateMetrics(recoverAiCases);
  return {
    seed,
    datasetSize: size,
    baseline: { metrics: baselineMetrics, cases: baselineCases },
    recoverAi: { metrics: recoverAiMetrics, cases: recoverAiCases },
    comparison: {
      incrementalRevenuePaisa:
        recoverAiMetrics.revenueRecoveredPaisa - baselineMetrics.revenueRecoveredPaisa,
      recoveryRateUpliftPoints:
        (recoverAiMetrics.recoveryRate - baselineMetrics.recoveryRate) * 100,
      contactDelta: recoverAiMetrics.customerContacts - baselineMetrics.customerContacts,
    },
  };
}
