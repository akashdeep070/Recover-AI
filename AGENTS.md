# RecoverAI

RecoverAI is an autonomous revenue recovery controller being built for the
Razorpay Buildathon.

Never optimize for making the demo look finished when the underlying recovery
workflow is not correct.

The implementation order is:

1. working engine
2. measurable experiment
3. failure handling
4. user interface
5. polish

## Core objective

Detect revenue at risk, choose the appropriate recovery intervention, execute
it safely, observe the outcome, and measure revenue recovered.

The project must demonstrate:

1. measured money recovered across a batch
2. bounded AI actions
3. deterministic compliance and stopping rules
4. human escalation
5. a full audit trail
6. failure recovery
7. a clear separation between AI judgment and deterministic code

## Core principle

AI handles ambiguous judgment.

Deterministic code handles:

- money movement
- retry limits
- stopping conditions
- authorization
- opt-outs
- idempotency
- policy enforcement
- calculations

Never allow an LLM to directly execute unrestricted financial actions.

## Product scope

The primary use case is failed recurring or subscription payment recovery.

Supported AI actions:

- `WAIT`
- `SMART_RETRY`
- `REQUEST_PAYMENT_METHOD_UPDATE`
- `SEND_WHATSAPP`
- `SEND_EMAIL`
- `SEND_PAYMENT_LINK`
- `ESCALATE`
- `STOP`

AI must return exactly one allowed action using structured output.

## Required product screens

- Overview
- Recoveries
- Recovery case detail
- Needs Review
- Recovery Policies
- Recovery Lab

## Evaluation

Compare:

1. a fixed-rule recovery baseline
2. RecoverAI contextual recovery

Both strategies must run against the same held-out dataset.

Primary metrics:

- revenue recovered
- recovery rate
- incremental recovery versus baseline
- outbound contacts
- human escalations
- policy violations
- duplicate actions

## Engineering priorities

Correctness and reliability are more important than visual polish.

Always:

- write tests
- handle duplicate events
- make financial operations idempotent
- log important decisions
- preserve auditability
- validate AI output before execution
- preserve the deterministic mock decision provider for tests
- label synthetic and Razorpay test-mode results accurately

Read every document under `docs/` before making architectural changes.

At the end of every major implementation task, update
`docs/BUILD_STATUS.md`. Never mark work done unless it works and the relevant
tests pass.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
