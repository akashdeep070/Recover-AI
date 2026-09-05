import { z } from "zod";

export const RECOVERY_ACTIONS = [
  "WAIT",
  "SMART_RETRY",
  "REQUEST_PAYMENT_METHOD_UPDATE",
  "SEND_WHATSAPP",
  "SEND_EMAIL",
  "SEND_PAYMENT_LINK",
  "ESCALATE",
  "STOP",
] as const;

export const RECOVERY_STATES = [
  "DETECTED",
  "ANALYZING",
  "DECISION_READY",
  "POLICY_CHECK",
  "SCHEDULED",
  "ACTION_PENDING",
  "ACTION_EXECUTED",
  "WAITING",
  "RECOVERED",
  "ESCALATED",
  "STOPPED",
  "FAILED",
] as const;

export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];
export type RecoveryState = (typeof RECOVERY_STATES)[number];
export type PolicyOutcome = "ALLOW" | "BLOCK" | "ESCALATE";

export const recoveryDecisionSchema = z
  .object({
    action: z.enum(RECOVERY_ACTIONS),
    confidence: z.number().min(0).max(1),
    reasonCode: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[A-Z0-9_]+$/),
    explanation: z.string().min(8).max(500),
    recommendedDelayHours: z.number().int().min(0).max(168).optional(),
    communicationIntent: z.string().min(3).max(280).optional(),
  })
  .strict();

export type RecoveryDecision = z.infer<typeof recoveryDecisionSchema>;

export const paymentEventSchema = z
  .object({
    provider: z.enum(["RAZORPAY", "SIMULATOR"]),
    providerEventId: z.string().min(3).max(200),
    type: z.enum([
      "PAYMENT_FAILED",
      "PAYMENT_SUCCEEDED",
      "SUBSCRIPTION_CANCELLED",
      "MANDATE_INVALIDATED",
    ]),
    occurredAt: z.string().datetime(),
    data: z
      .object({
        paymentId: z.string().min(1),
        providerPaymentId: z.string().optional(),
        amountPaisa: z.number().int().positive(),
        currency: z.string().length(3).default("INR"),
        failureReason: z.string().default("UNKNOWN"),
        customerId: z.string().min(1),
        customerName: z.string().min(1),
        email: z.string().email().optional(),
        phoneMasked: z.string().optional(),
        subscriptionId: z.string().min(1),
        providerSubscriptionId: z.string().optional(),
        subscriptionStatus: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]).default("ACTIVE"),
        mandateState: z.enum(["ACTIVE", "PENDING", "INVALID", "EXPIRED"]).default("ACTIVE"),
        subscriptionAgeMonths: z.number().int().nonnegative().default(1),
        successfulPayments: z.number().int().nonnegative().default(0),
        failedPayments: z.number().int().nonnegative().default(1),
        retryCount: z.number().int().nonnegative().default(0),
        contactCount: z.number().int().nonnegative().default(0),
        lastContactAt: z.string().datetime().optional(),
        nextProviderRetryAt: z.string().datetime().optional(),
        preferredChannel: z.enum(["EMAIL", "WHATSAPP", "NONE"]).default("EMAIL"),
        optedOut: z.boolean().default(false),
        valueSegment: z.enum(["STANDARD", "HIGH", "STRATEGIC"]).default("STANDARD"),
        previousRetrySucceeded: z.boolean().default(false),
        disputed: z.boolean().default(false),
        fraudSignal: z.boolean().default(false),
        inconsistentState: z.boolean().default(false),
      })
      .strict(),
    rawMetadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export interface RecoveryContext {
  caseId: string;
  amountPaisa: number;
  currency?: string;
  paymentStatus: "PENDING" | "FAILED" | "SUCCEEDED" | "CANCELLED";
  failureReason: string;
  retryCount: number;
  contactCount: number;
  lastContactAt?: string;
  optedOut: boolean;
  mandateState: "ACTIVE" | "PENDING" | "INVALID" | "EXPIRED";
  subscriptionStatus: "ACTIVE" | "PAUSED" | "CANCELLED";
  nextProviderRetryAt?: string;
  disputed: boolean;
  fraudSignal: boolean;
  inconsistentState: boolean;
  valueSegment: "STANDARD" | "HIGH" | "STRATEGIC";
  successfulPayments: number;
  failedPayments: number;
  preferredChannel: "EMAIL" | "WHATSAPP" | "NONE";
  previousRetrySucceeded: boolean;
  now: string;
}

export interface RecoveryPolicyConfig {
  maxRetries: number;
  maxContacts: number;
  minContactIntervalHours: number;
  highValueThresholdPaisa: number;
  minAiConfidence: number;
  stopAfterSuccess: boolean;
  respectOptOut: boolean;
  disputeEscalation: boolean;
}

export const DEFAULT_POLICY: RecoveryPolicyConfig = {
  maxRetries: 3,
  maxContacts: 3,
  minContactIntervalHours: 12,
  highValueThresholdPaisa: 5_000_000,
  minAiConfidence: 0.7,
  stopAfterSuccess: true,
  respectOptOut: true,
  disputeEscalation: true,
};

export interface PolicyCheck {
  code: string;
  result: "PASS" | "FAIL" | "REVIEW" | "NOT_APPLICABLE";
  explanation: string;
}

export interface PolicyResult {
  outcome: PolicyOutcome;
  reasonCode: string;
  explanation: string;
  checks: PolicyCheck[];
}

export interface RecoveryCaseRecord extends RecoveryContext {
  id: string;
  state: RecoveryState;
  currency: string;
  customerId: string;
  customerName: string;
  paymentId: string;
  providerPaymentId?: string;
  subscriptionId: string;
  source: "RAZORPAY" | "SIMULATOR";
  currentAction?: RecoveryAction;
  recoveredAmountPaisa: number;
  aiConfidence?: number;
  nextActionAt?: string;
  escalationReason?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecord {
  id: string;
  recoveryCaseId?: string;
  providerEventId?: string;
  type: string;
  fromState?: RecoveryState;
  toState?: RecoveryState;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StoredAction {
  id: string;
  recoveryCaseId: string;
  decisionId?: string;
  type: RecoveryAction;
  status: "SCHEDULED" | "PENDING" | "EXECUTED" | "FAILED" | "CANCELLED" | "NO_OP";
  idempotencyKey: string;
  providerReferenceId?: string;
  providerResourceUrl?: string;
  scheduledFor?: string;
  providerOperationId?: string;
  result?: Record<string, unknown>;
  attempts: number;
  error?: string;
  executedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionResult {
  status: "EXECUTED" | "SCHEDULED" | "NO_OP";
  providerOperationId?: string;
  providerReferenceId?: string;
  providerResourceUrl?: string;
  recovered: boolean;
  recoveredAmountPaisa: number;
  message: string;
  metadata: Record<string, unknown>;
}

export type ChaosScenario =
  | "NONE"
  | "DUPLICATE_WEBHOOK"
  | "AI_TIMEOUT"
  | "AI_INVALID_OUTPUT"
  | "MESSAGE_PROVIDER_DOWN"
  | "PAYMENT_SUCCESS_DURING_WAIT"
  | "ACTION_EXECUTOR_TIMEOUT";
