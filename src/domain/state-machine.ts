import type { RecoveryState } from "./types";

export const ALLOWED_TRANSITIONS: Readonly<Record<RecoveryState, readonly RecoveryState[]>> = {
  DETECTED: ["ANALYZING", "RECOVERED", "STOPPED", "FAILED"],
  ANALYZING: ["DECISION_READY", "ESCALATED", "FAILED", "RECOVERED"],
  DECISION_READY: ["POLICY_CHECK", "ESCALATED", "FAILED", "RECOVERED"],
  POLICY_CHECK: [
    "SCHEDULED",
    "ACTION_PENDING",
    "WAITING",
    "RECOVERED",
    "ESCALATED",
    "STOPPED",
    "FAILED",
  ],
  SCHEDULED: ["ACTION_PENDING", "WAITING", "RECOVERED", "STOPPED", "FAILED"],
  ACTION_PENDING: ["ACTION_EXECUTED", "RECOVERED", "ESCALATED", "FAILED"],
  ACTION_EXECUTED: ["ANALYZING", "WAITING", "RECOVERED", "ESCALATED", "STOPPED", "FAILED"],
  WAITING: ["ANALYZING", "ACTION_PENDING", "RECOVERED", "ESCALATED", "STOPPED", "FAILED"],
  RECOVERED: [],
  ESCALATED: ["ANALYZING", "RECOVERED", "STOPPED"],
  STOPPED: [],
  FAILED: ["ANALYZING", "ESCALATED", "STOPPED", "RECOVERED"],
};

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: RecoveryState,
    public readonly to: RecoveryState,
  ) {
    super(`Invalid recovery state transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

export function assertTransition(from: RecoveryState, to: RecoveryState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

export function canTransition(from: RecoveryState, to: RecoveryState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
