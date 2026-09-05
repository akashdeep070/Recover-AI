# RecoverAI Evaluation

## Goal

Prove whether contextual recovery performs better than a fixed recovery
playbook on the same held-out cases.

## Evaluation dataset

Create 100 synthetic held-out revenue-at-risk cases.

Each case should contain:

- amount
- failure reason
- subscription age
- successful payment count
- failed payment count
- previous recovery results
- previous customer contacts
- preferred communication channel
- mandate state
- customer risk or value
- hidden recovery behavior

The recovery decision engine must not see hidden outcome variables.

## Fixed baseline

```text
failure
  -> wait 24 hours
  -> retry
  -> if failed, email
  -> wait
  -> retry
  -> stop
```

## RecoverAI strategy

The contextual strategy uses only available context and chooses one of:

- `WAIT`
- `SMART_RETRY`
- `REQUEST_PAYMENT_METHOD_UPDATE`
- `SEND_WHATSAPP`
- `SEND_EMAIL`
- `SEND_PAYMENT_LINK`
- `ESCALATE`
- `STOP`

## Main metrics

- revenue at risk
- revenue recovered
- recovery rate
- incremental revenue recovered
- customer contacts
- contacts per ₹10,000 recovered
- automation rate
- human escalation count
- policy violations
- duplicate actions

Definitions:

```text
recovery rate = recovered revenue / revenue at risk

incremental recovery = RecoverAI recovered revenue - baseline recovered revenue

customer friction = contacts / ₹10,000 recovered
```

## Experimental requirements

- Run both strategies against identical cases.
- Use a seeded pseudo-random number generator.
- Persist the seed with the evaluation run.
- Persist each strategy decision and individual case result.
- Keep hidden recovery behavior inaccessible to the decision engine.
- Make the run reproducible in automated tests.
- Calculate authoritative totals in deterministic code.
- Report policy violations and duplicate actions even when the count is zero.

## Result labeling

All results from this dataset are synthetic evaluation results. They must not be
represented as customer traction, production recovery, or real money recovered.
Razorpay test-mode outcomes must be labeled separately from simulator outcomes.

## Implemented reference run

The fixed seed `20260823` produces 100 cases and ₹13,49,012 of synthetic revenue at risk.

The simulator assigns hidden outcomes to retry timing windows and intervention types. The fixed baseline consumes the 24-hour/later retry windows; RecoverAI can select an earlier contextual window using observable history. Both strategies still receive the same underlying case and neither receives hidden outcome fields.

Verified result:

| Metric            | Fixed baseline | RecoverAI |
| ----------------- | -------------: | --------: |
| Revenue recovered |      ₹2,67,369 | ₹3,21,359 |
| Recovery rate     |          19.8% |     23.8% |
| Customer contacts |             27 |        23 |
| Human escalations |              8 |        17 |
| Policy violations |              0 |         0 |
| Duplicate actions |              0 |         0 |

Incremental synthetic recovery is ₹53,990 with four fewer contacts. This is a reproducible simulator result, not a production performance claim.
