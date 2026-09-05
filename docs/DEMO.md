# RecoverAI Demo

## Objective

Show a closed-loop recovery system that measures outcomes, uses AI only for
bounded judgment, survives failures, and makes every important action auditable.

Do not present the product as a chatbot or as an unrestricted finance agent.

## Primary story

```text
Revenue at risk
  -> agent decision
  -> policy validation
  -> intervention or intentional wait
  -> observed outcome
  -> revenue recovered, escalated, or safely stopped
```

Recovery Lab is the centerpiece of the demonstration.

## Demo sequence

### 1. Establish the experiment

- Open Recovery Lab.
- Show the fixed seed and held-out batch of 100 synthetic cases.
- Show total synthetic revenue at risk.
- Explain that hidden recovery behavior is not visible to either strategy.
- Clearly label all displayed amounts as synthetic evaluation results.

### 2. Run the fixed baseline

- Run the fixed playbook against the batch.
- Show recovered revenue, recovery rate, customer contacts, escalations, policy
  violations, and duplicate actions.

### 3. Run RecoverAI

- Run the contextual strategy against the identical cases.
- Compare recovered revenue and customer friction with the baseline.
- Show incremental recovery calculated by deterministic code.

### 4. Inspect one recovery case

Open a representative insufficient-funds case and show:

- amount and payment problem
- customer and payment context available to the model
- AI decision and explanation
- confidence
- deterministic policy result and reason code
- executed or scheduled action
- observed outcome
- immutable timeline

Use a case where `WAIT` is correct because an existing retry is scheduled and a
recent customer contact makes another message unnecessary. This demonstrates
that no action can be intelligent action.

### 5. Show human escalation

Open a high-value, disputed, inconsistent, or low-confidence case. Show that the
policy engine escalates it and that the AI cannot bypass human review.

### 6. Inject failures

Demonstrate at least:

- a duplicate webhook that does not create a duplicate action
- invalid AI output that is rejected before execution
- payment success during a wait that cancels the pending intervention

Show each failure and safe response in the audit timeline.

### 7. Close on evidence

End on the baseline-versus-RecoverAI comparison and the zero-tolerance safety
metrics: policy violations and duplicate actions.

For the Razorpay TEST proof, use the recovered ₹2,499 case to show the stored
Payment Link reference and provider operation ID. The local verification path
posts a correctly HMAC-signed `payment_link.paid` fixture through the same route
used in production; label it as local signed-fixture verification unless a
public endpoint has received an actual Razorpay-delivered webhook.

## Required UI views

- Overview
- Recoveries
- Recovery case detail
- Needs Review
- Recovery Policies
- Recovery Lab

The interface should be information-dense, professional, and finance-oriented.
Avoid chatbot-style interaction as the primary experience.

## Truthfulness requirements

- Never claim synthetic recovered revenue as real recovery.
- Label Razorpay Test Mode separately from simulator data.
- Do not invent users, customers, integrations, traction, or performance.
- Only show a feature as working when the underlying path and relevant tests
  pass.
