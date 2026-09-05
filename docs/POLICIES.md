# Recovery Policies

The LLM cannot override these rules. The deterministic policy engine is the
authoritative decision point before any recovery action is scheduled or
executed.

## Payment rules

Maximum automatic retry attempts: 3

Stop if:

- payment succeeds
- the mandate becomes invalid
- the subscription becomes inactive
- the maximum number of attempts is reached

## Communication rules

Maximum automated customer contacts: 3

Minimum interval between communications: 12 hours

Never contact:

- opted-out customers
- customers whose payment has already succeeded

## Escalation rules

Human review is required when:

- amount is greater than ₹50,000
- a billing dispute is detected
- a fraud-related signal is detected
- AI confidence is lower than `0.70`
- the situation is unsupported
- payment state is inconsistent

## AI permissions

AI can recommend one of the actions allowed by the product specification.

AI cannot:

- initiate arbitrary charges
- modify retry limits
- bypass opt-outs
- bypass required human approval
- calculate authoritative financial totals
- modify audit history
- invent a new action outside the structured schema

## Policy engine contract

Input:

- `RecoveryContext`
- `ProposedRecoveryAction`

Output:

- `ALLOW`
- `BLOCK`
- `ESCALATE`

Every result must include stable reason codes and must be written to the audit
trail.

## Minimum policy tests

- payment already succeeded
- maximum retries reached
- maximum contacts reached
- customer opted out
- invalid mandate
- high-value transaction
- low AI confidence
- dispute detected
- normal retry allowed
