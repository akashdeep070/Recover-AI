# RecoverAI

RecoverAI is a policy-governed AI revenue recovery controller for failed recurring and subscription payments. It detects revenue at risk, uses bounded AI judgment to choose an intervention, applies deterministic authorization, executes through idempotent adapters, observes outcomes, and preserves a complete audit trail.

All included demo and Recovery Lab money values are synthetic. Razorpay integrations are Test Mode only.

## What RecoverAI does

```text
Payment event
  -> normalize + deduplicate
  -> RecoveryCase
  -> observable context
  -> structured recovery decision
  -> deterministic policy engine
  -> bounded idempotent executor
  -> observe result
  -> state transition + immutable audit event
  -> recover / wait / escalate / stop
```

The supported model action space is exactly:

- `WAIT`
- `SMART_RETRY`
- `REQUEST_PAYMENT_METHOD_UPDATE`
- `SEND_WHATSAPP`
- `SEND_EMAIL`
- `SEND_PAYMENT_LINK`
- `ESCALATE`
- `STOP`

## Architecture

- Next.js 16 App Router and TypeScript for the product UI and HTTP boundaries.
- PostgreSQL with Prisma 7 for cases, provider events, decisions, policies, actions, reviews, evaluations, and audit history.
- Zod for webhook, API, policy-input, and structured-decision validation.
- A repository-driven recovery engine in `src/domain/` so financial and compliance behavior is testable without React.
- `PrismaRecoveryStore` for atomic state transition plus audit writes and optimistic case versions.
- Provider boundaries for Razorpay, OpenAI/OpenRouter, outbound actions, and deterministic sandbox behavior.
- Vitest for unit and end-to-end domain integration tests.

The explicit case state machine is:

`DETECTED → ANALYZING → DECISION_READY → POLICY_CHECK → SCHEDULED/ACTION_PENDING → ACTION_EXECUTED/WAITING → RECOVERED/ESCALATED/STOPPED/FAILED`

Invalid transitions throw a controlled error. `RECOVERED` and `STOPPED` are terminal. `FAILED` remains recoverable.

## Why AI is used

AI is used for ambiguous contextual judgment: whether to wait, retry, request an update, choose a communication channel, provide a payment link, escalate, or stop.

AI is deliberately **not** used for:

- money movement or authoritative financial calculations
- authorization
- retry or communication limits
- customer consent and opt-outs
- stopping conditions
- high-value approval
- state transitions
- idempotency
- audit history

Every AI result must pass the strict decision schema and the deterministic policy engine. Policy can return `ALLOW`, `BLOCK`, or `ESCALATE`; it is authoritative over the model.

## Setup

Prerequisites:

- Node.js 22
- PostgreSQL 14 or newer
- npm 10

```bash
createdb recover_ai
cp .env.example .env
npm install
npm run setup
npm run dev
```

