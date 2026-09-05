import {
  DEFAULT_POLICY,
  RECOVERY_ACTIONS,
  type PolicyCheck,
  type PolicyResult,
  type RecoveryContext,
  type RecoveryDecision,
  type RecoveryPolicyConfig,
} from "./types";

const CONTACT_ACTIONS = new Set([
  "REQUEST_PAYMENT_METHOD_UPDATE",
  "SEND_WHATSAPP",
  "SEND_EMAIL",
  "SEND_PAYMENT_LINK",
]);

function hoursSince(iso: string | undefined, now: string): number | null {
  if (!iso) return null;
  return (new Date(now).getTime() - new Date(iso).getTime()) / 3_600_000;
}

function check(code: string, result: PolicyCheck["result"], explanation: string): PolicyCheck {
  return { code, result, explanation };
}

export function evaluatePolicy(
  context: RecoveryContext,
  proposed: RecoveryDecision | Record<string, unknown>,
  config: RecoveryPolicyConfig = DEFAULT_POLICY,
): PolicyResult {
  const action = typeof proposed.action === "string" ? proposed.action : "";
  const confidence = typeof proposed.confidence === "number" ? proposed.confidence : 0;
  const checks: PolicyCheck[] = [];

  if (!RECOVERY_ACTIONS.includes(action as (typeof RECOVERY_ACTIONS)[number])) {
    checks.push(
      check(
        "SUPPORTED_ACTION",
        "FAIL",
        "The model proposed an action outside the bounded action space.",
      ),
    );
    return {
      outcome: "BLOCK",
      reasonCode: "UNSUPPORTED_ACTION",
      explanation: "Unsupported model output cannot be authorized or executed.",
      checks,
    };
  }
  checks.push(check("SUPPORTED_ACTION", "PASS", `${action} is in the bounded action space.`));

  if (config.stopAfterSuccess && context.paymentStatus === "SUCCEEDED") {
    checks.push(check("PAYMENT_NOT_RECOVERED", "FAIL", "Payment has already succeeded."));
    return {
      outcome: "BLOCK",
      reasonCode: "PAYMENT_ALREADY_RECOVERED",
      explanation: "No recovery intervention is permitted after successful payment.",
      checks,
    };
  }
  checks.push(check("PAYMENT_NOT_RECOVERED", "PASS", "Payment still requires recovery."));

  if (context.subscriptionStatus !== "ACTIVE") {
    checks.push(
      check("SUBSCRIPTION_ACTIVE", "FAIL", `Subscription is ${context.subscriptionStatus}.`),
    );
    return {
      outcome: "BLOCK",
      reasonCode: "SUBSCRIPTION_INACTIVE",
      explanation: "Recovery actions stop for paused or cancelled subscriptions.",
      checks,
    };
  }
  checks.push(check("SUBSCRIPTION_ACTIVE", "PASS", "Subscription is active."));

  if (["INVALID", "EXPIRED"].includes(context.mandateState) && action === "SMART_RETRY") {
    checks.push(check("MANDATE_VALID", "FAIL", `Mandate is ${context.mandateState}.`));
    return {
      outcome: "BLOCK",
      reasonCode: "MANDATE_INVALID",
      explanation: "A debit retry cannot run against an invalid or expired mandate.",
      checks,
    };
  }
  checks.push(
    check(
      "MANDATE_VALID",
      "PASS",
      ["INVALID", "EXPIRED"].includes(context.mandateState)
        ? "The proposed action does not debit the invalid mandate."
        : "Mandate is eligible for the proposed action.",
    ),
  );

  if (action === "SMART_RETRY" && context.retryCount >= config.maxRetries) {
    checks.push(
      check("RETRY_LIMIT", "FAIL", `Retry limit of ${config.maxRetries} has been reached.`),
    );
    return {
      outcome: "BLOCK",
      reasonCode: "MAX_RETRIES_REACHED",
      explanation: "The deterministic retry limit prevents another payment attempt.",
      checks,
    };
  }
  checks.push(
    check(
      "RETRY_LIMIT",
      action === "SMART_RETRY" ? "PASS" : "NOT_APPLICABLE",
      action === "SMART_RETRY"
        ? `${config.maxRetries - context.retryCount} automatic retries remain.`
        : "The proposed action is not a payment retry.",
    ),
  );

  const isContact = CONTACT_ACTIONS.has(action);
  if (isContact && config.respectOptOut && context.optedOut) {
    checks.push(check("CUSTOMER_CONSENT", "FAIL", "Customer has opted out of automated contact."));
    return {
      outcome: "BLOCK",
      reasonCode: "CUSTOMER_OPTED_OUT",
      explanation: "Customer consent overrides the model recommendation.",
      checks,
    };
  }
  checks.push(
    check(
      "CUSTOMER_CONSENT",
      isContact ? "PASS" : "NOT_APPLICABLE",
      isContact
        ? "Customer contact is permitted."
        : "The proposed action does not contact the customer.",
    ),
  );

  if (isContact && context.contactCount >= config.maxContacts) {
    checks.push(
      check("CONTACT_LIMIT", "FAIL", `Contact limit of ${config.maxContacts} has been reached.`),
    );
    return {
      outcome: "BLOCK",
      reasonCode: "MAX_CONTACTS_REACHED",
      explanation: "The deterministic contact cap prevents additional customer friction.",
      checks,
    };
  }
  checks.push(
    check(
      "CONTACT_LIMIT",
      isContact ? "PASS" : "NOT_APPLICABLE",
      isContact
        ? `${config.maxContacts - context.contactCount} automated contacts remain.`
        : "The proposed action does not consume the contact budget.",
    ),
  );

  const elapsed = hoursSince(context.lastContactAt, context.now);
  if (isContact && elapsed !== null && elapsed < config.minContactIntervalHours) {
    checks.push(
      check(
        "CONTACT_INTERVAL",
        "FAIL",
        `Only ${elapsed.toFixed(1)} hours have passed since the last contact.`,
      ),
    );
    return {
      outcome: "BLOCK",
      reasonCode: "CONTACT_INTERVAL_NOT_MET",
      explanation: `Wait at least ${config.minContactIntervalHours} hours between automated contacts.`,
      checks,
    };
  }
  checks.push(
    check(
      "CONTACT_INTERVAL",
      isContact ? "PASS" : "NOT_APPLICABLE",
      isContact ? "Minimum contact interval has been satisfied." : "No contact interval applies.",
    ),
  );

  const safeNoAction = action === "WAIT" || action === "STOP";
  if (action === "ESCALATE") {
    checks.push(check("MODEL_ESCALATION", "REVIEW", "The model requested human review."));
    return {
      outcome: "ESCALATE",
      reasonCode: "MODEL_REQUESTED_ESCALATION",
      explanation: "The case is routed to a human without executing an external action.",
      checks,
    };
  }

  if (!safeNoAction && context.amountPaisa > config.highValueThresholdPaisa) {
    checks.push(
      check("HIGH_VALUE_APPROVAL", "REVIEW", "Amount exceeds the automatic approval threshold."),
    );
    return {
      outcome: "ESCALATE",
      reasonCode: "HIGH_VALUE_REVIEW_REQUIRED",
      explanation: "A human must authorize high-value recovery interventions.",
      checks,
    };
  }
  checks.push(
    check(
      "HIGH_VALUE_APPROVAL",
      safeNoAction ? "NOT_APPLICABLE" : "PASS",
      safeNoAction
        ? "Waiting or stopping does not create financial exposure."
        : "Amount is within the automatic threshold.",
    ),
  );

  if (!safeNoAction && config.disputeEscalation && context.disputed) {
    checks.push(check("BILLING_DISPUTE", "REVIEW", "A billing dispute is active."));
    return {
      outcome: "ESCALATE",
      reasonCode: "BILLING_DISPUTE_REVIEW",
      explanation: "Disputed payments require human review before intervention.",
      checks,
    };
  }
  if (!safeNoAction && context.fraudSignal) {
    checks.push(check("FRAUD_SIGNAL", "REVIEW", "A fraud-related signal is present."));
    return {
      outcome: "ESCALATE",
      reasonCode: "FRAUD_REVIEW_REQUIRED",
      explanation: "Fraud signals cannot be handled by automated recovery.",
      checks,
    };
  }
  if (!safeNoAction && context.inconsistentState) {
    checks.push(check("STATE_CONSISTENCY", "REVIEW", "Payment state is inconsistent."));
    return {
      outcome: "ESCALATE",
      reasonCode: "INCONSISTENT_STATE_REVIEW",
      explanation: "Conflicting payment state must be reconciled by a human.",
      checks,
    };
  }
  checks.push(
    check("RISK_SIGNALS", "PASS", "No dispute, fraud, or inconsistent-state hold applies."),
  );

  if (!safeNoAction && confidence < config.minAiConfidence) {
    checks.push(
      check(
        "AI_CONFIDENCE",
        "REVIEW",
        `Confidence ${confidence.toFixed(2)} is below ${config.minAiConfidence.toFixed(2)}.`,
      ),
    );
    return {
      outcome: "ESCALATE",
      reasonCode: "LOW_CONFIDENCE_REVIEW",
      explanation: "Low-confidence interventions require human review.",
      checks,
    };
  }
  checks.push(
    check(
      "AI_CONFIDENCE",
      safeNoAction ? "NOT_APPLICABLE" : "PASS",
      safeNoAction
        ? "No-action decisions do not create execution risk."
        : "AI confidence meets the automatic threshold.",
    ),
  );

  return {
    outcome: "ALLOW",
    reasonCode: "POLICY_ALLOWED",
    explanation: "All deterministic constraints permit the bounded action.",
    checks,
  };
}
