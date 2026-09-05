# RecoverAI

### An AI revenue recovery controller that knows when to act—and when not to.

RecoverAI takes ownership of failed recurring-payment cases from detection to resolution. It combines contextual AI judgment with deterministic financial controls, executes only pre-approved actions, observes the outcome, and records an immutable explanation of what happened.

> Built for the Razorpay Buildathon. All Recovery Lab results are synthetic and all Razorpay integration activity is **Test Mode only**.

<p align="center">
  <a href="docs/assets/recoverai-overview.png">
    <img src="docs/assets/recoverai-overview.png" alt="RecoverAI revenue control room showing recovered revenue, revenue at risk, recovery rate, active cases, human reviews, Razorpay Test Mode recovery, and the cumulative recovery chart" width="100%" />
  </a>
</p>

<p align="center"><sub>Revenue control room with database-derived recovery metrics and separately labeled Razorpay Test Mode accounting</sub></p>

## The problem

Fixed dunning flows treat every failed payment the same: wait, retry, send a generic reminder, retry again, then stop. That leaves recoverable revenue behind and creates unnecessary customer friction.

RecoverAI makes each recovery decision from the context of the case—failure reason, mandate state, payment history, customer preferences, recent contact, risk signals, and value—while keeping authority in deterministic code.

```text
Revenue at risk
    ↓
Detect → Understand → Recommend → Authorize → Act → Observe
    ↑                                                ↓
    └──────── recover / wait / review / stop ───────┘
```

## What this project proves

| Capability              | How RecoverAI demonstrates it                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Measurable recovery     | Runs a fixed baseline and RecoverAI against the same 100 held-out cases                   |
| Bounded AI              | The model can recommend only eight schema-validated actions                               |
| Deterministic authority | Policy code—not the model—controls money, limits, consent, and stopping                   |
| Safe autonomy           | Every action requires policy approval and an idempotent operation ID                      |
| Intelligent no-action   | `WAIT` and `STOP` are first-class decisions when contact would be harmful or redundant    |
| Human control           | High-value, disputed, unsafe, and low-confidence cases enter a review queue               |
| Failure recovery        | Duplicate webhooks, AI failures, provider failures, and race conditions are testable      |
| Auditability            | Decisions, policy checks, state transitions, actions, failures, and outcomes are recorded |

### Recovery intelligence

<p align="center">
  <a href="docs/assets/recoverai-intelligence.png">
    <img src="docs/assets/recoverai-intelligence.png" alt="RecoverAI operational analytics showing the recovery control funnel, recovered-volume attribution, bounded action health, and incremental Recovery Lab revenue" width="100%" />
  </a>
</p>

<p align="center"><sub>Persisted control-flow checkpoints, recovery attribution, action health, and the calculated held-out experiment result</sub></p>

### Held-out recovery experiment

<p align="center">
  <a href="docs/assets/recoverai-recovery-lab.png">
    <img src="docs/assets/recoverai-recovery-lab.png" alt="RecoverAI Recovery Lab comparing a fixed baseline with contextual policy-governed recovery across 100 identical synthetic cases, showing 53,990 rupees in incremental recovery" width="100%" />
  </a>
</p>

<p align="center"><sub>The same 100 synthetic cases produce ₹53,990 in calculated incremental recovery, four fewer contacts, and zero policy violations or duplicate actions</sub></p>

## Five-minute demo

1. Open **Overview** to see database-derived revenue, case health, recovery methods, customer friction, and the latest evaluation.
2. Open **Recovery Lab** and select **Run evaluation**. RecoverAI and the fixed baseline receive the same 100 cases and hidden outcome behavior.
3. Compare incremental revenue, recovery-rate uplift, contacts, escalations, policy violations, and duplicate actions.
4. Expand a lab case to inspect its observable context, AI recommendation, policy result, and simulated outcome.
5. Open **Recoveries** and inspect a case timeline to answer: _What happened? Why? Was it allowed? What happened next?_
6. Open **Needs Review** to show that high-value, disputed, or low-confidence cases cannot execute autonomously.
7. Inject **Duplicate webhook**, **Invalid AI output**, or **Payment success during wait** and inspect the safe result.

The reproducible seed `20260823` currently calculates:

| Metric               | Fixed baseline | RecoverAI |                 Difference |
| -------------------- | -------------: | --------: | -------------------------: |
| Revenue recovered    |      ₹2,67,369 | ₹3,21,359 |               **+₹53,990** |
| Customer contacts    |             83 |        79 |                     **−4** |
| Recovery-rate uplift |              — |         — | **+4.0 percentage points** |
| Policy violations    |              0 |         0 |                          0 |
| Duplicate actions    |              0 |         0 |                          0 |

These are deterministic simulator results for architecture evaluation—not merchant revenue, production performance, or claimed traction.

## AI recommends. Policy authorizes.

RecoverAI uses AI only where ambiguity is useful: interpreting context and recommending the next recovery step. The model must return exactly one structured action:

```text
WAIT                         SMART_RETRY
REQUEST_PAYMENT_METHOD_UPDATE
SEND_WHATSAPP                SEND_EMAIL
SEND_PAYMENT_LINK            ESCALATE
STOP
```

