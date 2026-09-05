import { recoveryDecisionSchema, type RecoveryContext, type RecoveryDecision } from "./types";

export interface RecoveryDecisionProvider {
  readonly name: string;
  decide(context: RecoveryContext): Promise<RecoveryDecision | unknown>;
}

export class DecisionProviderError extends Error {
  constructor(
    public readonly code: "TIMEOUT" | "INVALID_OUTPUT" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "DecisionProviderError";
  }
}

export class DeterministicDecisionProvider implements RecoveryDecisionProvider {
  readonly name = "deterministic-mock-v1";

  async decide(context: RecoveryContext): Promise<RecoveryDecision> {
    if (context.paymentStatus === "SUCCEEDED") {
      return {
        action: "STOP",
        confidence: 1,
        reasonCode: "PAYMENT_ALREADY_SUCCEEDED",
        explanation:
          "Payment has succeeded, so further recovery activity would create unnecessary risk.",
      };
    }

    if (context.disputed || context.fraudSignal || context.inconsistentState) {
      return {
        action: "ESCALATE",
        confidence: 0.96,
        reasonCode: context.disputed ? "BILLING_DISPUTE" : "CONFLICTING_RISK_SIGNAL",
        explanation:
          "The available signals make a human review safer than an automated intervention.",
      };
    }

    if (context.amountPaisa > 5_000_000) {
      return {
        action: "ESCALATE",
        confidence: 0.94,
        reasonCode: "HIGH_VALUE_CASE",
        explanation:
          "The payment value is above the automatic approval boundary and should be reviewed.",
      };
    }

    if (context.optedOut) {
      return {
        action: "STOP",
        confidence: 0.99,
        reasonCode: "CUSTOMER_OPTED_OUT",
        explanation: "Customer consent requires the automated communication workflow to stop.",
      };
    }

    if (context.nextProviderRetryAt) {
      return {
        action: "WAIT",
        confidence: 0.94,
        reasonCode: "PROVIDER_RETRY_SCHEDULED",
        explanation:
          "A provider retry is already scheduled; another intervention would add friction without useful information.",
        recommendedDelayHours: Math.max(
          1,
          Math.ceil(
            (new Date(context.nextProviderRetryAt).getTime() - new Date(context.now).getTime()) /
              3_600_000,
          ),
        ),
      };
    }

    if (["INVALID", "EXPIRED"].includes(context.mandateState)) {
      return {
        action: "REQUEST_PAYMENT_METHOD_UPDATE",
        confidence: 0.91,
        reasonCode: "MANDATE_UPDATE_REQUIRED",
        explanation:
          "Retrying the same mandate cannot succeed; the customer needs a secure update path.",
        communicationIntent:
          "Ask the customer to update the expired or invalid payment method securely.",
      };
    }

    if (context.retryCount >= 3 && context.contactCount >= 3) {
      return {
        action: "STOP",
        confidence: 0.98,
        reasonCode: "RECOVERY_LIMITS_REACHED",
        explanation:
          "Both retry and communication budgets are exhausted, so further automation must stop.",
      };
    }

    if (context.retryCount >= 3) {
      return {
        action: "SEND_PAYMENT_LINK",
        confidence: 0.81,
        reasonCode: "RETRY_BUDGET_EXHAUSTED",
        explanation:
          "The retry budget is exhausted; a secure alternate payment path avoids another debit attempt.",
        communicationIntent:
          "Offer one secure alternate payment path without attempting another charge.",
      };
    }

    if (context.contactCount >= 3) {
      if (
        ["INSUFFICIENT_FUNDS", "TECHNICAL_ERROR"].includes(context.failureReason) &&
        context.mandateState === "ACTIVE"
      ) {
        return {
          action: "SMART_RETRY",
          confidence: 0.83,
          reasonCode: "CONTACT_BUDGET_EXHAUSTED",
          explanation:
            "No more customer contact is allowed; a remaining bounded retry is the only eligible automatic path.",
          recommendedDelayHours: 24,
        };
      }
      return {
        action: "STOP",
        confidence: 0.97,
        reasonCode: "CONTACT_LIMIT_REACHED",
        explanation:
          "Further outreach would exceed the customer-contact limit and no safe retry path is available.",
      };
    }

    if (context.failureReason === "INSUFFICIENT_FUNDS" && context.successfulPayments >= 3) {
      return {
        action: "SMART_RETRY",
        confidence: context.previousRetrySucceeded ? 0.91 : 0.84,
        reasonCode: "TEMPORARY_BALANCE_FAILURE",
        explanation:
          "A strong successful-payment history makes a bounded, delayed retry less disruptive than immediate outreach.",
        recommendedDelayHours: context.valueSegment === "STRATEGIC" ? 24 : 12,
      };
    }

    if (["UNKNOWN", "INCONSISTENT"].includes(context.failureReason)) {
      return {
        action: "SEND_EMAIL",
        confidence: 0.58,
        reasonCode: "AMBIGUOUS_FAILURE",
        explanation:
          "The failure signal is ambiguous; a low-friction clarification would normally be appropriate.",
        communicationIntent: "Explain the failed renewal and provide a safe support path.",
      };
    }

    if (context.preferredChannel === "WHATSAPP") {
      return {
        action: "SEND_WHATSAPP",
        confidence: 0.82,
        reasonCode: "PREFERRED_CHANNEL",
        explanation:
          "A concise reminder on the customer-preferred channel is the least disruptive next step.",
        communicationIntent:
          "Share a concise renewal reminder without exposing sensitive payment data.",
      };
    }

    return {
      action: "SEND_PAYMENT_LINK",
      confidence: 0.79,
      reasonCode: "ALTERNATE_PAYMENT_PATH",
      explanation:
        "A scoped payment link provides a controlled alternative without retrying the failed instrument.",
      communicationIntent:
        "Offer a time-limited secure payment link for the outstanding subscription renewal.",
    };
  }
}

const decisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [
        "WAIT",
        "SMART_RETRY",
        "REQUEST_PAYMENT_METHOD_UPDATE",
        "SEND_WHATSAPP",
        "SEND_EMAIL",
        "SEND_PAYMENT_LINK",
        "ESCALATE",
        "STOP",
      ],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasonCode: { type: "string", pattern: "^[A-Z0-9_]+$" },
    explanation: { type: "string", minLength: 8, maxLength: 500 },
    recommendedDelayHours: { type: "integer", minimum: 0, maximum: 168 },
    communicationIntent: { type: "string", minLength: 3, maxLength: 280 },
  },
  required: ["action", "confidence", "reasonCode", "explanation"],
} as const;

function extractResponseText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return undefined;
}

export class AIDecisionProvider implements RecoveryDecisionProvider {
  readonly name = "openai-structured-output";

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_MODEL ?? "gpt-5-mini",
    private readonly timeoutMs = 10_000,
  ) {}

  async decide(context: RecoveryContext): Promise<RecoveryDecision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: [
            {
              role: "system",
              content:
                "Choose exactly one bounded recovery action. Judge ambiguous context only. Never claim authorization or override policy. Prefer WAIT or STOP when action adds risk or customer friction.",
            },
            {
              role: "user",
              content: JSON.stringify(context),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "recovery_decision",
              strict: true,
              schema: decisionJsonSchema,
            },
          },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new DecisionProviderError(
          "UNAVAILABLE",
          `AI provider returned HTTP ${response.status}.`,
        );
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const text = extractResponseText(payload);
      if (!text)
        throw new DecisionProviderError(
          "INVALID_OUTPUT",
          "AI response did not contain structured text.",
        );
      const parsedJson: unknown = JSON.parse(text);
      const parsed = recoveryDecisionSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new DecisionProviderError(
          "INVALID_OUTPUT",
          "AI response failed the recovery-decision schema.",
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof DecisionProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new DecisionProviderError("TIMEOUT", "AI decision timed out safely.");
      }
      throw new DecisionProviderError(
        "UNAVAILABLE",
        error instanceof Error ? error.message : "AI provider failed.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

const DEFAULT_OPENROUTER_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "minimax/minimax-m3:free",
  "nvidia/nemotron-3.5-lightning:free",
] as const;

function extractChatResponseText(payload: Record<string, unknown>): string | undefined {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as { message?: unknown }).message
      : undefined;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(
      (part): part is { type?: unknown; text?: unknown } => !!part && typeof part === "object",
    )
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text || undefined;
}

export class OpenRouterDecisionProvider implements RecoveryDecisionProvider {
  readonly name = "openrouter-structured-output";

