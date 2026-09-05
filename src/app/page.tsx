import Link from "next/link";
import { Activity, BadgeIndianRupee, RefreshCcw, ShieldAlert, TrendingUp } from "lucide-react";
import { MetricCard } from "@/components/metric-card";
import { OverviewAnalytics } from "@/components/overview-analytics";
import { PageHeader } from "@/components/page-header";
import { RecoveryTrendChart } from "@/components/recovery-trend-chart";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDateTime, formatPercent, sentenceCase } from "@/lib/format";
import { getOverviewData } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const data = await getOverviewData();
  const maxState = Math.max(...Object.values(data.stateCounts), 1);
  const maxMethod = Math.max(...Object.values(data.methodCounts), 1);
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Revenue control room"
        title="Recovery operations, under control."
        description="A closed-loop view of synthetic revenue at risk, bounded interventions, policy decisions, and observed outcomes."
        action={
          <Link className="button button-primary" href="/lab">
            <Activity size={16} /> Open Recovery Lab
          </Link>
        }
      />

      <section className="metric-grid" aria-label="Recovery summary">
        <MetricCard
          featured
          label="Revenue recovered"
          value={formatCurrency(data.revenueRecoveredPaisa)}
          detail="Observed payment-success events"
          icon={BadgeIndianRupee}
          trend={{ direction: "up", label: `${formatPercent(data.recoveryRate)} of seeded risk` }}
        />
        <MetricCard
          label="Revenue at risk"
          value={formatCurrency(data.revenueAtRiskPaisa)}
          detail="Open synthetic cases"
          icon={TrendingUp}
        />
        <MetricCard
          label="Recovery rate"
          value={formatPercent(data.recoveryRate)}
          detail="Amount-weighted"
          icon={Activity}
        />
        <MetricCard
          label="Active recoveries"
          value={String(data.activeRecoveries)}
          detail="Processing or waiting"
          icon={RefreshCcw}
        />
        <MetricCard
          label="Human reviews"
          value={String(data.humanReviews)}
          detail="Policy-gated queue"
          icon={ShieldAlert}
        />
      </section>

      <section className="test-mode-banner" aria-label="Razorpay Test Mode accounting">
        <div className="test-mode-icon" aria-hidden="true">
          <BadgeIndianRupee size={17} />
        </div>
        <div className="test-mode-copy">
          <span>Razorpay TEST MODE</span>
          <strong>{formatCurrency(data.razorpayTestRecoveredPaisa)}</strong>
          <p>Provider-backed recovery, kept separate from synthetic Recovery Lab results.</p>
        </div>
        <dl className="test-mode-stats">
          <div>
            <dt>Recovered cases</dt>
            <dd>{data.razorpayTestRecoveredCases}</dd>
          </div>
          <div>
            <dt>Accounting</dt>
            <dd>Exactly once</dd>
          </div>
        </dl>
      </section>

      <RecoveryTrendChart trend={data.recoveryTrend} />

      <section className="two-column">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent recovery cases</h2>
              <p>Live from the PostgreSQL-backed audit workflow</p>
            </div>
            <Link href="/recoveries" className="text-link">
              View all
            </Link>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Risk</th>
                  <th>State</th>
                  <th>Action</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.recentCases.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/recoveries/${item.id}`}>{item.customer.name}</Link>
                      <div className="table-subline">{sentenceCase(item.failureReason)}</div>
                    </td>
                    <td className="numeric">{formatCurrency(item.amountPaisa)}</td>
                    <td>
                      <StatusBadge value={item.state} />
                    </td>
                    <td>{item.currentAction ? sentenceCase(item.currentAction) : "—"}</td>
                    <td className="muted">{formatDateTime(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h2>Case-state distribution</h2>
              <p>Count of seeded workflows by current state</p>
            </div>
          </div>
          <div className="panel-body bar-list">
            {Object.entries(data.stateCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([state, count]) => (
                <div className="bar-row" key={state}>
                  <span className="mono-label">{sentenceCase(state)}</span>
                  <div className="bar-track">
                    <div
                      className={`bar-fill ${state === "RECOVERED" ? "bar-fill-success" : state === "ESCALATED" ? "bar-fill-warning" : ""}`}
                      style={{ width: `${(count / maxState) * 100}%` }}
                    />
                  </div>
                  <strong className="numeric">{count}</strong>
                </div>
              ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Intervention mix</h2>
            <p>Executed or scheduled bounded actions; no arbitrary tools</p>
          </div>
          <span className="boundary-note">Decision → Policy → Executor</span>
        </div>
        <div className="panel-body method-grid">
          {Object.entries(data.methodCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([method, count]) => (
              <div className="method-item" key={method}>
                <div className="method-top">
                  <span>{sentenceCase(method)}</span>
                  <strong className="numeric">{count}</strong>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(count / maxMethod) * 100}%` }} />
                </div>
              </div>
            ))}
        </div>
      </section>

      <OverviewAnalytics analytics={data.analytics} />
    </div>
  );
}
