import { NextResponse } from "next/server";
import { configuredActionExecutor } from "@/domain/action-executor";
import { configuredDecisionProvider } from "@/domain/decision-provider";
import { RecoveryEngine } from "@/domain/recovery-engine";
import { paymentEventSchema } from "@/domain/types";
import { PrismaRecoveryStore } from "@/server/prisma-recovery-store";
import { getPolicyConfig } from "@/server/queries";

export async function POST(request: Request) {
  try {
    const event = paymentEventSchema.parse(await request.json());
    if (event.provider !== "SIMULATOR") {
      return NextResponse.json(
        { error: "Demo endpoint only accepts SIMULATOR events." },
        { status: 400 },
      );
    }
    const engine = new RecoveryEngine(
      new PrismaRecoveryStore(),
      configuredDecisionProvider(),
      configuredActionExecutor(),
      await getPolicyConfig(),
    );
    return NextResponse.json(await engine.process(event), { status: 202 });
  } catch (error) {
    console.error("Demo event failed", error);
    return NextResponse.json(
      {
        error: "Event was rejected safely.",
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 400 },
    );
  }
}
