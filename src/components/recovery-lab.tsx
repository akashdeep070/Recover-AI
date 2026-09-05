"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Beaker,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  LoaderCircle,
  Play,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { StatusBadge } from "./status-badge";
import { formatCurrency, formatPercent, sentenceCase } from "@/lib/format";

interface Metrics {
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

export interface LabCase {
  caseId: string;
  strategy: "BASELINE" | "RECOVER_AI";
  amountPaisa: number;
  failureReason: string;
  decision: { action: string; confidence: number; reasonCode: string; explanation: string };
  policy: { outcome: string; reasonCode: string; explanation: string };
  recovered: boolean;
  recoveredPaisa: number;
  contacts: number;
  escalated: boolean;
  policyViolations: number;
  duplicateActions: number;
  outcome: string;
  timeline: Array<{ step: string; detail: string }>;
  observable: Record<string, unknown>;
}

export interface LabResult {
  id: string;
  seed: number;
  datasetSize: number;
  baseline: { metrics: Metrics; cases: LabCase[] };
  recoverAi: { metrics: Metrics; cases: LabCase[] };
  comparison: {
    incrementalRevenuePaisa: number;
    recoveryRateUpliftPoints: number;
    contactDelta: number;
  };
}

interface ChaosResult {
  scenario: string;
  outcome: string;
  safe: boolean;
  actionCount: number;
  summary: string;
  audit: Array<{ id: string; type: string; message: string; createdAt: string }>;
}

const scenarios = [
  ["DUPLICATE_WEBHOOK", "Duplicate webhook"],
  ["AI_TIMEOUT", "AI timeout"],
  ["AI_INVALID_OUTPUT", "Invalid AI output"],
  ["MESSAGE_PROVIDER_DOWN", "Message provider down"],
  ["PAYMENT_SUCCESS_DURING_WAIT", "Success during wait"],
  ["ACTION_EXECUTOR_TIMEOUT", "Action timeout"],
] as const;

export function RecoveryLab({
  initial,
  initialRevenueAtRiskPaisa,
}: {
  initial: LabResult | null;
  initialRevenueAtRiskPaisa: number;
}) {
  const [result, setResult] = useState<LabResult | null>(initial);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [visibleCases, setVisibleCases] = useState(initial ? 12 : 0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chaosBusy, setChaosBusy] = useState<string | null>(null);
  const [chaosResult, setChaosResult] = useState<ChaosResult | null>(null);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setProgress((value) => Math.min(92, value + Math.max(1, Math.round((92 - value) / 9)))),
      120,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  async function runEvaluation() {
    setRunning(true);
    setError(null);
    setProgress(3);
    setVisibleCases(0);
    try {
      const response = await fetch("/api/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: 20_260_823, size: 100 }),
      });
      const body = (await response.json()) as LabResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Evaluation failed.");
      setProgress(100);
      setResult(body);
      for (let index = 1; index <= 12; index += 1) {
        window.setTimeout(() => setVisibleCases(index), index * 55);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evaluation failed safely.");
    } finally {
      window.setTimeout(() => setRunning(false), 260);
    }
  }

  async function injectChaos(scenario: string) {
    setChaosBusy(scenario);
    setChaosResult(null);
    try {
      const response = await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const body = (await response.json()) as ChaosResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failure injection failed.");
      setChaosResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failure injection failed safely.");
    } finally {
      setChaosBusy(null);
    }
  }

  const baselineById = useMemo(
    () => new Map(result?.baseline.cases.map((item) => [item.caseId, item]) ?? []),
    [result],
  );
  const maxRecovered = result
    ? Math.max(
        result.baseline.metrics.revenueRecoveredPaisa,
        result.recoverAi.metrics.revenueRecoveredPaisa,
        1,
      )
    : 1;

  return (
    <div className="lab-stack">
      <section className="experiment-card">
        <div className="experiment-main">
          <div className="experiment-icon">
            <FlaskConical size={25} />
          </div>
          <div>
            <span className="mono-label">HELD-OUT EXPERIMENT / SEED 20260823</span>
            <h2>100 identical revenue-at-risk cases</h2>
            <p>
              Both strategies receive the same observable context and hidden outcome behavior. Only
              deterministic code calculates totals.
            </p>
          </div>
        </div>
        <div className="experiment-stat">
          <span>Synthetic revenue at risk</span>
          <strong>
            {formatCurrency(
              result?.baseline.metrics.revenueAtRiskPaisa ?? initialRevenueAtRiskPaisa,
            )}
          </strong>
        </div>
        <button
          className="button button-primary run-button"
          disabled={running}
          onClick={runEvaluation}
        >
          {running ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
          {running ? `Evaluating ${progress}%` : result ? "Run again" : "Run evaluation"}
        </button>
        {running ? (
          <div className="run-progress" aria-label={`Evaluation ${progress}% complete`}>
            <div style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="notice notice-danger" role="alert">
          <TriangleAlert size={16} /> {error}
        </div>
      ) : null}

      {result ? (
        <>
          <section className="incremental-hero">
            <div>
              <span>Calculated incremental recovery</span>
              <strong>
                {result.comparison.incrementalRevenuePaisa >= 0 ? "+" : ""}
                {formatCurrency(result.comparison.incrementalRevenuePaisa)}
              </strong>
              <p>RecoverAI vs fixed baseline · synthetic evaluation only</p>
            </div>
            <div className="uplift-stats">
              <span>
                <strong>
                  {result.comparison.recoveryRateUpliftPoints >= 0 ? "+" : ""}
                  {result.comparison.recoveryRateUpliftPoints.toFixed(1)} pp
                </strong>{" "}
                recovery-rate uplift
              </span>
              <span>
                <strong>{result.comparison.contactDelta}</strong> contact delta
              </span>
            </div>
          </section>

          <section className="strategy-grid">
            {[
              [
                "Fixed baseline",
                result.baseline.metrics,
                "failure → wait 24h → retry → email → retry → stop",
                "baseline",
              ],
              [
                "RecoverAI",
                result.recoverAi.metrics,
                "context → bounded decision → policy → execute / wait / escalate",
                "recoverai",
              ],
            ].map(([name, rawMetrics, description, tone]) => {
              const metrics = rawMetrics as Metrics;
              return (
                <article className={`strategy-card strategy-${tone}`} key={name as string}>
                  <div className="strategy-heading">
                    <div>
                      <span>{name as string}</span>
                      <p>{description as string}</p>
                    </div>
                    {tone === "recoverai" ? <ShieldCheck size={20} /> : <Activity size={20} />}
                  </div>
                  <p className="strategy-money">{formatCurrency(metrics.revenueRecoveredPaisa)}</p>
                  <div className="strategy-bar">
                    <div
                      style={{ width: `${(metrics.revenueRecoveredPaisa / maxRecovered) * 100}%` }}
                    />
                  </div>
                  <div className="strategy-metrics">
                    <div>
                      <span>Recovery rate</span>
                      <strong>{formatPercent(metrics.recoveryRate)}</strong>
                    </div>
                    <div>
                      <span>Contacts</span>
                      <strong>{metrics.customerContacts}</strong>
                    </div>
                    <div>
                      <span>Escalations</span>
                      <strong>{metrics.humanEscalations}</strong>
                    </div>
                    <div>
                      <span>Automation</span>
                      <strong>{formatPercent(metrics.automationRate, 0)}</strong>
                    </div>
                    <div>
                      <span>Policy violations</span>
                      <strong>{metrics.policyViolations}</strong>
                    </div>
                    <div>
                      <span>Duplicate actions</span>
                      <strong>{metrics.duplicateActions}</strong>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>Case-by-case evaluation stream</h2>
                <p>Decision context excludes hidden simulator behavior</p>
              </div>
              <span className="boundary-note">Showing {Math.min(visibleCases, 12)} / 100</span>
            </div>
            <div className="table-wrap">
              <table className="data-table lab-table">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Failure</th>
                    <th>RecoverAI decision</th>
                    <th>Policy</th>
                    <th>RecoverAI outcome</th>
                    <th>Baseline outcome</th>
                    <th aria-label="Open detail" />
                  </tr>
                </thead>
                <tbody>
                  {result.recoverAi.cases.slice(0, visibleCases).map((item) => {
                    const baseline = baselineById.get(item.caseId);
                    const isOpen = expanded === item.caseId;
                    return (
                      <FragmentRow
                        key={item.caseId}
                        item={item}
                        baseline={baseline}
                        open={isOpen}
                        onToggle={() => setExpanded(isOpen ? null : item.caseId)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="lab-empty">
          <Beaker size={29} />
          <h2>Ready to run the held-out batch</h2>
          <p>
            The fixed baseline and RecoverAI will operate on identical generated cases. Results are
            persisted with their seed.
          </p>
        </section>
      )}

      <section className="panel chaos-panel">
        <div className="panel-header">
          <div>
            <h2>Failure injection</h2>
            <p>Prove the controller fails safe without touching seeded recovery data</p>
          </div>
          <TriangleAlert size={18} />
        </div>
        <div className="panel-body chaos-grid">
          {scenarios.map(([value, label]) => (
            <button
              key={value}
              className="chaos-button"
              disabled={chaosBusy !== null}
              onClick={() => injectChaos(value)}
            >
              {chaosBusy === value ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Beaker size={16} />
              )}
              <span>{label}</span>
            </button>
          ))}
        </div>
        {chaosResult ? (
          <div className={`chaos-result ${chaosResult.safe ? "chaos-safe" : "chaos-unsafe"}`}>
            <div className="chaos-result-heading">
              {chaosResult.safe ? <CheckCircle2 size={20} /> : <TriangleAlert size={20} />}
              <div>
                <strong>
                  {sentenceCase(chaosResult.scenario)} —{" "}
                  {chaosResult.safe ? "safe invariant held" : "invariant failed"}
                </strong>
                <p>{chaosResult.summary}</p>
              </div>
              <StatusBadge value={chaosResult.outcome} />
            </div>
            <div className="chaos-audit">
              {chaosResult.audit.slice(-5).map((event) => (
                <div key={event.id}>
                  <span>{sentenceCase(event.type)}</span>
                  <p>{event.message}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FragmentRow({
  item,
  baseline,
  open,
  onToggle,
}: {
  item: LabCase;
  baseline?: LabCase;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <td className="numeric">{item.caseId.replace("heldout_", "#")}</td>
        <td>
          {sentenceCase(item.failureReason)}
          <div className="table-subline">{formatCurrency(item.amountPaisa)}</div>
        </td>
        <td>
          <StatusBadge value={item.decision.action} />
        </td>
        <td>
          <StatusBadge value={item.policy.outcome} />
        </td>
        <td>
          <StatusBadge value={item.outcome} />
        </td>
        <td>
          <StatusBadge value={baseline?.outcome ?? "UNKNOWN"} />
        </td>
        <td>
          <button
            className="icon-button"
            aria-label={`${open ? "Close" : "Open"} details for ${item.caseId}`}
            aria-expanded={open}
            onClick={onToggle}
          >
            <ChevronDown size={16} className={open ? "rotate" : ""} />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="expanded-row">
          <td colSpan={7}>
            <div className="case-inspection">
              <div>
                <span>Observable context</span>
                <dl>
                  {Object.entries(item.observable)
                    .slice(0, 8)
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{sentenceCase(key)}</dt>
                        <dd>{String(value ?? "—")}</dd>
                      </div>
                    ))}
                </dl>
              </div>
              <div>
                <span>Why this decision</span>
                <p>{item.decision.explanation}</p>
                <small>
                  {item.decision.reasonCode} · {Math.round(item.decision.confidence * 100)}%
                  confidence
                </small>
              </div>
              <div>
                <span>Evaluation timeline</span>
                <ol>
                  {item.timeline.map((step, index) => (
                    <li key={`${step.step}-${index}`}>
                      <strong>{step.step}</strong>
                      <p>{step.detail}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
