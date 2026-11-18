# SupplyPilot AI

Days 1–5 implementation for the approved supply chain and procurement MVP. The repository contains an npm workspace, functional React dashboard and proposal screens, authenticated Express API, PostgreSQL schema and demo seed, deterministic inventory/supplier/budget services, safe procurement transactions, PDF/RAG services and a three-agent LangGraph parent workflow.

Manual proposal creation, manager decisions, dashboard aggregation and audit APIs/UI are implemented. The backend agents, PDF ingestion/retrieval, dashboard assistant, cited policy search and manager knowledge screens are implemented. See [Day 6 verification](docs/day6-verification.md) for the frontend handoff and actual checks. Their intended design is in [the architecture](docs/architecture.md) and [the implementation plan](docs/implementation-plan.md).

## Local setup

Requirements: Node.js 22.12+ (Node 24 recommended), npm, Docker Engine and Docker Compose v2.

1. Copy `.env.example` to `.env` at the repository root if `.env` does not already exist. Never overwrite an existing environment without reviewing it.
2. Replace the database and seed password placeholders. Use distinct randomly generated passwords of at least 16 characters for staff and manager. Keep `.env` private and untracked.
3. Ensure `DATABASE_URL` matches `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `POSTGRES_PORT`. URL-encode special password characters in the URL. The local database binds only to loopback.
4. Run from the repository root:

```bash
npm ci
npm run db:generate
docker compose up -d --wait postgres
npm run db:migrate
npm run db:seed
npm run db:check
npm run dev
```

Open **http://localhost:5173**. Sign in using the seed email/password values in your `.env`. Express listens at **http://127.0.0.1:3001**; Vite forwards `/api` to it. Use the configured `WEB_ORIGIN` hostname to keep origin validation consistent.

The seed updates the configured accounts and revokes their sessions. It also seeds 50 products, 10 suppliers, 150 quotes and 1,500 sales records for 30 completed UTC dates, using deterministic IDs and a fixed numeric seed. It initializes the INR 500,000 budget and five historical proposal examples with matching audit records/reservations. Database migration deploy is repeatable. Do not delete the Docker volume to apply schema changes.

Reseeding refreshes demo stock, supplier quotes and sales, including overlapping dates if the reference date changes. Historical proposals are created only when no proposals exist; existing decisions, immutable lines and reserved funds are retained. It does not delete unrelated products/suppliers/proposals. The exact-count `db:check` is intended for this demo dataset and will fail if extra business records are added.

For this workspace's initial verification, an ignored `.env` was created with random local-only passwords. No credentials are included in committed files or logs. Review that file for login credentials or replace the seed values and rerun the seed.

## Configuration

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test` or `production`; demo seed refuses production |
| `API_PORT` | Express port, default `3001` |
| `WEB_ORIGIN` | Exact browser origin for CORS and mutation origin checks, default `http://localhost:5173` |
| `WEB_PORT` | Optional Vite port, default `5173`; keep `WEB_ORIGIN` in sync |
| `API_PROXY_TARGET` | Vite server-side proxy target, default `http://127.0.0.1:3001` |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Docker database initialization credentials |
| `POSTGRES_PORT` | Host database port, default `5432` |
| `DATABASE_URL` | Prisma/PostgreSQL URL; must match Compose settings |
| `SEED_STAFF_EMAIL`, `SEED_STAFF_PASSWORD` | Seeded staff login |
| `SEED_MANAGER_EMAIL`, `SEED_MANAGER_PASSWORD` | Seeded manager login; email must differ from staff |
| `SEED_REFERENCE_DATE` | Optional `YYYY-MM-DD` anchor for a reproducible seed/check; omit to use today's UTC date |
| `OPENROUTER_API_KEY` | Optional server-only API key for the live smoke test |
| `OPENROUTER_MODEL` | Must equal `google/gemma-4-31b-it:free` (user-authorized replacement; live verification pending) |

Do not prefix secrets with `VITE_`. Only Vite-prefixed values are eligible for client exposure; the backend loads root `.env` explicitly. Session tokens are random, stored hashed in PostgreSQL, expire after eight hours, and are sent as HttpOnly/SameSite cookies. Production cookies require HTTPS.

For a different web origin or API port, update the origin/proxy values together. PostgreSQL initialization environment variables apply when its data volume is first created; editing them does not change an existing database password automatically.

## Day 1 API

