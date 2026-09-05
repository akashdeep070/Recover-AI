import { NextResponse } from "next/server";
import { configuredActionExecutor } from "@/domain/action-executor";
import { configuredDecisionProvider } from "@/domain/decision-provider";
import { RecoveryEngine } from "@/domain/recovery-engine";
import { PrismaRecoveryStore } from "@/server/prisma-recovery-store";
import { getPolicyConfig } from "@/server/queries";
import { normalizeRazorpayWebhook, verifyRazorpaySignature } from "@/server/razorpay-adapter";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Razorpay webhook ingestion is disabled until RAZORPAY_WEBHOOK_SECRET is configured.",
      },
      { status: 503 },
    );
  }
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") ?? "";
    if (!verifyRazorpaySignature(rawBody, signature, secret)) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }
    const event = normalizeRazorpayWebhook(
      JSON.parse(rawBody) as unknown,
      rawBody,
      request.headers.get("x-razorpay-event-id") ?? undefined,
    );
    const engine = new RecoveryEngine(
      new PrismaRecoveryStore(),
      configuredDecisionProvider(),
      configuredActionExecutor(),
      await getPolicyConfig(),
    );
    return NextResponse.json(await engine.process(event, true), { status: 202 });
  } catch (error) {
    console.error("Razorpay webhook failed", error);
    return NextResponse.json({ error: "Webhook rejected safely." }, { status: 400 });
  }
}
