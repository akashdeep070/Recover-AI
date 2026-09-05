import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { PrismaRecoveryStore } from "@/server/prisma-recovery-store";

const schema = z.object({
  action: z.enum(["APPROVE", "STOP"]),
  notes: z.string().max(500).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const review = await prisma.humanReview.findUnique({
      where: { id },
      include: { recoveryCase: true },
    });
    if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });
    if (review.status !== "PENDING") {
      return NextResponse.json({ error: "Review has already been resolved." }, { status: 409 });
    }
    const store = new PrismaRecoveryStore();
    await prisma.humanReview.update({
      where: { id },
      data: {
        status: input.action === "APPROVE" ? "APPROVED" : "STOPPED",
        decidedBy: "Demo operator",
        notes: input.notes,
        resolvedAt: new Date(),
      },
    });
    const nextState = input.action === "APPROVE" ? "ANALYZING" : "STOPPED";
    const updated = await store.transition(review.recoveryCaseId, nextState, {
      type: input.action === "APPROVE" ? "HUMAN_APPROVAL_RECORDED" : "HUMAN_STOP_RECORDED",
      message:
        input.action === "APPROVE"
          ? "Human approval was recorded; the case is queued for fresh context and policy evaluation."
          : "Human operator stopped the workflow without executing the proposed action.",
      metadata: { reviewId: id, notes: input.notes ?? null, actor: "Demo operator" },
    });
    return NextResponse.json({ ok: true, state: updated.state });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid review decision", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Review action failed", error);
    return NextResponse.json({ error: "Review decision failed safely." }, { status: 500 });
  }
}