  constructor(
    private readonly apiKey: string,
    private readonly models: readonly string[] = DEFAULT_OPENROUTER_MODELS,
    private readonly timeoutMs = 10_000,
  ) {
    if (models.length === 0) {
      throw new Error("OpenRouter requires at least one model.");
    }
  }

  async decide(context: RecoveryContext): Promise<RecoveryDecision> {
    let lastError: DecisionProviderError | undefined;
    for (const model of this.models) {
      try {
        return await this.decideWithModel(context, model);
      } catch (error) {
        lastError =
          error instanceof DecisionProviderError
            ? error
            : new DecisionProviderError(
                "UNAVAILABLE",
                error instanceof Error ? error.message : "OpenRouter provider failed.",
              );
      }
    }
    throw new DecisionProviderError(
      lastError?.code ?? "UNAVAILABLE",
      `All configured OpenRouter models failed safely. ${lastError?.message ?? "No model responded."}`,
    );
  }

  private async decideWithModel(
    context: RecoveryContext,
    model: string,
  ): Promise<RecoveryDecision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      };
      if (process.env.OPENROUTER_SITE_URL) {
        headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
      }
      if (process.env.OPENROUTER_APP_NAME) {
        headers["X-Title"] = process.env.OPENROUTER_APP_NAME;
      }
      const response = await fetch(
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  "Choose exactly one bounded recovery action. Judge ambiguous context only. Never claim authorization or override policy. Prefer WAIT or STOP when action adds risk or customer friction.",
              },
              { role: "user", content: JSON.stringify(context) },
            ],
            temperature: 0,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "recovery_decision",
                strict: true,
                schema: decisionJsonSchema,
              },
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new DecisionProviderError(
          "UNAVAILABLE",
          `OpenRouter model ${model} returned HTTP ${response.status}.`,
        );
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const text = extractChatResponseText(payload);
      if (!text) {
        throw new DecisionProviderError(
          "INVALID_OUTPUT",
          `OpenRouter model ${model} did not return structured text.`,
        );
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(text);
      } catch {
        throw new DecisionProviderError(
          "INVALID_OUTPUT",
          `OpenRouter model ${model} returned non-JSON output.`,
        );
      }
      const parsed = recoveryDecisionSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new DecisionProviderError(
          "INVALID_OUTPUT",
          `OpenRouter model ${model} failed the recovery-decision schema.`,
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof DecisionProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new DecisionProviderError("TIMEOUT", `OpenRouter model ${model} timed out safely.`);
      }
      throw new DecisionProviderError(
        "UNAVAILABLE",
        error instanceof Error ? error.message : `OpenRouter model ${model} failed.`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function configuredDecisionProvider(): RecoveryDecisionProvider {
  if (process.env.DECISION_PROVIDER === "openrouter" && process.env.OPENROUTER_API_KEY) {
    const models = (process.env.OPENROUTER_MODELS ?? DEFAULT_OPENROUTER_MODELS.join(","))
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    return new OpenRouterDecisionProvider(process.env.OPENROUTER_API_KEY, models);
  }
  if (process.env.DECISION_PROVIDER === "ai" && process.env.OPENAI_API_KEY) {
    return new AIDecisionProvider(process.env.OPENAI_API_KEY);
  }
  return new DeterministicDecisionProvider();
}

export function validateDecision(value: unknown): RecoveryDecision {
  const parsed = recoveryDecisionSchema.safeParse(value);
  if (!parsed.success) {
    throw new DecisionProviderError(
      "INVALID_OUTPUT",
      "Decision provider returned malformed or unsupported output.",
    );
  }
  return parsed.data;
}

export class ChaosDecisionProvider implements RecoveryDecisionProvider {
  readonly name: string;

  constructor(
    private readonly base: RecoveryDecisionProvider,
    private readonly scenario: "AI_TIMEOUT" | "AI_INVALID_OUTPUT",
  ) {
    this.name = `chaos-${scenario.toLowerCase()}`;
  }

  async decide(context: RecoveryContext): Promise<RecoveryDecision | unknown> {
    if (this.scenario === "AI_TIMEOUT") {
      throw new DecisionProviderError("TIMEOUT", "Injected AI timeout.");
    }
    if (this.scenario === "AI_INVALID_OUTPUT") {
      return { action: "CHARGE_ANY_AMOUNT", confidence: "certain" };
    }
    return this.base.decide(context);
  }
}
