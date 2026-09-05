import Link from "next/link";
import {
  ArrowRight,
  BadgeIndianRupee,
  CircleCheckBig,
  FlaskConical,
  History,
  MessagesSquare,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { OverviewAnalytics } from "@/domain/overview-analytics";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/format";

function CardHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Workflow;
}) {
  return (
    <div className="analytics-card-header">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <span className="analytics-card-icon" aria-hidden="true">
        <Icon size={17} strokeWidth={1.8} />
      </span>
    </div>
  );
}

export function RecoveryFunnelCard({ funnel }: Pick<OverviewAnalytics, "funnel">) {
  return (
    <article className="analytics-card analytics-funnel-card">
      <CardHeader
        title="Recovery control funnel"
        description="Each stage is a persisted checkpoint, not an inferred estimate."
        icon={Workflow}
      />
      <div className="analytics-card-body analytics-funnel-list">
        {funnel.map((stage, index) => (
          <div className="analytics-funnel-stage" key={stage.id}>
            <div className="analytics-stage-copy">
              <span className="analytics-stage-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{stage.label}</strong>
                <span>{formatCurrency(stage.amountPaisa, true)} represented</span>
              </div>
            </div>
            <div className="analytics-stage-result">
              {index > 0 ? (
                <span>{formatPercent(stage.conversionFromPrevious, 0)} from prior</span>
              ) : (
                <span>100% of detected cases</span>
              )}
              <strong>{stage.count}</strong>
            </div>
            <div
              className="analytics-progress-track"
              role="img"
              aria-label={`${stage.label}: ${stage.count} cases, ${formatPercent(stage.shareOfDetected, 0)} of detected cases`}
            >
              <span
                className={`analytics-progress-fill analytics-stripe-${stage.id === "RECOVERED" ? "green" : "blue"}`}
                style={{
                  width: `${Math.max(stage.shareOfDetected * 100, stage.count > 0 ? 2 : 0)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="analytics-footnote">
        Manual or provider-side successes are excluded from the final action-attributed stage.
      </p>
    </article>
  );
}

export function RecoveredVolumeCard({ recoveredMix }: Pick<OverviewAnalytics, "recoveredMix">) {
  const total = recoveredMix.reduce((sum, item) => sum + item.amountPaisa, 0);
  return (
    <article className="analytics-card analytics-volume-card">
      <CardHeader
        title="Recovered volume"
        description="Observed money attributed by the last executed intervention."
        icon={BadgeIndianRupee}
      />
      <div className="analytics-card-body analytics-volume-body">
        <div className="analytics-volume-total">
          <span>Total recovered</span>
          <strong>{formatCurrency(total)}</strong>
          <small>{recoveredMix.reduce((sum, item) => sum + item.cases, 0)} payments</small>
        </div>
        {total > 0 ? (
          <div
            className="analytics-stacked-bar"
            role="img"
            aria-label={`Recovered volume attribution totaling ${formatCurrency(total)}`}
          >
            {recoveredMix.map((item) => (
              <span
                key={item.id}
                className={`analytics-stripe-${item.tone}`}
                style={{ width: `${item.share * 100}%` }}
                title={`${item.label}: ${formatCurrency(item.amountPaisa)}`}
              />
            ))}
          </div>
        ) : (
          <div className="analytics-empty-bar">No observed recovery yet</div>
        )}
        <div className="analytics-volume-list">
          {recoveredMix.map((item) => (
            <div key={item.id}>
              <span className={`analytics-legend-swatch analytics-stripe-${item.tone}`} />
              <div>
                <span>{item.label}</span>
                <small>{item.cases} recovered cases</small>
              </div>
              <strong>{formatCurrency(item.amountPaisa)}</strong>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function RecoveryHistoryCard({ paymentHistory }: Pick<OverviewAnalytics, "paymentHistory">) {
  const peak = Math.max(...paymentHistory.map((item) => item.recoveryRate), 0.01);
  return (
    <article className="analytics-card analytics-history-card">
      <CardHeader
        title="Recovery by history"
        description="Case recovery rate by successful payment history."
        icon={History}
      />
      <div className="analytics-card-body analytics-history-list">
        {paymentHistory.map((item) => (
          <div className="analytics-history-row" key={item.id}>
            <div>
              <span>{item.label}</span>
              <strong>{formatPercent(item.recoveryRate, 0)}</strong>
            </div>
            <div
              className="analytics-history-track"
              role="img"
              aria-label={`${item.label}: ${item.recoveredCases} of ${item.totalCases} cases recovered`}
            >
              <span style={{ width: `${(item.recoveryRate / peak) * 100}%` }} />
            </div>
            <small>
              {item.recoveredCases} / {item.totalCases} cases
            </small>
          </div>
        ))}
      </div>
      <p className="analytics-footnote">
        Prior history is observable context, never authorization.
      </p>
    </article>
  );
}

export function RecoveryActionsCard({ actionHealth }: Pick<OverviewAnalytics, "actionHealth">) {
  const outcomes = [
    ["Executed", actionHealth.executed, "green"],
    ["Pending / scheduled", actionHealth.scheduled, "blue"],
    ["Failed", actionHealth.failed, "pink"],
    ["Cancelled / no-op", actionHealth.safelyClosed, "neutral"],
  ] as const;
  return (
    <article className="analytics-card analytics-compact-card">
      <CardHeader
        title="Bounded action health"
        description={`${actionHealth.total} idempotent action records across active workflows.`}
        icon={CircleCheckBig}
      />
      <div className="analytics-card-body analytics-action-grid">
        {outcomes.map(([label, value, tone]) => (
          <div key={label}>
            <span className={`analytics-status-mark analytics-status-${tone}`} aria-hidden="true" />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

export function CustomerFrictionCard({ friction }: Pick<OverviewAnalytics, "friction">) {
  return (
    <article className="analytics-card analytics-compact-card">
      <CardHeader
        title="Customer friction"
        description="Measured contacts and deliberate no-contact decisions."
        icon={MessagesSquare}
      />
      <div className="analytics-card-body analytics-friction-layout">
        <div className="analytics-friction-hero">
          <span>Contacts per ₹10k recovered</span>
          <strong>{friction.contactsPerTenThousandRecovered.toFixed(1)}</strong>
        </div>
        <dl className="analytics-mini-metrics">
          <div>
            <dt>Recorded contacts</dt>
            <dd>{friction.recordedContacts}</dd>
          </div>
          <div>
            <dt>No-contact decisions</dt>
            <dd>{friction.noContactDecisions}</dd>
          </div>
          <div>
            <dt>Opt-outs visible</dt>
            <dd>{friction.optedOutCustomers}</dd>
          </div>
          <div>
            <dt>Cases protected</dt>
            <dd>{friction.protectedCases}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

export function RecoveryInsightCard({
  latestEvaluation,
}: Pick<OverviewAnalytics, "latestEvaluation">) {
  if (!latestEvaluation) {
    return (
      <article className="analytics-card analytics-insight-card analytics-insight-empty">
        <CardHeader
          title="Recovery Lab insight"
          description="No completed held-out evaluation is available yet."
          icon={FlaskConical}
        />
        <div className="analytics-card-body">
          <ShieldCheck size={30} aria-hidden="true" />
          <h3>Establish a measured baseline</h3>
          <p>Run the same fixed-seed cases through both strategies before claiming uplift.</p>
          <Link className="button button-primary" href="/lab">
            Run evaluation <ArrowRight size={16} />
          </Link>
        </div>
      </article>
    );
  }

  const positive = latestEvaluation.incrementalRevenuePaisa >= 0;
  const maxRecovered = Math.max(
    latestEvaluation.baselineRecoveredPaisa,
    latestEvaluation.recoverAiRecoveredPaisa,
    1,
  );
  return (
    <article className="analytics-card analytics-insight-card">
      <CardHeader
        title="Recovery Lab insight"
        description={`${latestEvaluation.datasetSize} held-out synthetic cases · ${formatDateTime(latestEvaluation.completedAt)}`}
        icon={FlaskConical}
      />
      <div className="analytics-card-body analytics-insight-body">
        <div className="analytics-insight-hero">
          <span>Incremental revenue recovered</span>
          <strong className={positive ? "analytics-positive" : "analytics-negative"}>
            {positive ? "+" : ""}
            {formatCurrency(latestEvaluation.incrementalRevenuePaisa)}
          </strong>
          <p>RecoverAI versus the fixed baseline · synthetic evaluation only</p>
        </div>
        <div className="analytics-comparison-bars">
          {[
            ["Fixed baseline", latestEvaluation.baselineRecoveredPaisa, "baseline"],
            ["RecoverAI", latestEvaluation.recoverAiRecoveredPaisa, "recoverai"],
          ].map(([label, rawValue, tone]) => {
            const value = rawValue as number;
            return (
              <div key={label as string}>
                <span>
                  {label as string} <strong>{formatCurrency(value)}</strong>
                </span>
                <div>
                  <i
                    className={`analytics-comparison-${tone}`}
                    style={{ width: `${(value / maxRecovered) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <dl className="analytics-insight-stats">
          <div>
            <dt>Rate uplift</dt>
            <dd>
              {latestEvaluation.recoveryRateUpliftPoints >= 0 ? "+" : ""}
              {latestEvaluation.recoveryRateUpliftPoints.toFixed(1)} pp
            </dd>
          </div>
          <div>
            <dt>Contact delta</dt>
            <dd>
              {latestEvaluation.contactDelta > 0 ? "+" : ""}
              {latestEvaluation.contactDelta}
            </dd>
          </div>
          <div>
            <dt>Safety defects</dt>
            <dd>{latestEvaluation.policyViolations + latestEvaluation.duplicateActions}</dd>
          </div>
        </dl>
        <Link className="analytics-insight-link" href="/lab">
          Inspect the full experiment <ArrowRight size={15} />
        </Link>
      </div>
    </article>
  );
}

export function OverviewAnalytics({ analytics }: { analytics: OverviewAnalytics }) {
  return (
    <section className="analytics-section" aria-labelledby="recovery-intelligence-title">
      <div className="analytics-section-heading">
        <div>
          <span className="eyebrow">Calculated operational analytics</span>
          <h2 id="recovery-intelligence-title">Recovery intelligence</h2>
          <p>
            A higher-resolution view of control flow, recovered volume, customer friction, and
            measured experiment performance.
          </p>
        </div>
        <span className="boundary-note">Database derived · no hardcoded totals</span>
      </div>
      <div className="analytics-grid">
        <div className="analytics-span-8">
          <RecoveryFunnelCard funnel={analytics.funnel} />
        </div>
        <div className="analytics-span-4">
          <RecoveredVolumeCard recoveredMix={analytics.recoveredMix} />
        </div>
        <div className="analytics-span-3">
          <RecoveryHistoryCard paymentHistory={analytics.paymentHistory} />
        </div>
        <div className="analytics-span-5 analytics-middle-stack">
          <RecoveryActionsCard actionHealth={analytics.actionHealth} />
          <CustomerFrictionCard friction={analytics.friction} />
        </div>
        <div className="analytics-span-4">
          <RecoveryInsightCard latestEvaluation={analytics.latestEvaluation} />
        </div>
      </div>
    </section>
  );
}
