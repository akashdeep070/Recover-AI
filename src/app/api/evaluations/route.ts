import { NextResponse } from "next/server";
import { z } from "zod";
import { runAndPersistEvaluation } from "@/server/evaluation-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  seed: z.number().int().min(1).max(2_147_483_647).default(20_260_823),
  size: z.number().int().min(1).max(500).default(100),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);
    const result = await runAndPersistEvaluation(input.seed, input.size);
    const publicCase = ({ hidden: _hidden, ...item }: (typeof result.baseline.cases)[number]) => {
      void _hidden;
      return item;
    };
    return NextResponse.json(
      {
        ...result,
        baseline: {
          metrics: result.baseline.metrics,
          cases: result.baseline.cases.map(publicCase),
        },
        recoverAi: {
          metrics: result.recoverAi.metrics,
          cases: result.recoverAi.cases.map(publicCase),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid evaluation parameters", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Evaluation failed", error);
    return NextResponse.json(
      { error: "Evaluation failed safely. No synthetic metrics were committed." },
      { status: 500 },
    );
  }
}
