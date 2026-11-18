# Day 4 — Manual procurement screens

Verified on 2026-11-17. This checkpoint implements the approved manual procurement UI. PDF ingestion, knowledge migrations, RAG, agents and live chat are not implemented or claimed complete.

## Delivered behavior

- Dashboard: four server-derived KPIs, exact “At Risk (Next 14 Days)” label, separate “Stockout Within 7 Days” count, inventory stock/demand/stockout/risk table with URL-backed search/filter/pagination, selection-based draft creation, procurement counts/budget and latest five proposals.
- Proposal list: URL-backed status filter and pagination, detail links and manual creation for both STAFF and MANAGER.
- Proposal detail: product names/SKUs/units, saved quantities/prices/lead times/totals, late-delivery/replenishment indicators, lazy current supplier comparison, budget, request/decision details and audit timeline.
- Manager decisions: confirmation before approval, required rejection reason, pending-state locking, visible insufficient-funds warning and disabled approval. Existing server authorization, transaction/status checks and atomic reservation remain authoritative. Managers can decide their own drafts.
- Shared create dialog: server recommendation or explicit quantity, purchase reason, backend supplier selection and price/lead-time explanation, supplier grouping, exclusion/delivery/budget warnings and links to created proposals. No frontend risk, supplier-ranking, total or budget calculations.
- Recovery: persist the exact validated request and user-scoped idempotency key in sessionStorage before submitting. Uncertain outcomes retain that request and lock editing; explicit retry recovers the committed result. No automatic mutation retry/new key. Reload recovery works within the same tab; clearing storage or closing the tab ends local recovery. No credentials/CSRF tokens stored there.
- Zod validation for API responses, cookie/CSRF mutations, session-expiry redirect/cache clearing, account-scoped business queries, post-mutation invalidation and conflict refresh. Loading, empty, independent section errors and retry states are present. Responsive layout and modal keyboard/focus handling use Radix primitives.
- The assistant input is visibly disabled/unavailable. No simulated AI responses, supplier ordering or inventory changes.

## Files and directories

New frontend files include `app/query-client.ts`, `features/queries.ts`, `pages/proposals.tsx`, `pages/proposal-detail.tsx`, `features/proposals/{create-dialog,pending-draft,review-actions,summary-table}`, reusable `components/common.tsx`, `components/ui/{badge,card,dialog}` and `lib/format.ts`.

Updated frontend files include `main.tsx`, `app/{auth,shell}`, `pages/dashboard.tsx`, `lib/api.ts`, `vite.config.ts` and workspace dependencies. Shared contracts add supplier comparison response validation and exported response types, without altering existing request/business contracts.

Test tooling adds `apps/web/vitest.config.ts`, frontend test setup/fixtures/render helpers and six test files, `playwright.config.ts`, and `tests/e2e/{procurement.spec.ts,tsconfig.json}`. The existing isolated database harness gains a browser mode and temporary browser-test credentials; root/API package scripts and the lockfile are updated. README, architecture, implementation plan, AGENTS guidance and this verification record describe the delivered scope.

No application business services, HTTP routes, Prisma schema, migration files, business seed implementation, `.env`, Compose image or PostgreSQL volume were changed for Day 4.

## Commands and results

