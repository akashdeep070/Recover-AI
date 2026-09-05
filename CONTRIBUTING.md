# Contributing to RecoverAI

Thanks for helping improve RecoverAI. This project values a correct recovery workflow, measurable outcomes, and explicit safety boundaries more than surface-level feature count.

## Start locally

```bash
cp .env.example .env
npm install
createdb recover_ai
npm run setup
npm run dev
```

Set `DATABASE_URL` in `.env` before running the database setup. Keep `DECISION_PROVIDER="mock"` for deterministic local development without external credentials.

## Engineering contract

- AI may recommend only the actions defined in the recovery-decision schema.
- Deterministic code owns authorization, amounts, retry and contact limits, consent, stopping, idempotency, state transitions, and audit history.
- Every executable action must pass policy validation first.
- Every meaningful workflow change must append an audit event.
- Duplicate events and operations must remain safe.
- Synthetic evaluation, Razorpay Test Mode, and real-world revenue must remain clearly separated.
- Provider-specific data belongs behind an adapter boundary.

Read [the architecture](docs/ARCHITECTURE.md), [policy specification](docs/POLICIES.md), and [evaluation methodology](docs/EVALUATION.md) before changing domain behavior.

## Development workflow

1. Create a focused branch.
2. Add or update tests alongside behavior changes.
3. Keep domain logic out of React components.
4. Use the deterministic mock provider for reproducible tests.
5. Update `docs/BUILD_STATUS.md` only after the relevant verification passes.
6. Keep commits focused and explain the reason for the change.

## Required checks

Run these before opening a pull request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Database or provider changes should also include targeted integration tests. Financial reconciliation changes must test identity, amount, currency, duplicate delivery, and ambiguous failure behavior.

## Secrets and test providers

- Never commit `.env` or credentials.
- Use Razorpay Test Mode only.
- Never expose server credentials through client components or public environment variables.
- Redact provider payloads before adding them to fixtures, logs, screenshots, or issue reports.
- Keep mock mode working when external credentials are unavailable.

## Pull requests

Describe the behavior changed, the safety impact, how it was verified, and any remaining limitation. Do not describe an adapter as fully integrated unless the real boundary was exercised and recorded.