Update `DATABASE_URL` in `.env` for your local PostgreSQL user before running setup. Open [http://localhost:3000](http://localhost:3000).

The verified local setup used:

```env
DATABASE_URL="postgresql://akashdeep@localhost:5432/recover_ai?schema=public"
DECISION_PROVIDER="mock"
```

## Environment variables

| Variable                   | Required        | Purpose                                          |
| -------------------------- | --------------- | ------------------------------------------------ |
| `DATABASE_URL`             | Yes             | PostgreSQL connection string                     |
| `DECISION_PROVIDER`        | No              | `mock` by default; supports `ai` or `openrouter` |
| `OPENAI_API_KEY`           | AI only         | Server-side OpenAI credential                    |
| `OPENAI_MODEL`             | No              | Defaults to `gpt-5-mini`                         |
| `OPENROUTER_API_KEY`       | OpenRouter only | Server-side OpenRouter credential                |
| `OPENROUTER_MODELS`        | No              | Comma-separated ordered model fallback list      |
| `OPENROUTER_BASE_URL`      | No              | Defaults to OpenRouter chat completions API      |
| `OPENROUTER_SITE_URL`      | No              | Optional OpenRouter HTTP-Referer header          |
| `OPENROUTER_APP_NAME`      | No              | Optional OpenRouter X-Title header               |
| `RAZORPAY_KEY_ID`          | Razorpay only   | Must be a `rzp_test_` key                        |
| `RAZORPAY_KEY_SECRET`      | Razorpay only   | Razorpay Test Mode server credential             |
| `RAZORPAY_WEBHOOK_SECRET`  | Razorpay only   | HMAC webhook verification secret                 |
| `RESEND_API_KEY`           | Not active      | Reserved for a future real email adapter         |
| `WHATSAPP_ACCESS_TOKEN`    | Not active      | Reserved for a future real WhatsApp adapter      |
| `WHATSAPP_PHONE_NUMBER_ID` | Not active      | Reserved for a future real WhatsApp adapter      |

Secrets are read only on the server. `.env` is ignored by Git.

## Database setup

The initial migration is in `prisma/migrations/20260824000000_init/`.

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

For local schema iteration only, `npm run db:push` is also available. The seed is idempotent and creates 12 named demo cases covering smart retry, expired method, intentional wait, high-value review, opt-out, dispute, attempt limits, payment success during wait, provider failure, duplicate webhook, low confidence, and payment-link recovery.

## Demo flow

1. Open **Overview** and establish the synthetic, PostgreSQL-backed control plane. Scroll to **Recovery intelligence** to show the persisted control funnel, recovered-volume attribution, customer-friction metrics, and the latest held-out comparison.
2. Open **Recovery Lab** and click **Run evaluation**.
3. Show the fixed seed, 100 identical cases, calculated incremental recovery, contact delta, escalations, policy violations, and duplicate actions.
4. Expand an evaluation case to show observable context, bounded decision, policy result, and outcome. Hidden simulator behavior is not sent to this UI.
5. Open **Recoveries → Ananya Bose** to show `WAIT`, policy authorization, the scheduled action cancellation, the `RECOVERED` state, and the immutable audit sequence.
6. Open **Needs Review** to show high-value, dispute, and low-confidence gates.
7. Open **Policies** to show and safely validate deterministic boundaries.
8. Return to **Recovery Lab** and inject duplicate webhook, invalid AI output, or payment success during wait.

For seed `20260823`, the verified synthetic run currently calculates:

- baseline recovered: ₹2,67,369
- RecoverAI recovered: ₹3,21,359
- incremental recovery: +₹53,990
- recovery-rate uplift: +4.0 percentage points
- contact delta: -4
- policy violations: 0
- duplicate actions: 0

These are reproducible simulator results, not customer or production outcomes.

## Razorpay Test Mode setup

1. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
2. Configure the Test Mode webhook URL as `/api/webhooks/razorpay`.
3. Subscribe to `payment.failed`, `payment.captured`/`payment.authorized`, `payment_link.paid`, `subscription.cancelled`, and `subscription.halted` as needed.
4. Send the webhook signature in `x-razorpay-signature`; `x-razorpay-event-id` is used when present.

When no provider event ID is supplied, the adapter derives a stable SHA-256 event ID from the signed raw body. Missing webhook configuration returns `503`; invalid signatures return `401`. The real adapter creates only Razorpay **Test Mode** payment links. Other actions stay inside the sandbox adapter unless a bounded integration is implemented.

Payment Link creation uses two idempotency layers: a durable RecoverAI action key and a deterministic, non-PII Razorpay `reference_id` (40 characters or fewer). RecoverAI looks up that reference before creating a link and reconciles it after ambiguous timeouts or duplicate-reference responses, so one logical recovery action cannot create a second link. A signed `payment_link.paid` event is matched to the stored provider link identity and checked for amount/currency before recovery is accounted.

## AI setup

```env
DECISION_PROVIDER="ai"
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"
```

The AI provider calls the Responses API with a strict JSON schema and a 10-second timeout. Invalid, unavailable, or timed-out output creates an audited human review and never reaches an executor. Keep `DECISION_PROVIDER="mock"` for deterministic tests and credential-free demos.

### OpenRouter setup

```env
DECISION_PROVIDER="openrouter"
OPENROUTER_API_KEY="..."
OPENROUTER_MODELS="nvidia/nemotron-3-ultra-550b-a55b:free,minimax/minimax-m3:free,nvidia/nemotron-3.5-lightning:free"
```

RecoverAI sends the same strict recovery-decision JSON schema to the configured model list in order. If a free model is unavailable, times out, or returns malformed output, the next configured model is tried. If every model fails, the recovery engine escalates safely; policy validation and action authorization are never bypassed. The API key is server-only and is never sent to the browser.

## Running tests

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

The test suite covers the state machine, invalid transitions, all required policy boundaries, structured output, engine integration, duplicate events/actions, payment success during waiting, executor failure, reproducibility, baseline comparison, financial metrics, all six chaos scenarios, and Razorpay signature/normalization.

## Failure injection

Recovery Lab exposes:

- `DUPLICATE_WEBHOOK`
- `AI_TIMEOUT`
- `AI_INVALID_OUTPUT`
- `MESSAGE_PROVIDER_DOWN`
- `PAYMENT_SUCCESS_DURING_WAIT`
- `ACTION_EXECUTOR_TIMEOUT`

Each scenario runs in an isolated in-memory workflow and returns its audit trail and safety invariant without changing seeded demo cases.

## Architecture tradeoffs

- A single recovery decision provider keeps the hackathon architecture explainable.
- PostgreSQL persistence and explicit transitions were chosen before UI polish.
- Long-running orchestration is stored as scheduled actions and recoverable states; Temporal/LangGraph were deliberately not added.
- Recovery Lab uses a fixed PRNG seed and hidden per-window outcomes. The baseline's fixed 24-hour retry and RecoverAI's contextual retry consume different windows from the same underlying case behavior.
- Human approval records a decision and queues fresh analysis rather than bypassing policy with a privileged executor.

## Known limitations

- OpenAI/OpenRouter live decision calls remain unverified. Razorpay Test Mode Payment Link creation and a locally HMAC-signed `payment_link.paid` route are verified in this checkout; an actual Razorpay-delivered webhook still needs a configured webhook secret and reachable public endpoint.
- Email and WhatsApp are auditable sandbox executors; real providers are not connected.
- Scheduled `WAIT` and post-approval re-analysis are persisted, but there is no background worker that wakes cases automatically after application restart.
- There is no authentication, organization tenancy, rate limiting, or production observability stack; the UI is a local hackathon control plane.
- The simulator is designed to demonstrate architecture and controlled experimentation, not to estimate real recovery uplift.

## Documentation

- [`docs/PRODUCT.md`](docs/PRODUCT.md)
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/POLICIES.md`](docs/POLICIES.md)
- [`docs/EVALUATION.md`](docs/EVALUATION.md)
- [`docs/DEMO.md`](docs/DEMO.md)
- [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md)
