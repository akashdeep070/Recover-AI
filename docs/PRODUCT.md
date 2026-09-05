# RecoverAI Product Specification

## Problem

Businesses lose recurring revenue through payment failures, expired
credentials, insufficient balances, mandate issues, and poorly timed recovery
interventions.

Most recovery systems use a fixed sequence:

```text
failure
  -> retry
  -> email
  -> retry
  -> stop
```

This treats every customer identically.

RecoverAI instead uses customer and payment context to choose an appropriate
intervention.

## Product promise

RecoverAI does not merely identify revenue at risk. It closes the loop:

```text
Detect
  -> Diagnose
  -> Decide
  -> Policy Check
  -> Execute
  -> Observe
  -> Re-evaluate
  -> Recover / Escalate / Stop
```

## Example

Customer subscription: ₹4,999

Failure: `INSUFFICIENT_FUNDS`

Context:

- 14-month subscriber
- 13 successful payments
- previous retry succeeded
- customer contacted yesterday
- Razorpay retry already scheduled

AI decision: `WAIT`

Reason: Another contact adds unnecessary customer friction. The existing
payment retry has a high probability of succeeding.

The system waits. If payment succeeds, ₹4,999 is recorded as recovered and the
workflow stops automatically.

## Important concept

No action is a valid recovery action.

The objective is not to send more communication. The objective is to maximize
revenue recovery while minimizing unnecessary customer friction.

## Primary users

- finance teams
- revenue operations teams
- subscription businesses

## MVP

Support:

1. failed subscription payment ingestion
2. recovery case creation
3. AI recovery decisions
4. deterministic policy validation
5. simulated or Razorpay test-mode execution
6. outcome observation
7. an immutable audit trail
8. human escalation
9. batch evaluation
10. fixed-baseline comparison

## Supported recovery actions

- `WAIT`
- `SMART_RETRY`
- `REQUEST_PAYMENT_METHOD_UPDATE`
- `SEND_WHATSAPP`
- `SEND_EMAIL`
- `SEND_PAYMENT_LINK`
- `ESCALATE`
- `STOP`

## Product boundary

RecoverAI recommends and coordinates bounded interventions around the payment
infrastructure. It does not give an LLM unrestricted authority to move money,
alter limits, bypass consent, or rewrite audit history.

Checkout abandonment, general collections, voice calling, and support for many
payment providers are possible extensions, not requirements for the first
working vertical slice.
