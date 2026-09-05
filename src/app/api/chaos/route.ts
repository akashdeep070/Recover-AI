import { NextResponse } from "next/server";
import { z } from "zod";
import { runChaosScenario } from "@/domain/chaos";

const schema = z.object({
  scenario: z.enum([
    "DUPLICATE_WEBHOOK",
    "AI_TIMEOUT",
    "AI_INVALID_OUTPUT",
    "MESSAGE_PROVIDER_DOWN",
    "PAYMENT_SUCCESS_DURING_WAIT",
    "ACTION_EXECUTOR_TIMEOUT",
  ]),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    return NextResponse.json(await runChaosScenario(input.scenario));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Unknown chaos scenario", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Chaos scenario failed", error);
    return NextResponse.json(
      { error: "Chaos scenario failed without mutating demo data." },
      { status: 500 },
    );
  }
}
