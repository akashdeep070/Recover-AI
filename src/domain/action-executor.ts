import { createHash } from "node:crypto";
import type { ChaosScenario, ExecutionResult, RecoveryAction, RecoveryContext } from "./types";

export interface ActionExecutionRequest {
  action: RecoveryAction;
  context: RecoveryContext;
  actionId: string;
  idempotencyKey: string;
  communicationIntent?: string;
}

export interface ActionExecutor {
  execute(request: ActionExecutionRequest): Promise<ExecutionResult>;
}

export class ActionExecutionError extends Error {
  constructor(
    public readonly code: "PROVIDER_DOWN" | "TIMEOUT" | "UNAUTHORIZED_ACTION",
    message: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "ActionExecutionError";
  }
}

export interface PaymentLinkRecord {
  id: string;
  shortUrl?: string;
  referenceId: string;
  amountPaisa: number;
  currency: string;
  status?: string;
}

export interface PaymentLinkCreateInput {
  amountPaisa: number;
  currency: string;
  referenceId: string;
  description: string;
  notes: Record<string, string>;
}

export interface RazorpayPaymentLinkClient {
  createPaymentLink(input: PaymentLinkCreateInput): Promise<PaymentLinkRecord>;
  findPaymentLinkByReference(referenceId: string): Promise<PaymentLinkRecord | null>;
}

export class RazorpayPaymentLinkApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly ambiguous: boolean,
    public readonly duplicateReference: boolean,
  ) {
    super(message);
    this.name = "RazorpayPaymentLinkApiError";
  }
}

function text(value: unknown, fallback?: string): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function paymentLinkFromPayload(payload: unknown, fallbackReferenceId?: string): PaymentLinkRecord {
  const value = payload && typeof payload === "object" ? payload : {};
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  const amountPaisa = finiteNumber(record.amount);
  const currency = text(record.currency);
  const referenceId = text(record.reference_id, fallbackReferenceId);
  if (!id || amountPaisa === undefined || !currency || !referenceId) {
    throw new RazorpayPaymentLinkApiError(
      200,
      "Razorpay returned an incomplete Payment Link payload.",
      false,
      false,
    );
  }
  return {
    id,
    shortUrl: text(record.short_url),
    referenceId,
    amountPaisa,
    currency,
    status: text(record.status),
  };
}

