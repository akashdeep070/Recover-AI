import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@/server/prisma-recovery-store", () => ({
  PrismaRecoveryStore: class PrismaRecoveryStore {},
}));
vi.mock("@/server/queries", () => ({
  getPolicyConfig: vi.fn(),
}));

import { POST } from "./route";

const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
  else process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
});

describe("Razorpay webhook safety boundary", () => {
  it("returns 503 when webhook verification is not configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const response = await POST(
      new Request("http://localhost/api/webhooks/razorpay", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("disabled"),
    });
  });

  it("rejects an invalid signature before parsing or mutating the database", async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
    const response = await POST(
      new Request("http://localhost/api/webhooks/razorpay", {
        method: "POST",
        headers: { "x-razorpay-signature": "invalid" },
        body: JSON.stringify({ event: "payment_link.paid" }),
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid webhook signature." });
  });
});
