"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, LoaderCircle, ShieldAlert, Square } from "lucide-react";
import { StatusBadge } from "./status-badge";
import { formatCurrency, formatDateTime, sentenceCase } from "@/lib/format";

export interface ReviewItem {
  id: string;
  caseId: string;
  customerName: string;
  amountPaisa: number;
  reason: string;
  recommendation: string;
  policyReasonCode: string;
  status: string;
  failureReason: string;
  confidence?: number;
  createdAt: string;
}

export function ReviewQueue({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(id: string, action: "APPROVE" | "STOP") {
    setBusy(`${id}:${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/reviews/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Review decision failed.");
      setMessage(
        action === "APPROVE"
          ? "Approval recorded; case queued for fresh analysis."
          : "Workflow stopped safely.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review decision failed safely.");
    } finally {
      setBusy(null);
    }
  }

  const pending = items.filter((item) => item.status === "PENDING");
  const resolved = items.filter((item) => item.status !== "PENDING");
  return (
    <div className="review-layout">
      {message ? (
        <div className="notice" role="status">
          {message}
        </div>
      ) : null}
      <section className="review-list" aria-label="Pending human reviews">
        {pending.map((item) => (
          <article className="review-card" key={item.id}>
            <div className="review-accent">
              <ShieldAlert size={18} />
            </div>
            <div className="review-main">
              <div className="review-heading">
                <div>
                  <Link href={`/recoveries/${item.caseId}`}>{item.customerName}</Link>
                  <p>
                    {sentenceCase(item.failureReason)} · {formatDateTime(item.createdAt)}
                  </p>
                </div>
                <strong className="numeric">{formatCurrency(item.amountPaisa)}</strong>
              </div>
              <div className="review-reason">
                <span>Why human review</span>
                <p>{item.reason}</p>
              </div>
              <div className="review-meta">
                <div>
                  <span>AI recommendation</span>
                  <strong>{sentenceCase(item.recommendation)}</strong>
                </div>
                <div>
                  <span>Policy reason</span>
                  <strong>{sentenceCase(item.policyReasonCode)}</strong>
                </div>
                <div>
                  <span>AI confidence</span>
                  <strong>
                    {item.confidence === undefined
                      ? "Unavailable"
                      : `${Math.round(item.confidence * 100)}%`}
                  </strong>
                </div>
              </div>
              <div className="review-actions">
                <Link href={`/recoveries/${item.caseId}`} className="button button-secondary">
                  Inspect evidence
                </Link>
                <button
                  className="button button-primary"
                  disabled={busy !== null}
                  onClick={() => decide(item.id, "APPROVE")}
                >
                  {busy === `${item.id}:APPROVE` ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}{" "}
                  Approve & re-evaluate
                </button>
                <button
                  className="button button-danger"
                  disabled={busy !== null}
                  onClick={() => decide(item.id, "STOP")}
                >
                  {busy === `${item.id}:STOP` ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Square size={15} />
                  )}{" "}
                  Stop
                </button>
              </div>
            </div>
          </article>
        ))}
        {pending.length === 0 ? (
          <div className="empty-state panel">
            <Check size={25} />
            <h2>Review queue is clear</h2>
            <p>No policy-gated case is waiting for a human decision.</p>
          </div>
        ) : null}
      </section>
      {resolved.length ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Resolved decisions</h2>
              <p>Human decisions remain part of the audit record</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Policy reason</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link href={`/recoveries/${item.caseId}`}>{item.customerName}</Link>
                    </td>
                    <td className="numeric">{formatCurrency(item.amountPaisa)}</td>
                    <td>{sentenceCase(item.policyReasonCode)}</td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
