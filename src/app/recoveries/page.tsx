import { PageHeader } from "@/components/page-header";
import { RecoveryTable, type RecoveryRow } from "@/components/recovery-table";
import { getRecoveries } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function RecoveriesPage() {
  const records = await getRecoveries();
  const rows: RecoveryRow[] = records.map((item) => ({
    id: item.id,
    customerName: item.customer.name,
    amountPaisa: item.amountPaisa,
    failureReason: item.failureReason,
    state: item.state,
    currentAction: item.currentAction ?? item.actions[0]?.type,
    confidence: item.decisions[0]?.confidence ?? undefined,
    lastActivity: item.updatedAt.toISOString(),
    source: item.source,
  }));
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Recovery operations"
        title="Every case, one accountable path."
        description="Search and inspect the decision, deterministic authorization, execution state, and observed outcome for each revenue-at-risk case."
      />
      <RecoveryTable rows={rows} />
    </div>
  );
}