| Command/check | Result |
| --- | --- |
| `npm install --include=optional` | PASS; dependencies installed, audit reported zero vulnerabilities. npm initially omitted a native optional binding; derived npm artifacts were backed up under `/tmp`, then a fresh install repaired it. |
| `npm run db:generate` | PASS; regenerated the Prisma client only, without database migration or writes. |
| `npm run typecheck` | PASS; strict checks include workspaces and browser-test/config TypeScript. |
| `npm test` | PASS; 39 backend/shared tests and 17 frontend tests. Existing HTTP tests require local socket access; the restricted-sandbox attempt failed with `listen EPERM`, then passed with permitted local access. |
| `npm run test:web` | PASS; final frontend rerun: 17 tests across six files. |
| `npm run test:db` | PASS; 28 PostgreSQL tests across three files, including existing authentication, read APIs and procurement transaction/concurrency coverage. |
| `npm run build` | PASS; API and frontend production builds. Nonblocking warning: frontend JS chunk approximately 759 kB minified / 224 kB gzip; route-level code splitting remains optional optimization. |
| `npm exec -- playwright install chromium` | PASS; local Chromium installed for browser verification. |
| `npm run test:e2e` | PASS; three Chromium scenarios using real Vite, Express and an isolated PostgreSQL database. |
| `check-preservation.ts record/verify` | PASS; read-only fingerprint comparison confirmed original users, inventory, sales, suppliers, quotes, budgets, proposals, lines, reservations, business audit and idempotency records unchanged. |
| Desktop/mobile visual inspection | PASS; inspected dashboard and 390px proposal screenshots. Tables scroll within their containers; browser assertion confirmed no mobile page overflow. |

Frontend tests cover response validation, request headers/errors, monetary display, dashboard/filter behavior, independent inventory failure, staff/manager controls, insufficient funds, rejection validation, conflict refresh, lazy comparison, session/cache expiry and exact-request recovery.

Browser scenarios:

1. Staff login/dashboard/filter/create/detail/comparison; manager approves the staff draft, verifies exact available-budget reduction and refreshed pending count, creates/rejects another draft, and creates an over-budget draft with blocked approval. Mobile review and expired-session redirect are checked.
2. Allow a draft POST to commit, discard its response, reload, retry the saved request with the original key, and confirm only one matching proposal exists.
3. Simulate inventory failure while preserving working KPI cards, remove the failure and retry successfully.

Both database commands provision randomly named disposable databases. Only those databases are migrated/seeded, and both are dropped in `finally` cleanup. Browser credentials are newly generated test values. Owned browser/dev-server processes are stopped by Playwright. No migration, reseed, image change or business mutation was performed against the application database. Screenshots are ignored local artifacts under `.cache/`.

## Local startup and configuration

For the existing Day 1–3 installation:

```bash
npm ci
npm run db:generate
docker compose up -d --wait postgres
npm run dev
```

Open `http://localhost:5173`, then sign in using the existing `SEED_STAFF_EMAIL`/`SEED_STAFF_PASSWORD` or manager equivalents from your private root `.env`. `npm run dev` starts both React and Express. Use `/proposals` and proposal detail links for the screens; `/api/proposals` remains a JSON API.

No new environment variables are required. Existing `DATABASE_URL`, `API_PORT`, `WEB_ORIGIN` and `API_PROXY_TARGET` continue to apply. `WEB_PORT` optionally changes Vite's default 5173 port; change `WEB_ORIGIN` together with it. Existing installations do not need a migration/reseed for Day 4.

For `npm run test:e2e`, PostgreSQL must be available and the database role must have CREATE DATABASE permission. Ports 3104/5183 must be free. The safe harness supplies the test URL, origin/proxy/ports and temporary seed credentials automatically. Run this harness rather than setting the isolation flag manually or invoking Playwright against business data.

## Remaining scope and risks

There are no unresolved blockers for the delivered manual Day 4 flow. The existing pg driver concurrency deprecation warning appears in database checks; all tests pass, and a future driver upgrade should review it. The frontend chunk-size warning is nonblocking.

The OpenRouter API key/live exact-free-model tool-call gate remains deferred as requested. No live LLM test was run or claimed. Before implementing agents, configure credentials and verify the exact model; no paid substitution is allowed.

PDF upload, knowledge tables/pgvector migration, ingestion/retrieval, Policy Knowledge and the other agents remain Day 5+ work. The user selected manual-only Day 4. If live upload cannot fit safely, use the approved small synthetic corpus through the actual ingestion pipeline; if retrieval/citations/confidentiality are unsafe, explicitly disable RAG and retain this verified manual flow. Day 5 requires an explicit instruction.
