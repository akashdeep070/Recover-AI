# RecoverAI Build Status

Last updated: 2026-09-04

## DONE

- [x] Next.js 16, TypeScript, PostgreSQL, Prisma 7, Zod, Vitest project foundation.
- [x] PostgreSQL schema, generated Prisma client, initial migration, and idempotent seed.
- [x] Explicit recovery state machine with controlled invalid-transition failures.
- [x] Normalized payment event boundary and Razorpay webhook adapter.
- [x] Provider-event idempotency, stable event IDs, duplicate counters, and duplicate audit events.
- [x] Deterministic mock and strict-schema AI decision-provider abstraction.
- [x] Deterministic `ALLOW` / `BLOCK` / `ESCALATE` policy engine covering all documented rules.
- [x] Bounded action executors with operation IDs and unique idempotency keys.
- [x] Razorpay Test Mode Payment Link executor with stable provider references, lookup-before-create, duplicate-reference reconciliation, and ambiguous-timeout recovery.
- [x] End-to-end event → case → context → decision → policy → action → observation flow.
- [x] Signed `payment_link.paid` reconciliation by stored Payment Link identity with amount/currency validation and exactly-once recovery accounting.
- [x] Immutable audit events for every meaningful transition, decision, policy result, action, failure, and outcome.
- [x] Payment success during waiting cancels pending recovery actions and transitions to `RECOVERED`.
- [x] Human-review queue with audited approve/re-evaluate and stop decisions.
- [x] Reproducible 100-case held-out dataset with observable and hidden outcome separation.
- [x] Fixed baseline and RecoverAI evaluation against identical underlying cases.
- [x] Deterministic financial, recovery, contact, escalation, automation, violation, and duplicate metrics.
- [x] Six isolated failure-injection scenarios with visible audit results.
- [x] Overview, Recoveries, case detail, Needs Review, Policies, and Recovery Lab screens.
- [x] Responsive, accessible fintech control-room design with loading, empty, error, focus, and reduced-motion states.
- [x] Open Analytics-inspired visual system: single-ink neutrals, quiet grey stage, white squircle plates, pill controls, medium-weight typography, and one primary blue accent.
- [x] Database-derived cumulative recovered-revenue trend with hourly/daily bucketing, keyboard-readable points, and an exact-value table.
- [x] Database-derived Overview intelligence grid with recovery funnel, recovered-volume attribution, payment-history cohorts, action health, customer-friction metrics, and the latest persisted baseline comparison.
- [x] Twelve realistic seeded workflows covering every requested demo scenario.
- [x] README setup, architecture, integrations, demo, tests, tradeoffs, and limitations.

## PARTIAL

- [~] OpenAI/OpenRouter structured-output providers: implemented with timeout, strict schema validation, ordered model fallback, and safe human escalation. Live AI calls remain unverified.
- [~] Razorpay Test Mode: live Payment Link creation and local signed `payment_link.paid` reconciliation are tested; externally delivered Razorpay webhooks remain unverified because no public webhook endpoint/secret is configured.
- [~] Durable scheduling: actions and waiting states persist, but no background worker wakes scheduled cases automatically.
- [~] Human approval: approval is audited and queues fresh analysis; automatic post-approval worker execution is not implemented.

## NOT IMPLEMENTED

- [ ] Real email provider.
- [ ] Real WhatsApp provider.
- [ ] Authentication and multi-organization tenancy.
- [ ] Production rate limiting, tracing, alerting, and deployment infrastructure.
- [ ] Automatic long-running job worker / scheduler.

## KNOWN ISSUES

- OpenAI/OpenRouter live decision calls remain unverified. Razorpay Test Mode API creation is verified locally, but an actual Razorpay-delivered webhook still requires a configured webhook secret and reachable public endpoint.
- Recovery Lab metrics are synthetic and must not be represented as production recovery or traction.
- The app requires a reachable PostgreSQL database; it does not silently fall back to an in-memory UI.
- `npm audit` reports three high-severity advisories in Prisma's development-only config dependency (`deepmerge-ts`); `npm audit --omit=dev` reports zero production vulnerabilities.

## TEST RESULTS

| Check                       | Result | Evidence                                                                                            |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| Prisma client generation    | PASS   | Prisma Client 7.9.1 generated                                                                       |
| Database schema             | PASS   | `prisma migrate deploy`: PostgreSQL schema in sync                                                  |
| Initial migration           | PASS   | `20260824000000_init` generated and baselined                                                       |
| Demo seed                   | PASS   | 12 cases, 111 audit events, 9 actions, 3 reviews                                                    |
| Payment Link migration      | PASS   | `20260904090000_payment_link_identity` applied to local PostgreSQL                                  |
| Formatter                   | PASS   | `npm run format:check`, all files matched                                                           |
| Lint                        | PASS   | `npm run lint`, 0 errors and 0 warnings                                                             |
| Typecheck                   | PASS   | `npm run typecheck`                                                                                 |
| Unit + integration tests    | PASS   | 11 files, 75 tests                                                                                  |
| Production build            | PASS   | Next.js 16.3.2 Webpack build, 14 routes                                                             |
| Recovery Lab                | PASS   | Seed 20260823: +₹53,990 incremental, -4 contacts, 0 policy violations, 0 duplicates                 |
| Live Overview               | PASS   | PostgreSQL metrics, seeded cases, six calculated analytics cards, and ₹2,499 TEST recovery rendered |
| OpenRouter configuration    | PASS   | Test key and three ordered free models configured in ignored local `.env`                           |
| Razorpay TEST API           | PASS   | Live Payment Link creation verified for INR 2,499; one linked to the DB-backed golden case          |
| Razorpay signed webhook     | PASS   | Locally HMAC-signed `payment_link.paid` route recovered one case and replay deduped                 |
| Live audit acceptance       | PASS   | WAIT action cancelled by payment success; case reached RECOVERED                                    |
| Live chaos acceptance       | PASS   | Duplicate webhook produced one action and `DUPLICATE_EVENT_IGNORED` audit fact                      |
| Production dependency audit | PASS   | `npm audit --omit=dev`: 0 vulnerabilities                                                           |
| Responsive UI               | PASS   | 1249px, 375px, and 812×375: no horizontal page or analytics-card overflow                           |
| Live visual QA              | PASS   | All six screens previously rendered; new grid verified with a 44px experiment link                  |

## Verification snapshot

```text
npm run lint       PASS
npm run typecheck  PASS
npm test           PASS — 11 files / 75 tests
npm run build      PASS — 14 routes
```

## Change log

| Date       | Task                                     | Result                                                                                                                                 | Verification                                         |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 2026-08-30 | Overview recovery intelligence           | Added six calculated, responsive analytics widgets without moving existing content                                                     | 61 tests, build, live QA                             |
| 2026-09-04 | OpenRouter decision provider             | Added strict Chat Completions provider with ordered free-model fallback                                                                | 64 tests, typecheck, build                           |
| 2026-09-04 | Razorpay TEST golden path                | Added durable Payment Link identity, timeout/duplicate reconciliation, signed paid-webhook accounting, and case-detail provider fields | 75 tests, live TEST API, local signed webhook, build |
| 2026-08-24 | Overview recovery trend                  | Added calculated cumulative recovery chart and accessible data table                                                                   | 58 tests, build, live QA                             |
| 2026-08-24 | Open Analytics design refinement         | Restyled the full product shell and all six screens without domain changes                                                             | Build, live desktop/mobile QA                        |
| 2026-08-24 | Complete RecoverAI hackathon application | Working database-backed engine, experiment, safety controls, and product UI                                                            | Full local verification above                        |
