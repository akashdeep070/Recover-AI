import { describe, expect, it } from "vitest";
import { runChaosScenario } from "../chaos";

describe("failure injection invariants", () => {
  it.each([
    "DUPLICATE_WEBHOOK",
    "AI_TIMEOUT",
    "AI_INVALID_OUTPUT",
    "MESSAGE_PROVIDER_DOWN",
    "PAYMENT_SUCCESS_DURING_WAIT",
    "ACTION_EXECUTOR_TIMEOUT",
  ] as const)("handles %s safely", async (scenario) => {
    const result = await runChaosScenario(scenario);
    expect(result.safe).toBe(true);
    expect(result.audit.length).toBeGreaterThan(0);
  });
});