export class RazorpayPaymentLinkApiClient implements RazorpayPaymentLinkClient {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly baseUrl = "https://api.razorpay.com/v1",
    private readonly timeoutMs = 10_000,
  ) {}

  async createPaymentLink(input: PaymentLinkCreateInput): Promise<PaymentLinkRecord> {
    const payload = await this.request("/payment_links", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountPaisa,
        currency: input.currency,
        accept_partial: false,
        reference_id: input.referenceId,
        description: input.description,
        notes: input.notes,
      }),
    });
    return paymentLinkFromPayload(payload, input.referenceId);
  }

  async findPaymentLinkByReference(referenceId: string): Promise<PaymentLinkRecord | null> {
    const payload = await this.request(
      `/payment_links?reference_id=${encodeURIComponent(referenceId)}`,
      { method: "GET" },
    );
    const items =
      payload &&
      typeof payload === "object" &&
      Array.isArray((payload as { items?: unknown }).items)
        ? (payload as { items: unknown[] }).items
        : [];
    const item = items.find((candidate) => candidate && typeof candidate === "object");
    return item ? paymentLinkFromPayload(item, referenceId) : null;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      let payload: unknown = {};
      try {
        payload = await response.json();
      } catch {
        // Preserve the status category when Razorpay returns an empty/non-JSON body.
      }
      if (!response.ok) {
        const payloadObject = payload && typeof payload === "object" ? payload : {};
        const errorObject =
          payloadObject && typeof (payloadObject as { error?: unknown }).error === "object"
            ? ((payloadObject as { error: Record<string, unknown> }).error ?? {})
            : {};
        const description =
          text(errorObject.description) ??
          `Razorpay Test Mode request failed with HTTP ${response.status}.`;
        const normalized = description.toLowerCase();
        throw new RazorpayPaymentLinkApiError(
          response.status,
          `Razorpay Test Mode request failed with HTTP ${response.status}.`,
          response.status >= 500 || response.status === 408 || response.status === 429,
          normalized.includes("reference") &&
            (normalized.includes("exist") ||
              normalized.includes("unique") ||
              normalized.includes("duplicate")),
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof RazorpayPaymentLinkApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RazorpayPaymentLinkApiError(
          408,
          "Razorpay Test Mode request timed out; provider state is unknown.",
          true,
          false,
        );
      }
      throw new RazorpayPaymentLinkApiError(
        0,
        "Razorpay Test Mode request failed; provider state is unknown.",
        true,
        false,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function razorpayReferenceId(actionIdentity: string): string {
  return `rec_${createHash("sha256").update(actionIdentity).digest("hex").slice(0, 36)}`;
}

export class SandboxActionExecutor implements ActionExecutor {
  private readonly results = new Map<string, ExecutionResult>();

  constructor(private readonly chaos: ChaosScenario = "NONE") {}

  async execute(request: ActionExecutionRequest): Promise<ExecutionResult> {
    const existing = this.results.get(request.idempotencyKey);
    if (existing) return existing;

    if (
      this.chaos === "MESSAGE_PROVIDER_DOWN" &&
      [
        "SEND_EMAIL",
        "SEND_WHATSAPP",
        "SEND_PAYMENT_LINK",
        "REQUEST_PAYMENT_METHOD_UPDATE",
      ].includes(request.action)
    ) {
      throw new ActionExecutionError(
        "PROVIDER_DOWN",
        "Injected outbound provider outage; action is safe to retry with the same idempotency key.",
        true,
      );
    }

    if (this.chaos === "ACTION_EXECUTOR_TIMEOUT") {
      throw new ActionExecutionError(
        "TIMEOUT",
        "Injected executor timeout; operation remains unresolved and cannot be replayed with a new key.",
        true,
      );
    }

    const suffix = request.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(-10);
    let result: ExecutionResult;
    switch (request.action) {
      case "WAIT":
        result = {
          status: "SCHEDULED",
          recovered: false,
          recoveredAmountPaisa: 0,
          message: "Workflow paused until the next observation window.",
          metadata: { adapter: "sandbox-scheduler" },
        };
        break;
      case "STOP":
        result = {
          status: "NO_OP",
          recovered: false,
          recoveredAmountPaisa: 0,
          message: "Workflow stopped without an external side effect.",
          metadata: { adapter: "deterministic-stop" },
        };
        break;
      case "ESCALATE":
        result = {
          status: "NO_OP",
          recovered: false,
          recoveredAmountPaisa: 0,
          message: "Case routed to human review without an external intervention.",
          metadata: { adapter: "review-queue" },
        };
        break;
      case "SMART_RETRY":
        result = {
          status: "EXECUTED",
          providerOperationId: `retry_sandbox_${suffix}`,
          recovered: false,
          recoveredAmountPaisa: 0,
          message:
            "A Razorpay Test Mode-compatible retry was simulated and is awaiting outcome observation.",
          metadata: { adapter: "razorpay-sandbox", idempotent: true },
        };
        break;
      case "SEND_PAYMENT_LINK":
        result = {
          status: "EXECUTED",
          providerOperationId: `plink_sandbox_${suffix}`,
          recovered: false,
          recoveredAmountPaisa: 0,
          message: "A scoped sandbox payment link was created and queued for delivery.",
          metadata: { adapter: "payment-link-sandbox", expiresInHours: 48, idempotent: true },
        };
        break;
      case "SEND_EMAIL":
      case "SEND_WHATSAPP":
      case "REQUEST_PAYMENT_METHOD_UPDATE":
        result = {
          status: "EXECUTED",
          providerOperationId: `message_sandbox_${suffix}`,
          recovered: false,
          recoveredAmountPaisa: 0,
          message: `${request.action} was accepted by the sandbox message adapter.`,
          metadata: {
            adapter: "message-sandbox",
            intent: request.communicationIntent ?? "Recovery assistance",
            idempotent: true,
          },
        };
        break;
    }

    this.results.set(request.idempotencyKey, result);
    return result;
  }
}

export class RazorpayTestModeExecutor implements ActionExecutor {
  private readonly sandbox = new SandboxActionExecutor();
  private readonly client: RazorpayPaymentLinkClient;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    client?: RazorpayPaymentLinkClient,
  ) {
    if (!keyId.startsWith("rzp_test_")) {
      throw new Error("RecoverAI only permits Razorpay Test Mode credentials.");
    }
    this.client = client ?? new RazorpayPaymentLinkApiClient(keyId, keySecret);
  }

  async execute(request: ActionExecutionRequest): Promise<ExecutionResult> {
    if (request.action !== "SEND_PAYMENT_LINK") {
      return this.sandbox.execute(request);
    }
    const referenceId = razorpayReferenceId(request.actionId || request.idempotencyKey);
    const existing = await this.findExisting(referenceId);
    if (existing) {
      this.assertExpectedLink(existing, request);
      return this.result(existing, "adopted");
    }

    try {
      const created = await this.client.createPaymentLink({
        amountPaisa: request.context.amountPaisa,
        currency: request.context.currency ?? "INR",
        referenceId,
        description: `RecoverAI subscription recovery ${request.context.caseId}`.slice(0, 255),
        notes: { recovery_case_id: request.context.caseId, mode: "test" },
      });
      this.assertExpectedLink(created, request);
      return this.result(created, "created");
    } catch (error) {
      if (!(error instanceof RazorpayPaymentLinkApiError)) throw error;
      if (!error.ambiguous && !error.duplicateReference) throw this.toActionError(error);

      const reconciled = await this.findExisting(referenceId);
      if (reconciled) {
        this.assertExpectedLink(reconciled, request);
        return this.result(reconciled, "reconciled");
      }
      if (error.duplicateReference) throw this.toActionError(error);

      try {
        const retried = await this.client.createPaymentLink({
          amountPaisa: request.context.amountPaisa,
          currency: request.context.currency ?? "INR",
          referenceId,
          description: `RecoverAI subscription recovery ${request.context.caseId}`.slice(0, 255),
          notes: { recovery_case_id: request.context.caseId, mode: "test" },
        });
        this.assertExpectedLink(retried, request);
        return this.result(retried, "retried");
      } catch (retryError) {
        if (!(retryError instanceof RazorpayPaymentLinkApiError)) throw retryError;
        if (retryError.ambiguous || retryError.duplicateReference) {
          const adopted = await this.findExisting(referenceId);
          if (adopted) {
            this.assertExpectedLink(adopted, request);
            return this.result(adopted, "reconciled-after-retry");
          }
        }
        throw this.toActionError(retryError);
      }
    }
  }

  private async findExisting(referenceId: string): Promise<PaymentLinkRecord | null> {
    try {
      return await this.client.findPaymentLinkByReference(referenceId);
    } catch (error) {
      if (error instanceof RazorpayPaymentLinkApiError) throw this.toActionError(error);
      throw error;
    }
  }

  private result(link: PaymentLinkRecord, resolution: string): ExecutionResult {
    return {
      status: "EXECUTED",
      providerOperationId: link.id,
      providerReferenceId: link.referenceId,
      providerResourceUrl: link.shortUrl,
      recovered: false,
      recoveredAmountPaisa: 0,
      message:
        resolution === "created"
          ? "Razorpay Test Mode payment link created; payment outcome is pending."
          : `Razorpay Test Mode payment link ${resolution}; payment outcome is pending.`,
      metadata: {
        adapter: "razorpay-test-mode",
        shortUrl: link.shortUrl,
        providerReferenceId: link.referenceId,
        providerOperationId: link.id,
        resolution,
        amountPaisa: link.amountPaisa,
        currency: link.currency,
        status: link.status,
        idempotent: true,
      },
    };
  }

  private assertExpectedLink(link: PaymentLinkRecord, request: ActionExecutionRequest): void {
    const expectedCurrency = request.context.currency ?? "INR";
    if (link.amountPaisa !== request.context.amountPaisa || link.currency !== expectedCurrency) {
      throw new ActionExecutionError(
        "UNAUTHORIZED_ACTION",
        "Razorpay returned a Payment Link with an unexpected amount or currency.",
        false,
      );
    }
  }

  private toActionError(error: RazorpayPaymentLinkApiError): ActionExecutionError {
    return new ActionExecutionError(
      error.ambiguous ? "TIMEOUT" : error.status >= 500 ? "PROVIDER_DOWN" : "UNAUTHORIZED_ACTION",
      error.message,
      error.ambiguous || error.status >= 500,
    );
  }
}

export function configuredActionExecutor(): ActionExecutor {
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return new RazorpayTestModeExecutor(
      process.env.RAZORPAY_KEY_ID,
      process.env.RAZORPAY_KEY_SECRET,
    );
  }
  return new SandboxActionExecutor();
}