A decision also contains confidence, a reason code, an explanation, an optional delay, and optional communication intent. Invalid or unavailable model output is rejected before execution.

The model can **never** override:

- transaction amount or authoritative financial calculations
- authorization and policy thresholds
- retry and customer-contact limits
- opt-outs, mandate restrictions, disputes, or fraud controls
- stopping conditions or high-value approval
- state transitions, idempotency, or audit history

The policy engine returns `ALLOW`, `BLOCK`, or `ESCALATE`. Its result is authoritative—even when the model recommends something else.

## Architecture

```mermaid
flowchart LR
    A[Provider or demo event] --> B[Event adapter]
    B --> C[Normalized PaymentEvent]
    C --> D{Idempotency gate}
    D -->|new| E[RecoveryCase]
    D -->|duplicate| L[Audit: duplicate ignored]
    E --> F[Context builder]
    F --> G[Decision provider]
    G --> H[Structured RecoveryDecision]
    H --> I{Policy engine}
    I -->|allow| J[Bounded executor]
    I -->|escalate| K[Human review]
    I -->|block| M[Wait or stop]
    J --> N[Result observer]
    N --> O[State transition]
    O --> P[Immutable audit event]
    P --> Q[Metrics and re-evaluation]
```

### Explicit boundaries

- **Domain engine** — orchestration, case state, decisions, policy evaluation, action authorization, and outcome handling live outside React.
- **Decision providers** — deterministic mock, OpenAI, and OpenRouter implement the same provider contract.
- **Policy engine** — deterministic and independently tested; covers retry/contact limits, opt-outs, invalid mandates, inactive subscriptions, high-value approval, disputes, confidence, and unsafe decisions.
- **Action executors** — bounded adapters for retry, payment-method update, payment link, WhatsApp, email, escalation, wait, and stop.
- **Provider adapters** — Razorpay types terminate at the adapter boundary; the recovery domain receives normalized events.
- **Persistence** — PostgreSQL and Prisma store cases, events, decisions, evaluations, actions, reviews, and append-only audit facts.

### Case lifecycle

```text
DETECTED → ANALYZING → DECISION_READY → POLICY_CHECK
         → SCHEDULED / ACTION_PENDING
         → ACTION_EXECUTED / WAITING
         → RECOVERED / ESCALATED / STOPPED / FAILED
```

Allowed transitions are declared explicitly. Invalid transitions fail safely. `RECOVERED` and `STOPPED` are terminal; `FAILED` remains inspectable and recoverable.

## Technology

- Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS 4
- PostgreSQL with Prisma 7
- Zod for webhook, API, configuration, and AI-output validation
- Vitest for domain, adapter, route, integration, and safety tests
- Razorpay Payment Links in Test Mode
- Optional OpenAI or OpenRouter structured decision providers

## Run locally

### Prerequisites

- Node.js 22
- npm 10
- PostgreSQL 14+

### Installation

```bash
git clone https://github.com/akashdeep070/Recover-AI.git
cd Recover-AI
cp .env.example .env
npm install
createdb recover_ai
npm run setup
npm run dev
```

Set your PostgreSQL connection in `.env` before `npm run setup`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/recover_ai?schema=public"
DECISION_PROVIDER="mock"
```

Then open [http://localhost:3000](http://localhost:3000). Mock mode is deterministic and requires no external credentials.

## Environment configuration

| Variable                  | Needed for                | Notes                                     |
| ------------------------- | ------------------------- | ----------------------------------------- |
| `DATABASE_URL`            | Local application         | PostgreSQL connection string              |
| `DECISION_PROVIDER`       | Optional                  | `mock` (default), `ai`, or `openrouter`   |
| `OPENAI_API_KEY`          | Live OpenAI decisions     | Server-side only                          |
| `OPENAI_MODEL`            | Live OpenAI decisions     | Defaults to `gpt-5-mini`                  |
| `OPENROUTER_API_KEY`      | Live OpenRouter decisions | Server-side only                          |
| `OPENROUTER_MODELS`       | OpenRouter fallback       | Ordered, comma-separated model list       |
| `OPENROUTER_BASE_URL`     | OpenRouter                | Defaults to its Chat Completions endpoint |
| `OPENROUTER_SITE_URL`     | OpenRouter                | Optional HTTP referer metadata            |
| `OPENROUTER_APP_NAME`     | OpenRouter                | Optional application title metadata       |
| `RAZORPAY_KEY_ID`         | Razorpay Test Mode        | Must begin with `rzp_test_`               |
| `RAZORPAY_KEY_SECRET`     | Razorpay Test Mode        | Server-side only                          |
| `RAZORPAY_WEBHOOK_SECRET` | Signed webhooks           | Used for HMAC verification                |

Real email and WhatsApp delivery are not connected; those actions use auditable sandbox executors. Secrets belong only in `.env`, which Git ignores.

## Database and demo data

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

The idempotent seed creates 12 representative workflows, including successful smart retry, expired payment method, intentional wait, high-value review, opt-out, dispute, attempt limit, manual payment during a wait, provider failure, duplicate webhook, low confidence, and payment-link recovery.

## Recovery Lab methodology

Recovery Lab generates approximately 100 cases from a fixed PRNG seed. Each case has:

- **Observable context** available to both the decision strategy and policy engine.
- **Hidden behavior** used only by the simulator to determine outcomes.
- **Equivalent outcome windows** shared by the fixed baseline and RecoverAI.

The baseline follows a fixed recovery playbook. RecoverAI chooses contextually, but every recommendation still passes through the same deterministic policy boundary. Metrics are calculated from recorded outcomes—never hardcoded into dashboard components.

Reported metrics include revenue at risk, recovered revenue, recovery rate, incremental recovery, outbound contacts, contacts per ₹10,000 recovered, escalations, automation rate, policy violations, and duplicate actions.

## Razorpay Test Mode golden path

```text
₹2,499 payment fails
  → RecoveryCase created
  → context and structured recommendation recorded
  → deterministic authority gate approves Payment Link
  → exactly one Razorpay TEST Payment Link created
  → signed payment_link.paid webhook reconciled
  → identity, amount, and currency verified
  → case becomes RECOVERED
  → ₹2,499 enters TEST metrics exactly once
