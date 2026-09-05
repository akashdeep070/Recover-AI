import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const policySchema = z
  .object({
    maxRetries: z.number().int().min(0).max(10),
    maxContacts: z.number().int().min(0).max(10),
    minContactIntervalHours: z.number().int().min(1).max(168),
    highValueThresholdRupees: z.number().int().min(1_000).max(10_000_000),
    minAiConfidence: z.number().min(0.5).max(1),
    stopAfterSuccess: z.boolean(),
    respectOptOut: z.boolean(),
    disputeEscalation: z.boolean(),
  })
  .strict();

export async function PUT(request: Request) {
  try {
    const input = policySchema.parse(await request.json());
    const policy = await prisma.$transaction(async (tx) => {
      const updated = await tx.recoveryPolicy.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          maxRetries: input.maxRetries,
          maxContacts: input.maxContacts,
          minContactIntervalHours: input.minContactIntervalHours,
          highValueThresholdPaisa: input.highValueThresholdRupees * 100,
          minAiConfidence: input.minAiConfidence,
          stopAfterSuccess: input.stopAfterSuccess,
          respectOptOut: input.respectOptOut,
          disputeEscalation: input.disputeEscalation,
        },
        update: {
          maxRetries: input.maxRetries,
          maxContacts: input.maxContacts,
          minContactIntervalHours: input.minContactIntervalHours,
          highValueThresholdPaisa: input.highValueThresholdRupees * 100,
          minAiConfidence: input.minAiConfidence,
          stopAfterSuccess: input.stopAfterSuccess,
          respectOptOut: input.respectOptOut,
          disputeEscalation: input.disputeEscalation,
        },
      });
      await tx.auditEvent.create({
        data: {
          type: "POLICY_CONFIGURATION_UPDATED",
          message: "Recovery policy boundaries were updated by a human operator.",
          metadata: input,
        },
      });
      return updated;
    });
    return NextResponse.json({ ok: true, updatedAt: policy.updatedAt });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Unsafe or invalid policy values", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Policy update failed", error);
    return NextResponse.json(
      { error: "Policy update failed without changing active workflows." },
      { status: 500 },
    );
  }
}
