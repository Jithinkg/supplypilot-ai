# Day 2 — Data and Calculations

Implemented and verified on 2026-11-16. The approved [architecture](architecture.md) and [implementation plan](implementation-plan.md) remain the source of business policy.

## Delivered

- Repeatable synthetic seed: 50 products, 10 suppliers, 150 price/lead-time quotes and exactly 1,500 daily sales records across 30 completed UTC dates.
- Stable fixture UUIDs and fixed numeric seed `20261116`, with optional `SEED_REFERENCE_DATE=YYYY-MM-DD`; default reference is today's UTC date.
- Boundary scenarios: zero stock, zero demand, exact seven/fourteen-day stockouts, all risk levels, and cheaper-versus-faster supplier alternatives.
- One INR 500,000 budget (`50_000_000` paise), plus five historical proposal examples: two approved, two draft and one rejected. Approved history has manager identity/time, exact reservations and audit events. These are seed fixtures, not an approval API.
- Backend inventory, replenishment, quote-ranking, budget, affordability and checked integer-paise arithmetic services.
- Shared Zod schemas for risk rows/lists, queries, quantities and budget snapshots.
- Four authenticated read endpoints for staff and managers; no frontend/dashboard changes.
- Correct startup failure reporting when a port is already occupied.

No new schema migration or dependency installation was needed; Day 1's schema already covered these models.

## Business behavior

- Sales use the previous 30 completed UTC dates, exclude today and zero-fill missing days. Each response captures one `asOf` timestamp.
- CRITICAL is <=7 days, HIGH is >7 and <=14, LOW is >14 or positive stock with no recent demand. Zero stock is always CRITICAL. No-demand positive stock has `null` days.
- At Risk (Next 14 Days) counts CRITICAL + HIGH; Stockout Within 7 Days counts CRITICAL only. Summary counts cover the portfolio even when risk rows are filtered/paginated.
- Days are classified without display rounding. The 30-day replenishment target uses exact total-window demand minus stock, clamped to zero, avoiding floating-point ceil drift.
- Existing draft/approved replenishment excludes a product from automatic recommendations without changing stock/risk. Comparison responses flag the exclusion; explicit user quantities remain possible.
- Supplier ranking prefers cheapest delivery strictly before stockout, then shortest lead time, then supplier code. If none qualifies, fastest wins, then price/code, with a delivery warning. No-demand positive-stock products require an explicit quantity and rank by price/time/code.
- Prices/totals/balances use integer paise and reject fractions, negative availability and PostgreSQL integer overflow. Quote affordability reports an over-budget warning/shortfall rather than rejecting the estimate. Approval enforcement is Day 3 work.

## Read endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /api/inventory/risks` | Search, risk filter, page/pageSize capped at 100, sorted rows, portfolio summaries and UTC window |
| `GET /api/products/:id/sales` | Thirty daily records, total sold, average, window and `asOf` |
| `GET /api/products/:id/quotes?quantity=10` | Optional explicit quantity, ranked quotes, selection rationale, delivery/exclusion warnings and budget affordability |
| `GET /api/budget` | Currency, allocated/reserved/available paise and `asOf` |

All require an authenticated session. Invalid IDs/queries return 400; missing products 404; absent valid quotes 409; missing initialized budget 503. Business responses are not cached. Request errors remain sanitized and correlated by request ID.

## Seed safety and repeatability

`npm run db:seed` refreshes the named demo product stock, supplier quotes and sales. On a reference-date shift it removes out-of-window sales for demo products and refreshes overlapping fixture quantities. It updates account credentials and revokes their sessions, as in Day 1.

Proposal history is inserted only when no proposals exist. Repeat seeding preserves existing decisions, immutable proposal lines, audit entries and reservations; it does not reserve the fixture amounts again or reset the budget. Unrelated products/suppliers/proposals are not removed. Run this demo seed against the local demo database only.

The live API always calculates against the current UTC date. A fixed seed reference date is for reproducible fixtures/tests, not a global override of live time. Reseed with the current date when refreshing the demo. The exact-count verification assumes no extra business records have been added.

## Verification performed

| Command/check | Result |
| --- | --- |
| `docker compose up -d --wait postgres` | Local PostgreSQL healthy |
| `npm run db:seed` | Exact 50/10/1500/150 business counts seeded |
| `npm test` | 36 isolated/foundation tests passed across seven files |
| `npm run test:db` | 11 real-PostgreSQL tests passed across two files |
| `npm run db:check` | Identity, counts, risk summaries and reservation/budget consistency verified |
| `npm run typecheck` | All workspaces passed strict TypeScript checks |
| `npm run build` | Contracts, API and frontend production builds passed |
| Live authenticated HTTP checks | Inventory, sales, quotes and budget served correctly; logout completed |
| Separate compiled API on port 3102 | Health, unauthorized rejection, manager login, risk list and budget verified; verification server then stopped |

Tests cover exact/near-boundary risks, UTC dates/missing days, fractional demand, no-demand replenishment, supplier delivery/price tie-breaks, inactive/mismatched quotes, paise overflow, affordability, both roles' read access, invalid query/ID errors, reservation/audit consistency, duplicate-free reseeding and a reference-date shift restored in a finally block.

The verification data uses 2026-10-17 through 2026-11-15 inclusive:

| Metric | Verified value |
| --- | --- |
| Total products | 50 |
| At Risk (Next 14 Days) | 28 |
| Stockout Within 7 Days | 19 |
| Allocated budget | `50_000_000` paise (INR 500,000.00) |
| Reserved budget | `567_235` paise (INR 5,672.35) |
| Available budget | `49_432_765` paise (INR 494,327.65) |

Counts remain stable for this seed/reference; live risk values naturally age when the observation date changes. The frontend build still reports the previously known non-blocking bundle-size warning (now approximately 642 kB before gzip).

## Files changed

- `apps/api/prisma/demo-data.ts`, `seed-business.ts`, `seed.ts`: deterministic fixtures and repeatable seed.
- `apps/api/src/services/inventory.ts`, `money.ts`, `suppliers.ts`, `reads.ts`: calculations and database read services.
- `apps/api/src/routes/reads.ts`, `app.ts`, `index.ts`, `middleware/errors.ts`: authenticated routes, wiring, validation errors and startup reporting.
- `packages/contracts/src/index.ts`: shared schemas/types.
- `apps/api/src/services/*.test.ts`, `demo-data.test.ts`, `business.db.test.ts`, `auth.db.test.ts`: calculation, fixture and PostgreSQL coverage.
- `apps/api/scripts/check-database.ts`: full demo consistency check.
- `.env.example`, `README.md`, this document: setup and verification guidance.

## Boundaries and next milestone

No LLM key was requested or live LLM call attempted; model feasibility stays deferred until before Day 5 agent implementation, as agreed. The frontend remains the Day 1 placeholder. No proposal creation/decision APIs, AI agents or supplier orders were implemented.

Day 3 is procurement safety: manual draft APIs, manager-only decision services, atomic reservations, business audit/idempotency and concurrent-decision tests. PostgreSQL remains available; the pre-existing application server was not stopped during verification.
