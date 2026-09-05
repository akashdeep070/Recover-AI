import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  InvalidStateTransitionError,
  assertTransition,
  canTransition,
} from "../state-machine";
import { RECOVERY_STATES } from "../types";

describe("recovery state machine", () => {
  it("declares transitions for every state", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...RECOVERY_STATES].sort());
  });

  it.each([
    ["DETECTED", "ANALYZING"],
    ["ANALYZING", "DECISION_READY"],
    ["DECISION_READY", "POLICY_CHECK"],
    ["POLICY_CHECK", "ACTION_PENDING"],
    ["ACTION_PENDING", "ACTION_EXECUTED"],
    ["ACTION_EXECUTED", "WAITING"],
    ["WAITING", "RECOVERED"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
    expect(canTransition(from, to)).toBe(true);
  });

  it("rejects invalid transitions without changing state", () => {
    expect(() => assertTransition("DETECTED", "ACTION_EXECUTED")).toThrow(
      InvalidStateTransitionError,
    );
  });

  it("treats recovered and stopped as terminal", () => {
    expect(ALLOWED_TRANSITIONS.RECOVERED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.STOPPED).toEqual([]);
  });

  it("allows recoverable failures to return to analysis", () => {
    expect(canTransition("FAILED", "ANALYZING")).toBe(true);
  });
});