- `GET /api/health`: `200` when PostgreSQL is reachable; `503` with safe degraded status otherwise.
- `POST /api/auth/login`: strict `{ email, password }` JSON, matching `Origin` header required; returns public user data and a CSRF token, sets the session cookie.
- `GET /api/auth/me`: authenticated public user and CSRF token.
- `POST /api/auth/logout`: cookie, matching `Origin` and `X-CSRF-Token` required; revokes session and clears cookie.

Server-side `requireAuth` and `requireManager` enforce protected routes. Unexpected errors are sanitized and carry a request ID. Health reflects connectivity; seed/budget consistency is additionally checked by `db:check`.

## Day 2 read API

All routes below require a staff or manager session:

- `GET /api/inventory/risks?risk=HIGH&search=SP-&page=1&pageSize=25`: risk rows, pagination and portfolio-wide summary counts. Page size is capped at 100. Summary counts are independent of the applied filter.
- `GET /api/products/:id/sales`: exactly 30 completed daily values, missing dates zero-filled, totals and average.
- `GET /api/products/:id/quotes?quantity=10`: deterministic supplier comparison, quantity, delivery warning and budget affordability. Omit quantity to use the backend recommendation; zero demand/target already met requires an explicit quantity. Existing draft/approved replenishment is flagged and excluded from automatic recommendations.
- `GET /api/budget`: allocated, reserved and available integer paise with `INR` and `asOf`.

Inventory uses a fixed 30-day observation window excluding today. CRITICAL means stockout in <=7 days; HIGH means >7 and <=14; LOW means >14 or positive stock without recent demand. Zero stock is CRITICAL even with zero demand. **At Risk (Next 14 Days)** counts CRITICAL + HIGH; **Stockout Within 7 Days** counts CRITICAL only. Classification is unrounded; replenishment targets 30 days of demand.

Supplier selection prefers the cheapest quote arriving strictly before stockout, then fastest delivery, then supplier code. If none can arrive in time, choose fastest then cheapest and warn. No-demand products with explicit quantities and positive stock use lowest price first. Monetary estimates reject fractional paise and overflow; over-budget estimates return a warning rather than rejecting draft planning. Approval strictly checks current funds and reserves them atomically.

Default live calculations use the current UTC date. `SEED_REFERENCE_DATE` anchors the seed and verification commands only; historical seed data will naturally age in the live API. Rerun the seed with the current date for a current demo, or set an explicit date for reproducible tests.

## Day 3 procurement API

Use the dashboard and proposal screens for these operations, or an authenticated API client.

| Endpoint | Access/behavior |
| --- | --- |
| `GET /api/dashboard` | Both roles; four KPI values, budget/status overview and latest five proposals |
| `GET /api/proposals?status=DRAFT&page=1&pageSize=25` | Both roles; stable sorted/paginated summaries and draft affordability |
| `GET /api/proposals/:id` | Both roles; snapshots, current delivery/budget warnings, manager decision and sanitized audit timeline |
| `POST /api/proposals` | Both roles; supplier-grouped drafts, no budget reservation |
| `POST /api/proposals/:id/approve` | Manager only; approval/reservation/audit commit together |
| `POST /api/proposals/:id/reject` | Manager only; rejection/reason/audit commit together, no reservation |
| `GET /api/audit-events` | Manager only; paginated allowlisted audit output |

All mutations require the session cookie, matching `Origin` and `X-CSRF-Token` from login. Creation additionally requires an `Idempotency-Key` of 8–128 ASCII letters/digits or `. _ : -`. Use a fresh UUID per new request and reuse it for retries.

Example create body (replace IDs with real product IDs):

```json
{
  "items": [
    { "productId": "11111111-1111-4111-a111-111111111111", "quantity": 100 },
    { "productId": "22222222-2222-4222-a222-222222222222" }
  ],
  "reason": "Replenish stock before stockout."
}
```

Do not send supplier, price, total, role, creator or status fields; schemas reject them. Omitted quantities use backend recommendations. Existing draft/approved replenishment and satisfied stock targets are reported as automatic exclusions. Zero-demand products need an explicit quantity. Explicit repeats carry a warning. One request can create multiple supplier-specific proposals; any invalid product/quote/quantity prevents partial creation.

Creation returns `201` with `proposals`, `exclusions`, `warnings`, `batchTotalPaise`, budget and individual/batch affordability; all-skipped requests return `200` with no proposals. Over-budget drafts are permitted. Matching idempotent retries return the original committed response, even if a proposal has since been decided; fetch details for its current state. Reusing a key with different normalized input returns `409`.

