# RecoverAI Architecture

## System flow

```text
Razorpay Webhook
       |
       v
Event Ingestion
       |
       v
Idempotency Check
       |
       v
Recovery Case
       |
       v
Context Builder
       |
       v
AI Decision Engine
       |
       v
Structured Action
       |
       v
Policy Engine
       |
       +----------+-------------+
       |          |             |
       v          v             v
     Allow      Block       Escalate
       |
       v
Action Executor
       |
       v
Razorpay / WhatsApp / Email
       |
       v
Observe Result
       |
       v
Recovery State Machine
       |
       v
Recovered / Retry / Escalated / Stopped
       |
       v
Audit Log
```

## Technical stack

- Frontend: Next.js with TypeScript
- Backend: Node.js with TypeScript
- Database: PostgreSQL
- ORM: Prisma
- AI: OpenAI or OpenRouter API with structured JSON output
- Payments: Razorpay Test Mode
- Validation: Zod
- Testing: Vitest

Start with a database-backed state machine. Introduce Temporal only if durable,
long-running orchestration becomes a demonstrated requirement.

The first working vertical slice is:

```text
event -> case -> decision -> policy -> action -> result
```

## Core module boundaries

### Event ingestion

Validates external events, stores the raw metadata required for auditing, and
enforces event idempotency before domain processing.

### Payment provider adapter

Maps provider-specific webhooks and API results to internal domain types.
Razorpay-specific types must not leak through the domain layer.

```text
Razorpay -> RazorpayAdapter -> Internal PaymentEvent
```

### Recovery engine

Owns the recovery case lifecycle and coordinates decision, policy, action,
outcome observation, and stopping behavior.

### Decision provider

Implements a stable `RecoveryDecisionProvider` interface.

```text
RecoveryDecisionProvider
          ^
          |
     +----+----+
     |         |
   Mock     OpenAI / OpenRouter
```

The model returns structured output containing:

- action
- confidence
- reason code
- human-readable explanation
- recommended delay when applicable

The model cannot make arbitrary tool calls. The deterministic mock provider
remains available for tests and local demonstrations.

### Policy engine

Returns `ALLOW`, `BLOCK`, or `ESCALATE` with stable reason codes. It contains no
LLM calls and is authoritative over proposed actions.

### Action executor

Executes or simulates approved actions using idempotency keys. Every attempt and
result is auditable.

For Razorpay Payment Links, the executor persists a stable RecoverAI action key
and a compact non-PII `reference_id` before the provider call. It looks up that
reference before creation and after ambiguous failures, adopting an existing
link or retrying with the same reference rather than creating a second link.
The signed `payment_link.paid` adapter reconciles by the stored Payment Link
identity and validates amount/currency before the engine transitions a case to
`RECOVERED`.

### Simulator

Generates a seeded, held-out dataset and runs the fixed baseline and RecoverAI
strategy against identical cases without leaking hidden outcome variables.

## Recovery case states

- `DETECTED`
- `ANALYZING`
- `DECISION_READY`
- `POLICY_CHECK`
- `SCHEDULED`
- `ACTION_PENDING`
- `ACTION_EXECUTED`
- `WAITING`
- `RECOVERED`
- `ESCALATED`
- `STOPPED`
- `FAILED`

Valid transitions must be declared explicitly. Invalid transitions must produce
a controlled error. Every successful transition creates an immutable audit
event.

## First vertical slice

When a simulated `payment.failed` event arrives, the system must:

1. validate the event
2. enforce idempotency
3. create or update a `RecoveryCase`
4. collect customer and payment context
5. obtain a recovery decision from the mock provider
6. validate the decision through the deterministic policy engine
7. simulate the approved execution
8. record the result
9. write every important step to the audit log

Do not begin this slice with an LLM or dashboard. Prove the entire deterministic
workflow with tests first.

## Failure injection

Recovery Lab must support:

- `DUPLICATE_WEBHOOK`
- `AI_TIMEOUT`
- `AI_INVALID_OUTPUT`
- `MESSAGE_PROVIDER_DOWN`
- `PAYMENT_SUCCESS_DURING_WAIT`
- `ACTION_EXECUTOR_TIMEOUT`

Required safe behavior:

- no duplicate payment actions
- no duplicate outbound messages
- recoverable workflows after transient failures
- cancellation of pending recovery actions after payment success
- no policy bypass after AI failure
- complete failure visibility in the audit trail
