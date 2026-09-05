import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [cases, policy] = await Promise.all([
      prisma.recoveryCase.count(),
      prisma.recoveryPolicy.findUnique({ where: { id: "default" } }),
    ]);
    return NextResponse.json({
      status: "ok",
      database: "connected",
      seededCases: cases,
      policyConfigured: Boolean(policy),
    });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
