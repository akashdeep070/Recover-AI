import { Binary, Bot, Gavel, LockKeyhole } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PolicyForm } from "@/components/policy-form";
import { getPolicyConfig } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const policy = await getPolicyConfig();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Deterministic guardrails"
        title="Recovery Policies"
        description="The model recommends. These rules authorize. Policy always wins when judgment and certainty disagree."
      />
      <section className="principle-grid">
        <article>
          <Bot size={18} />
          <div>
            <span>AI owns</span>
            <strong>Contextual judgment</strong>
            <p>Timing, channel, and the least-friction next action.</p>
          </div>
        </article>
        <article>
          <Binary size={18} />
          <div>
            <span>Code owns</span>
            <strong>Deterministic certainty</strong>
            <p>Limits, consent, states, idempotency, and calculations.</p>
          </div>
        </article>
        <article>
          <Gavel size={18} />
          <div>
            <span>Human owns</span>
            <strong>Material exceptions</strong>
            <p>High value, disputes, risk signals, and low confidence.</p>
          </div>
        </article>
        <article>
          <LockKeyhole size={18} />
          <div>
            <span>Never delegated</span>
            <strong>Unrestricted money movement</strong>
            <p>No model can invent or directly execute a financial tool.</p>
          </div>
        </article>
      </section>
      <PolicyForm policy={policy} />
    </div>
  );
}
