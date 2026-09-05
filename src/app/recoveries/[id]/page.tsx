import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeIndianRupee,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDateTime, sentenceCase } from "@/lib/format";
import { getRecoveryCase } from "@/server/queries";

export const dynamic = "force-dynamic";

interface CheckItem {
  code: string;
  result: string;
  explanation: string;
}

function policyChecks(value: unknown): CheckItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CheckItem =>
    Boolean(
      item &&
        typeof item === "object" &&
        "code" in item &&
        "result" in item &&
        "explanation" in item,
    ),
  );
}

export default async function RecoveryCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getRecoveryCase(id);
  if (!item) notFound();
  const decision = item.decisions[0];
  const policy = item.policyEvaluations[0];
  const action = item.actions[0];
  const checks = policyChecks(policy?.checks);

  return (
    <div className="page-stack">
      <Link href="/recoveries" className="back-link">
        <ArrowLeft aria-hidden="true" size={15} /> All recoveries
      </Link>
      <PageHeader
        eyebrow={`Case ${item.id.replace("case_pay_demo_", "R-").toUpperCase()}`}
        title={item.customer.name}
        description={`${sentenceCase(item.failureReason)} · ${item.source === "SIMULATOR" ? "Synthetic demo workflow" : "Razorpay Test Mode"}`}
        action={
          <div className="header-badges">
            <StatusBadge value={item.state} />
            {item.humanReview ? <StatusBadge value={item.humanReview.status} /> : null}
          </div>
        }
      />

      <section className="case-hero">
        <div className="case-amount">
          <span>Revenue at risk</span>
          <strong>{formatCurrency(item.amountPaisa)}</strong>
          <small>
            {item.recoveredAmountPaisa
              ? `${formatCurrency(item.recoveredAmountPaisa)} recovered`
              : "Outcome still open"}
          </small>
        </div>
        <div className="case-answer-grid">
          <div>
            <span>What happened?</span>
            <strong>{sentenceCase(item.failureReason)}</strong>
            <p>Recurring payment failed and opened one idempotent recovery case.</p>
          </div>
          <div>
            <span>Why this action?</span>
            <strong>{decision ? sentenceCase(decision.action) : "No decision"}</strong>
            <p>{decision?.explanation ?? "The workflow stopped before decision generation."}</p>
          </div>
          <div>
            <span>Was it allowed?</span>
            <strong>{policy?.outcome ?? "Not evaluated"}</strong>
            <p>{policy?.explanation ?? "No deterministic policy result is available."}</p>
          </div>
          <div>
            <span>What followed?</span>
            <strong>{action ? sentenceCase(action.status) : sentenceCase(item.state)}</strong>
            <p>
              {action?.error ??
                (item.state === "RECOVERED"
                  ? "Payment success stopped all pending activity."
                  : "See the immutable timeline below.")}
            </p>
          </div>
        </div>
      </section>

      <section className="boundary-flow" aria-label="Recovery authorization path">
        <div>
          <Bot size={17} />
          <span>AI judgment</span>
          <strong>{decision ? sentenceCase(decision.action) : "Unavailable"}</strong>
        </div>
        <i />
        <div>
          <ShieldCheck size={17} />
          <span>Deterministic policy</span>
          <strong>{policy?.outcome ?? "Not run"}</strong>
        </div>
        <i />
        <div>
          <Zap size={17} />
          <span>Bounded executor</span>
          <strong>{action ? sentenceCase(action.status) : "Did not run"}</strong>
        </div>
        <i />
        <div>
          <CheckCircle2 size={17} />
          <span>Observed state</span>
          <strong>{sentenceCase(item.state)}</strong>
        </div>
      </section>

      <section className="two-column detail-columns">
        <div className="detail-stack">
          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Context available to the decision provider</h2>
                <p>Observable fields only; simulator hidden behavior is excluded</p>
              </div>
              <UserRound size={18} />
            </div>
            <div className="panel-body context-grid">
              <div>
                <span>Customer</span>
                <strong>{item.customer.name}</strong>
              </div>
              <div>
                <span>Value segment</span>
                <strong>{sentenceCase(item.customer.valueSegment)}</strong>
              </div>
              <div>
                <span>Subscription age</span>
                <strong>{item.subscription?.ageMonths ?? 0} months</strong>
              </div>
              <div>
                <span>Successful payments</span>
                <strong>{item.subscription?.successfulPayments ?? 0}</strong>
              </div>
              <div>
                <span>Previous failures</span>
                <strong>{item.subscription?.failedPayments ?? 0}</strong>
              </div>
              <div>
                <span>Mandate state</span>
                <strong>{sentenceCase(item.subscription?.mandateState ?? "UNKNOWN")}</strong>
              </div>
              <div>
                <span>Retry budget used</span>
                <strong>{item.retryCount} / 3</strong>
              </div>
              <div>
                <span>Contact budget used</span>
                <strong>{item.contactCount} / 3</strong>
              </div>
              <div>
                <span>Preferred channel</span>
                <strong>{sentenceCase(item.customer.preferredChannel)}</strong>
              </div>
              <div>
                <span>Next provider retry</span>
                <strong>{formatDateTime(item.subscription?.nextProviderRetryAt)}</strong>
              </div>
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Immutable audit timeline</h2>
                <p>
                  {item.auditEvents.length} ordered facts · historical entries are never rewritten
                </p>
              </div>
              <Clock3 size={18} />
            </div>
            <ol className="timeline">
              {item.auditEvents.map((event, index) => (
                <li key={event.id}>
                  <div
                    className={`timeline-node ${event.type.includes("FAIL") || event.type.includes("BLOCK") ? "timeline-danger" : event.type.includes("RECOVER") ? "timeline-success" : ""}`}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="timeline-content">
                    <div>
                      <strong>{sentenceCase(event.type)}</strong>
                      <time>{formatDateTime(event.createdAt)}</time>
                    </div>
                    <p>{event.message}</p>
                    {event.fromState && event.toState ? (
                      <small>
                        {sentenceCase(event.fromState)} → {sentenceCase(event.toState)}
                      </small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </div>

        <div className="detail-stack">
          <article className="panel decision-card">
            <div className="panel-header">
              <div>
                <h2>Contextual decision</h2>
                <p>{decision?.provider ?? "No provider result"}</p>
              </div>
              <Bot size={18} />
            </div>
            <div className="panel-body">
              {decision ? (
                <>
                  <div className="decision-action">
                    <StatusBadge value={decision.action} />
                    <span className="confidence-ring">
                      {Math.round(decision.confidence * 100)}%
                    </span>
                  </div>
                  <p className="decision-explanation">{decision.explanation}</p>
                  <dl className="compact-dl">
                    <div>
                      <dt>Reason code</dt>
                      <dd>{decision.reasonCode}</dd>
                    </div>
                    <div>
                      <dt>Recommended delay</dt>
                      <dd>
                        {decision.recommendedDelayHours === null
                          ? "Immediate / none"
                          : `${decision.recommendedDelayHours} hours`}
                      </dd>
                    </div>
                    {decision.communicationIntent ? (
                      <div>
                        <dt>Communication intent</dt>
                        <dd>{decision.communicationIntent}</dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              ) : (
                <p className="muted">No valid decision was produced; the case failed safe.</p>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Policy authorization</h2>
                <p>{policy?.reasonCode ?? "Not evaluated"}</p>
              </div>
              {policy ? <StatusBadge value={policy.outcome} /> : null}
            </div>
            <div className="policy-checks">
              {checks.map((check) => (
                <div className="policy-check" key={check.code}>
                  <StatusBadge value={check.result} />
                  <div>
                    <strong>{sentenceCase(check.code)}</strong>
                    <p>{check.explanation}</p>
                  </div>
                </div>
              ))}
              {checks.length === 0 ? (
                <p className="muted panel-body">No policy checks were persisted for this case.</p>
              ) : null}
            </div>
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Execution result</h2>
                <p>Idempotency-protected external boundary</p>
              </div>
              <BadgeIndianRupee size={18} />
            </div>
            <div className="panel-body">
              {action ? (
                <dl className="compact-dl">
                  <div>
                    <dt>Action</dt>
                    <dd>
                      <StatusBadge value={action.type} />
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <StatusBadge value={action.status} />
                    </dd>
                  </div>
                  <div>
                    <dt>Operation ID</dt>
                    <dd className="numeric">
                      {action.providerOperationId ?? "No external operation"}
                    </dd>
                  </div>
                  {action.providerReferenceId ? (
                    <div>
                      <dt>Provider reference</dt>
                      <dd className="code-wrap">{action.providerReferenceId}</dd>
                    </div>
                  ) : null}
                  {action.providerResourceUrl ? (
                    <div>
                      <dt>Payment Link</dt>
                      <dd>
                        <a
                          className="inline-link"
                          href={action.providerResourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Razorpay Test Link <ExternalLink aria-hidden="true" size={13} />
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Idempotency key</dt>
                    <dd className="code-wrap">{action.idempotencyKey}</dd>
                  </div>
                  <div>
                    <dt>Scheduled / executed</dt>
                    <dd>{formatDateTime(action.scheduledFor ?? action.executedAt)}</dd>
                  </div>
                </dl>
              ) : (
                <div className="no-execution">
                  <ShieldCheck size={20} />
                  <div>
                    <strong>No executor ran</strong>
                    <p>
                      The action was blocked, escalated, stopped, or failed before authorization.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </article>

          {item.providerEvents.length ? (
            <article className="source-note">
              <ExternalLink size={15} />
              <div>
                <strong>{item.providerEvents[0].provider} source event</strong>
                <p>
                  {item.providerEvents[0].providerEventId} · duplicates observed:{" "}
                  {item.providerEvents[0].duplicateCount}
                </p>
              </div>
            </article>
          ) : null}
        </div>
      </section>
    </div>
  );
}