Approve with `{}` or an empty body; reject with `{ "reason": "Purchase not needed." }`. Manager authority/session activity is revalidated in the transaction. Approval locks budget then proposal, recomputes stored line totals, conditionally reserves funds and creates one uniquely constrained reservation. Insufficient funds or conflicting terminal decisions return `409`. Identical decisions are repeat-safe; changing the reason of a repeated rejection conflicts. No operation increases stock or places a supplier order.

No new migration or application reseed was required for Day 3. The original database and Compose service were preserved.

## RAG compatibility checks

These are standalone Day 3 prerequisite checks, not PDF ingestion or agents:

```bash
npm run check:embeddings
npm run check:embeddings -- --offline
npm run check:pgvector
```

Embedding checks use local CPU `Xenova/all-MiniLM-L6-v2` with mean pooling/normalization, q8 weights and 384 dimensions. First use downloads public weights and records their exact revision in ignored `.cache/embeddings/preflight-profile.json`; offline mode loads the explicit cached directory with remote models disabled and verifies the same vector fingerprint. Optional configuration: `EMBEDDING_MODEL`, `EMBEDDING_REVISION` (40-character commit), `EMBEDDING_DIMENSIONS`, `EMBEDDING_CACHE_DIR` (absolute path). No paid embedding/chat API is called.

The pgvector check requires Docker and the running local PostgreSQL. It derives an image from the exact running PostgreSQL 17 digest, installs pinned pgvector 0.8.7, creates a consistent physical copy with `pg_basebackup`, and starts a separate temporary container/volume with no host port. It verifies original/copied business fingerprints, vector insertion/cosine search and copied-volume restart; then removes only its temporary container/volume. The application image/volume and schema are not replaced or migrated. The report is in ignored `.cache/pgvector/preflight.json`.

The physical-copy tar retained under `.cache/pgvector` is a sensitive database backup (mode 0600), not source code. Do not commit or share it. A compatibility PASS is runtime-specific and does not claim PDF parsing or retrieval quality is tested.

## Verification commands

```bash
npm run typecheck
npm test
npm run test:db
npm run build
npm audit
npm run smoke:openrouter
```

`npm test` runs backend/shared and frontend Vitest tests with no DB or API key. `npm run test:web` runs only frontend tests. `npm run test:db` now creates a randomly named disposable PostgreSQL database, applies the existing migration and seed there, runs all Day 1–3 database tests, then drops only that test database. The application database is never seeded/migrated by this command. Your local database role needs CREATE DATABASE permission and root `.env` needs the seed credentials. Direct database-test execution against the application DB is blocked by a setup guard. Do not set `TEST_DATABASE_ISOLATED` manually or run integration tests against production.

The standalone OpenRouter test skips without a key. With a configured key it checks the exact model's zero pricing and tool support in the catalog, requests a calculator call through `@langchain/openrouter`, validates arguments with Zod, computes `6 * 7`, and sends the tool result back to the model. It has a 60-second deadline, no paid fallback and no agents. A syntactically valid key can still be rejected by OpenRouter; only a successful live run proves account-level feasibility. Native structured-output support is not assumed.

The backend build starts with `npm run start -w @supplypilot/api`; the frontend production bundle is static output under `apps/web/dist` and needs an `/api` reverse proxy when hosted. Hosting is outside Day 1.

To stop PostgreSQL without deleting data:

```bash
docker compose stop postgres
```

The initial schema includes future business models and integer-paise constraints, but this does not imply those workflows have been implemented. Money uses PostgreSQL `INTEGER`, TypeScript integer numbers and JSON integer fields bounded by `2_147_483_647`; no rupee floats or Decimal money fields are introduced.

See [Day 1 verification](docs/day1-verification.md) for executed commands, actual results, limitations and the created-file inventory.

See [Day 2 verification](docs/day2-verification.md) for seed/service behavior, read endpoints, current demo values and test results.

See [Day 3 verification](docs/day3-verification.md) for procurement/concurrency checks, original data preservation and local embedding/pgvector gate evidence.

## Day 4 screens and browser verification

- `/`: live four-card dashboard, searchable/filterable/paginated risk table, procurement overview, latest five proposals and manual draft entry points. Day 6 adds a read-only-by-default assistant with explicit draft permission, selected-product quantities, recovery and cited guidance.
- `/proposals`: status-filtered, paginated proposal list and draft creation for **both staff and managers**.
- `/proposals/:id`: product lines, immutable price/quantity/delivery snapshots, current supplier comparisons on request, budget warnings and audit timeline. Only managers see confirmable approval/rejection controls; rejection requires a reason. The server remains authoritative for permissions and funds.

