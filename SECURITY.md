# Security Policy

RecoverAI handles payment events and recovery decisions, so reports involving credentials, webhook validation, authorization, idempotency, or financial accounting should be treated as sensitive.

## Supported scope

This repository is a hackathon implementation intended for local demonstration and Razorpay Test Mode. It is not approved for production payment processing or live merchant revenue.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or security-advisory feature for this repository. Do not open a public issue containing:

- API keys, webhook secrets, access tokens, or database credentials
- complete payment-provider payloads
- customer personal data
- a working exploit against a reachable installation

Include the affected module, reproduction steps, expected safety invariant, observed behavior, and impact. Use redacted fixtures whenever possible.

## Credential handling

- Store secrets only in `.env` or an external secret manager.
- Never commit `.env`, paste credentials into issues, or expose them through `NEXT_PUBLIC_*` variables.
- Use `rzp_test_` Razorpay credentials only; Live Mode is outside project scope.
- Rotate a credential immediately if it appears in chat, logs, screenshots, commit history, or another untrusted location.
- Treat webhook secrets independently from API credentials.

## Recovery safety invariants

A security-relevant change must preserve these invariants:

1. AI output is schema validated and remains advisory.
2. Deterministic policy authorizes every executable recovery action.
3. Amount and currency are validated before recovered revenue is accounted.
4. Provider events and recovery actions are idempotent.
5. Invalid webhook signatures fail closed.
6. Opt-outs, disputes, invalid mandates, limits, and successful payments stop unsafe intervention.
7. Material decisions and state changes remain auditable.

## Before deployment

A production deployment would still require authentication, tenant isolation, authorization controls, rate limiting, managed secrets, background-job reliability, provider-delivered webhook verification, monitoring, alerting, data-retention policy, and an independent security review.
