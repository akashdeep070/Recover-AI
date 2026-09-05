"use client";

import { useState } from "react";
import { Check, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck } from "lucide-react";
import type { RecoveryPolicyConfig } from "@/domain/types";

interface FormState {
  maxRetries: number;
  maxContacts: number;
  minContactIntervalHours: number;
  highValueThresholdRupees: number;
  minAiConfidence: number;
  stopAfterSuccess: boolean;
  respectOptOut: boolean;
  disputeEscalation: boolean;
}

export function PolicyForm({ policy }: { policy: RecoveryPolicyConfig }) {
  const initial: FormState = {
    ...policy,
    highValueThresholdRupees: policy.highValueThresholdPaisa / 100,
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  function numberField(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: Number(value) }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Policy update failed.");
      setNotice({ tone: "success", text: "Policy boundaries saved and added to the audit trail." });
    } catch (error) {
      setNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "Policy update failed safely.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="policy-layout">
      {notice ? (
        <div className={`notice notice-${notice.tone}`} role="status">
          {notice.text}
        </div>
      ) : null}
      <section className="panel policy-section">
        <div className="panel-header">
          <div>
            <h2>Execution limits</h2>
            <p>Hard ceilings applied before any executor can run</p>
          </div>
          <LockKeyhole size={18} />
        </div>
        <div className="panel-body form-grid">
          <label>
            <span>Maximum automatic retries</span>
            <input
              className="input numeric"
              type="number"
              min="0"
              max="10"
              value={form.maxRetries}
              onChange={(event) => numberField("maxRetries", event.target.value)}
            />
            <small>Applies to SMART_RETRY only. Recommended: 3.</small>
          </label>
          <label>
            <span>Maximum customer contacts</span>
            <input
              className="input numeric"
              type="number"
              min="0"
              max="10"
              value={form.maxContacts}
              onChange={(event) => numberField("maxContacts", event.target.value)}
            />
            <small>Email, WhatsApp, method update, and payment links.</small>
          </label>
          <label>
            <span>Minimum contact interval (hours)</span>
            <input
              className="input numeric"
              type="number"
              min="1"
              max="168"
              value={form.minContactIntervalHours}
              onChange={(event) => numberField("minContactIntervalHours", event.target.value)}
            />
            <small>Prevents repeated outreach and customer fatigue.</small>
          </label>
        </div>
      </section>

      <section className="panel policy-section">
        <div className="panel-header">
          <div>
            <h2>Human approval boundaries</h2>
            <p>Situations where automation must yield to an operator</p>
          </div>
          <ShieldCheck size={18} />
        </div>
        <div className="panel-body form-grid">
          <label>
            <span>High-value threshold (INR)</span>
            <input
              className="input numeric"
              type="number"
              min="1000"
              max="10000000"
              step="1000"
              value={form.highValueThresholdRupees}
              onChange={(event) => numberField("highValueThresholdRupees", event.target.value)}
            />
            <small>Interventions above this amount require human approval.</small>
          </label>
          <label>
            <span>Minimum AI confidence</span>
            <input
              className="input numeric"
              type="number"
              min="0.5"
              max="1"
              step="0.01"
              value={form.minAiConfidence}
              onChange={(event) => numberField("minAiConfidence", event.target.value)}
            />
            <small>Lower-confidence executable recommendations escalate.</small>
          </label>
        </div>
        <div className="toggle-list">
          {[
            [
              "stopAfterSuccess",
              "Stop after successful payment",
              "Cancels pending actions as soon as payment succeeds.",
            ],
            [
              "respectOptOut",
              "Respect customer opt-out",
              "Blocks all automated customer communication.",
            ],
            [
              "disputeEscalation",
              "Escalate billing disputes",
              "Requires human review before intervention.",
            ],
          ].map(([key, label, help]) => (
            <label className="toggle-row" key={key}>
              <div>
                <strong>{label}</strong>
                <span>{help}</span>
              </div>
              <input
                type="checkbox"
                checked={Boolean(form[key as keyof FormState])}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [key]: event.target.checked }))
                }
              />
              <span className="toggle-control" aria-hidden="true" />
            </label>
          ))}
        </div>
      </section>

      <div className="policy-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setForm(initial);
            setNotice(null);
          }}
          disabled={busy}
        >
          <RotateCcw size={15} /> Reset unsaved
        </button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save policy
          boundaries
        </button>
      </div>
    </form>
  );
}