Create drafts by selecting products, optionally entering explicit quantities and entering a reason. The backend selects suppliers and groups drafts. Omit quantity to use backend recommendations/exclusions; enter an explicit quantity for zero-demand purchases. Over-budget drafts are permitted, with visible warnings. Approval reserves funds only and never orders goods or changes stock.

Draft requests save their exact payload and idempotency key in user-scoped **sessionStorage** before submission. If a response is lost, reopen Create proposal and choose **Retry saved request**. This recovers the original result without duplicating drafts. Recovery survives reloads in that tab; it does not survive closing the tab or clearing session storage. If storage is unavailable, new submission is blocked. No passwords, session cookies or CSRF tokens are saved there.

For browser tests:

```bash
npm exec -- playwright install chromium
npm run test:e2e
```

PostgreSQL must be running and the configured database role must have CREATE DATABASE permission. The command creates/migrates/seeds an isolated database with fresh temporary test credentials, starts Express on `3104` and Vite on `5183`, runs Chromium checks, stops its servers, and drops its database. Those ports must be free. Do not run Playwright directly against your application database or manually set the isolation flag. Linux browser installations may require OS libraries supplied by your environment.

Existing installations need no migration or reseed for Day 4. Run `npm ci`, `npm run db:generate`, then `npm run dev`; this starts both web and API. Keep the existing PostgreSQL data volume. See [Day 4 verification](docs/day4-verification.md) for results and remaining scope.


## Day 5 backend RAG and agents

The backend now supports Inventory, Procurement and Policy Knowledge agents through a LangGraph parent StateGraph. The exact free Nemotron model, local MiniLM embeddings and pgvector retrieval passed live checks. Policy findings are advisory, with authorized source/page citations; contracts are manager-only and supplier-scoped. AI can create DRAFTs only. Manager approval, budget reservation and manual procurement remain unchanged.

This checkout's database was backed up, moved to the compatible pgvector image on its existing volume, additively migrated and checked for preserved business records. **Do not reseed an existing installation.** Restart `npm run dev` after the update. Fresh installations can use the existing setup sequence; Compose now builds the pinned compatible image.

A ten-page **SYNTHETIC DEMO procurement policies** PDF is already READY locally. To ingest demo knowledge separately from the business seed:

```bash
npm run knowledge:ingest -- --synthetic
npm run knowledge:ingest -- /absolute/path/policy.pdf PROCUREMENT_POLICY "Procurement policy"
npm run knowledge:ingest -- /absolute/path/contract.pdf SUPPLIER_CONTRACT "Supplier contract" SUPPLIER_UUID
```

The operator command authenticates using `SEED_MANAGER_EMAIL`/`SEED_MANAGER_PASSWORD` from private root `.env`. It never resets business data. Supported PDFs have selectable English text and are at most 10 MiB/50 pages. The API and operator share a single database ingestion lease. Repeating identical bytes/type/supplier returns the existing document. Synthetic PDF generation is deterministic.

`EMBEDDING_MODEL`, `EMBEDDING_REVISION`, `EMBEDDING_DIMENSIONS` and `EMBEDDING_CACHE_DIR` configure the local profile. Initial download/cache compatibility must pass with `npm run check:embeddings`; repeat the offline check too. Restart the API after profile changes, then explicitly rebuild each affected knowledge index with:

```bash
npm run knowledge:ingest -- --reembed DOCUMENT_UUID
```

Old/new embedding profiles are never mixed. Existing business data is unaffected. Citation references from a replaced index must be retrieved again.

Optional switches in `.env` are `RAG_ENABLED=true`, `ASSISTANT_ENABLED=true` and `RAG_MIN_SIMILARITY=0.45`; these are the defaults. `RAG_ENABLED=false` produces explicit retrieval unavailability and blocks citation replay. `ASSISTANT_ENABLED=false` blocks new runs. Neither switch disables manual procurement. OpenRouter keys remain server-only; the exact free model is enforced with zero-price provider limits.

Verification:

```bash
npm run typecheck
npm test
npm run test:db
npm run test:rag
npm run test:e2e
npm run smoke:openrouter
npm run smoke:agents
```

`test:db`, `test:rag`, `test:e2e` and `smoke:agents` use disposable databases and require PostgreSQL CREATE DATABASE permission. RAG evaluation uses real cached local embeddings and pgvector; regular agent tests inject model responses. `smoke:agents` makes live free-model calls with synthetic data only. It checks classification, all three specialist stages, cited policy retrieval and a DRAFT, then removes its database. It does not create a proposal in the application database. Free-provider availability/rate limits can still fail the opt-in live checks; no paid fallback is used.

