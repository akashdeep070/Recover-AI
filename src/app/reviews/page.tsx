import { PageHeader } from "@/components/page-header";
import { ReviewQueue, type ReviewItem } from "@/components/review-queue";
import { formatCurrency } from "@/lib/format";
import { getReviews } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const reviews = await getReviews();
  const items: ReviewItem[] = reviews.map((review) => ({
    id: review.id,
    caseId: review.recoveryCaseId,
    customerName: review.recoveryCase.customer.name,
    amountPaisa: review.recoveryCase.amountPaisa,
    reason: review.reason,
    recommendation: review.recommendation,
    policyReasonCode: review.policyReasonCode,
    status: review.status,
    failureReason: review.recoveryCase.failureReason,
    confidence: review.recoveryCase.decisions[0]?.confidence ?? undefined,
    createdAt: review.createdAt.toISOString(),
  }));
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Human control plane"
        title="Needs Review"
        description="High-value, disputed, low-confidence, or unsafe situations stop here. Approval never edits the audit history and always triggers fresh analysis."
      />
      <div className="review-summary">
        <span>
          <strong>{items.filter((item) => item.status === "PENDING").length}</strong> pending
        </span>
        <span>
          <strong>{items.filter((item) => item.status !== "PENDING").length}</strong> resolved
        </span>
        <span>
          <strong>
            {formatCurrency(
              items.reduce(
                (sum, item) => sum + (item.status === "PENDING" ? item.amountPaisa : 0),
                0,
              ),
            )}
          </strong>{" "}
          gated
        </span>
      </div>
      <ReviewQueue items={items} />
    </div>
  );
}