```

Payment Link creation has two idempotency layers: a durable RecoverAI action key and a deterministic non-PII Razorpay `reference_id`. RecoverAI looks up that reference before creation and reconciles ambiguous timeouts or duplicate-reference responses using the same identity.

Webhook processing verifies the raw-body HMAC when configured, persists a stable provider event ID, rejects invalid signatures, matches the stored provider link identity, validates amount and currency, and deduplicates replayed paid events.

To enable it:

1. Add Test Mode credentials and a webhook secret to `.env`.
2. Expose `/api/webhooks/razorpay` through a reachable HTTPS URL.
3. Configure that URL in the Razorpay Test Mode dashboard.
4. Subscribe to the relevant payment, payment-link, and subscription events.

Never configure Live Mode credentials for this hackathon build.

## AI providers

### Deterministic demo mode

```env
DECISION_PROVIDER="mock"
```

This is the reliable, credential-free path used by tests and the core demo.

### OpenAI

```env
DECISION_PROVIDER="ai"
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"
```

The provider requests strict schema output with a bounded timeout. A timeout, malformed response, unsupported action, or validation error creates an audited safe escalation instead of executing anything.

### OpenRouter

```env
DECISION_PROVIDER="openrouter"
OPENROUTER_API_KEY="..."
OPENROUTER_MODELS="model-one,model-two"
```

Models are attempted in order. If every configured model fails or returns invalid output, the case escalates safely. Neither provider can bypass policy authorization.

## Failure injection

Recovery Lab includes isolated controls for:

| Scenario                      | Safety proof                                                |
| ----------------------------- | ----------------------------------------------------------- |
| `DUPLICATE_WEBHOOK`           | One logical workflow and action; duplicate recorded         |
| `AI_TIMEOUT`                  | No unsafe execution; failure safely escalated               |
| `AI_INVALID_OUTPUT`           | Schema rejection before the executor                        |
| `MESSAGE_PROVIDER_DOWN`       | Failure recorded without an accidental duplicate message    |
| `PAYMENT_SUCCESS_DURING_WAIT` | Pending action cancelled; case becomes recovered            |
| `ACTION_EXECUTOR_TIMEOUT`     | Recoverable state retained with stable idempotency identity |

## Verification

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Latest verified repository snapshot:

| Check                      | Result                                                                  |
| -------------------------- | ----------------------------------------------------------------------- |
| Formatting                 | PASS                                                                    |
| Lint                       | PASS — no errors or warnings                                            |
| Typecheck                  | PASS                                                                    |
| Unit and integration tests | PASS — 11 files / 75 tests                                              |
| Production build           | PASS — 14 routes                                                        |
| Recovery Lab               | PASS — reproducible seed, zero policy violations and duplicate actions  |
| Razorpay Test API          | PASS — TEST Payment Link creation verified                              |
| Signed webhook route       | PASS — local HMAC-signed paid event recovered once; replay deduplicated |

See [the full build status](docs/BUILD_STATUS.md) for the evidence and current implementation boundary.

## Current limitations

- Actual Razorpay-delivered webhook receipt has not yet been verified through a public endpoint; current end-to-end verification uses the production route with a locally HMAC-signed fixture.
- Live OpenAI and OpenRouter decision calls are implemented but not yet verified in the documented build snapshot.
- Email and WhatsApp use sandbox executors.
- Scheduled work is persisted, but no production background worker wakes cases after application restart.
- Authentication, multi-tenancy, production rate limiting, tracing, and deployment infrastructure are intentionally outside hackathon scope.
- The simulator demonstrates controlled methodology and system behavior; it does not estimate real-world recovery uplift.

## Documentation

- [Product contract](docs/PRODUCT.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Deterministic policies](docs/POLICIES.md)
- [Evaluation methodology](docs/EVALUATION.md)
- [Demo guide](docs/DEMO.md)
- [Verified build status](docs/BUILD_STATUS.md)

## License

No open-source license has been added. All rights are reserved by the repository owner unless a license is provided later.