The new authenticated APIs are documented in [Day 5 verification](docs/day5-verification.md), along with migration/preservation evidence and current limitations. Chat, citations and knowledge upload/status browser screens were explicitly authorized and delivered in **Day 6**; see [verification](docs/day6-verification.md).


## Day 6 assistant and knowledge screens

Use **http://localhost:5173**, matching the configured `WEB_ORIGIN`; `127.0.0.1` is a different origin and will be rejected by authentication/CSRF protections. Restart `npm run dev` if your API is not watching source changes. No database migration or reseed is needed for Day 6.

- Dashboard: enter a question in **Ask the assistant**. Try “What is the available procurement budget?” or “Which products are at risk?”. Answers display backend-calculated values; policy findings are advisory with page citations.
- Select products in the inventory table to scope an assistant question. Optional per-product quantities are passed unchanged to the backend. Leave quantities blank to use backend recommendations/exclusions.
- To request drafts, explicitly check **Allow draft proposals**, then ask to create drafts. This permission resets after submission. Open the returned proposal links for the current status; only managers can approve/reject, and approval reserves funds without placing orders.
- Manager contract questions require a supplier selected in the assistant. Supplier selectors show authenticated server-provided identities; staff do not receive the directory or contract controls.
- **Knowledge** (`/knowledge`): both roles can list policies, download authorized sources and search policy passages without calling the chat model. Managers can select supplier-scoped contracts, upload English text PDFs (10 MiB/50 pages), retry failed ingestion and confirm archiving. Queued/processing document lists refresh automatically; Refresh documents is also available.
- **View source** revalidates the citation and current permissions before displaying the supporting passage. Downloads also recheck access on the server. Missing evidence and unavailable retrieval are explicit.

The visible conversation exists only while the dashboard is mounted; questions are independent requests, not multi-turn model memory. Results, document excerpts and credentials are not written to browser storage. Only an outstanding assistant request's user/role, exact input, idempotency key and optional owned run ID are saved in user-scoped sessionStorage for recovery. Pending requests survive reload in that tab. Use **Recover saved request** after a connection failure; it retains the original payload/key, or retrieves the known run by ID. Do not clear sessionStorage or close that tab while a draft outcome is uncertain; inspect Proposals if recovery storage is lost. No new write request is started automatically after an uncertain response.

Run `npm run test:e2e` without concurrent source edits or scripts that rebuild shared contracts; Vite reloads can interrupt browser state. Automated browser assistant transport is mocked; real PDF/local-model retrieval runs in the browser test, and the separate `npm run smoke:agents` checks the live exact-free-model graph in its own disposable database. See [Day 6 verification](docs/day6-verification.md).

To check ordinary-question routing against the live configured free model, run `npm run smoke:intents`. This checks inventory risk, stock, budget, draft intent and forbidden approval without database access. `npm run smoke:agents` also verifies real read-only inventory/budget results before its existing draft workflow in a disposable database. These credential-dependent checks are separate from mocked unit/browser assistant tests.


Current live-assistant limitation (2026-11-18): a follow-up inventory tool-call repair passes local tests but is not yet verified live; OpenRouter returned HTTP 429 on the latest attempts. The UI now explains rate limits and malformed operations. Manual inventory/procurement remains available. See the latest section of [Day 6 verification](docs/day6-verification.md); earlier successful checks do not guarantee current free-provider availability. For stock/risk questions, use dashboard product selection to narrow the server-owned scope; model-generated product filters are no longer accepted by those tools.


### Current chat model selection

The user explicitly authorized replacing Nemotron on 2026-11-18. The application and local `.env` now pin **`google/gemma-4-31b-it:free`**, with zero-price provider limits and no automatic fallback. Its live catalog advertises free tool calling, but no inference was attempted for the switch: read-only quota metadata confirmed **51 used / 50 daily / 0 remaining**. Switching free models does not refill that shared allowance. Historical Nemotron smoke results do not verify this replacement.

Smoke commands now check remaining quota and stop before inference when it is exhausted, insufficient for the check or unavailable. After capacity returns, follow the limited verification sequence in [Day 6 verification](docs/day6-verification.md): quota metadata → one calculator/tool round trip → one isolated graph run, stopping on failure. Restart the API if it is not watching source/config changes. No reseed or migration is needed.
