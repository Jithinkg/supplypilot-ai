# SupplyPilot AI — One-Week MVP Implementation Plan

Status: revised plan approved on 2026-11-17. Days 1–6 are complete; Day 7 remains planned for one full-stack engineer. Day 6 was explicitly authorized on 2026-11-18; see [verification](day6-verification.md). Days 3–5 were separately authorized and implemented; they do not authorize automatically starting Day 6 frontend integration.

Completed baseline: npm workspace/strict TypeScript, React shell/login/dashboard placeholder, Express authentication/sessions, PostgreSQL/Prisma schema and migrations, deterministic business seed, inventory/supplier/money services and authenticated read endpoints. See [Day 1 verification](day1-verification.md) and [Day 2 verification](day2-verification.md). The credential-dependent exact-free-model gate and live graph check passed during Day 5; see [Day 5 verification](day5-verification.md).

Day 3 adds draft/list/detail/decision/dashboard/audit APIs, transaction locks, idempotency and isolated database testing. Local CPU embeddings (including offline cache reuse) and pgvector against a consistent physical volume copy passed; original business fingerprints were preserved. See [Day 3 verification](day3-verification.md). No application migration/reseed or image/volume replacement occurred.

## 1. Outcome and approved decisions

Deliver this demonstration:

1. Staff signs in and sees backend-calculated inventory risks and procurement KPIs.
2. Staff asks the dashboard assistant about stock, demand, risks, supplier comparisons or budget.
3. Staff explicitly enables draft creation and requests replenishment proposals.
4. The Procurement Agent creates audited `DRAFT` proposals, grouped by supplier.
5. A manager reviews details and approves or rejects on a separate screen.
6. Approval atomically reserves funds; concurrent requests cannot overspend or reserve twice.

Add authorized, cited policy/contract review to purchase recommendations through the Policy Knowledge Agent. Findings are advisory, never definitive compliance approval. The original procurement workflow remains the highest priority and must function without RAG. Deliver functional dashboard/proposal review screens by Day 4, before the Day 6 integration phase.

| Decision | Approved specification |
| --- | --- |
| Stack | React/Vite/TypeScript, Tailwind/shadcn; Express/PostgreSQL/Prisma; Zod/Vitest |
| Agent framework | LangGraph JS parent `StateGraph`, Inventory, Procurement and Policy Knowledge agents |
| LLM integration | `ChatOpenRouter` from `@langchain/openrouter`, with LangChain tool integrations |
| Model | Exact `google/gemma-4-31b-it:free` (user-authorized replacement); no silent paid or other-model fallback |
| Embeddings | Configurable local CPU `@huggingface/transformers`, default `Xenova/all-MiniLM-L6-v2`, mean pooling, normalized 384-dimensional vectors; no paid embedding API |
| RAG storage | Existing PostgreSQL 17 with pgvector, Prisma 7 and forward-only additive knowledge migrations; no separate vector database |
| Documents | English text-based policy/contract PDFs; 10 MiB/50 pages maximum per file; basic page-cited retrieval |
| Document access | Manager upload/retry/archive; policies readable by staff/managers; contracts manager-only and supplier-scoped |
| Users | One company; seeded staff and manager accounts; no signup |
| Seed | 50 products, 10 suppliers, 30 completed days of sales history |
| Procurement | Simulated supplier quotes; multiple lines, one supplier per proposal |
| Currency | INR; one INR 500,000 budget = `50_000_000` paise |
| Money | Integer paise consistently across database, backend, contracts, API and tool results |
| Risk KPI | “At Risk (Next 14 Days)” = CRITICAL + HIGH; separate seven-day count where useful |
| Proposal safety | Over-budget drafts allowed with warnings; insufficient funds strictly block approval |
| Delivery | Local reproducible demo with Docker PostgreSQL |

Approval is not supplier ordering. No graph, agent or tool may approve/reject proposals or place orders. Only authenticated managers may decide through the REST decision flow.

Exclude registration/invitations, multi-tenancy, supplier APIs, supplier orders, receiving, inventory editing, budget administration/rollover, currency conversion, streaming chat and persistent multi-turn memory.

Also defer OCR, reranking, advanced hybrid search, document editing/version replacement and custom per-document ACL editing. The complete design, knowledge models, contracts, graph state, trust boundaries and transaction sequence are specified in [architecture.md](architecture.md). `AGENTS.md` records the approved three-agent, free-model, confidentiality and data-preservation guidance.

## 2. Proposed folder structure and engineering setup

```text
/
├── AGENTS.md
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/                  # Router, providers, shell
│   │       ├── pages/                # Login, dashboard, proposals, details
│   │       ├── features/
│   │       │   ├── auth/
│   │       │   ├── dashboard/
│   │       │   ├── inventory/
│   │       │   ├── proposals/
│   │       │   ├── assistant/
│   │       │   └── knowledge/        # Planned upload/status and citations
│   │       ├── components/ui/        # shadcn/ui
│   │       └── lib/                  # API client and display utilities
│   └── api/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       └── src/
│           ├── config/
│           ├── middleware/          # Auth, RBAC, CSRF, errors, limits
│           ├── routes/
│           ├── services/            # Business calculations, writes and knowledge retrieval
│           ├── knowledge/           # Planned PDF extraction, embeddings and ingestion worker
│           ├── agents/
│           │   ├── orchestrator/
│           │   ├── inventory/
│           │   ├── procurement/
│           │   ├── knowledge/
│           │   ├── tools/
│           │   └── model/
│           ├── db/
│           └── tests/
├── packages/contracts/src/           # Shared Zod API contracts
├── tests/e2e/
├── docs/
│   ├── implementation-plan.md
│   └── architecture.md
├── compose.yaml
├── .env.example
└── package.json
```

Retain the implemented npm workspaces, strict TypeScript for frontend/backend/shared packages, React Router, TanStack Query and dependency lockfile. Keep Prisma 7.x; avoid mixing major-version APIs. Keep shared contracts independent of Prisma and server code. The tree includes planned directories, not an instruction to create them during this documentation update.

Provide scripts for development, migration, deterministic seeding, type checking, building, Vitest and browser smoke tests during implementation. Configuration is validated with Zod. Secrets remain server-side and are represented only by placeholders in `.env.example`.

## 3. Implementation workstreams

### Database and seed

Preserve the implemented schema for `User`, `Session`, `Product`, `DailySale`, `Supplier`, `SupplierQuote`, `Budget`, `PurchaseProposal`, `ProposalLine`, `BudgetReservation`, `AgentRun`, `IdempotencyRecord` and `AuditEvent`. Retain the existing migration history and the Day 1–2 constraints/data below. Future proposal mutations use these existing models.

- Products have sales and supplier quotes; suppliers have quotes and proposals; proposals have immutable lines and at most one reservation; runs can produce multiple proposals.
- Use UUIDs, UTC times, unique SKU/email/supplier codes, and unique sales product/date and quote supplier/product pairs.
- Enforce valid values, proposal status enums, unique run/supplier drafts, unique reservation per proposal, and nonnegative available budget.
- Use PostgreSQL `INTEGER`/Prisma `Int` for money with `*Paise` field names. Validate safe integer arithmetic and the database maximum `2_147_483_647`; reject overflow. Do not introduce Decimal, BigInt or money strings.
- Seed exactly 50 products, 10 suppliers and 1,500 daily sales rows for the previous 30 completed UTC dates. Use a fixed random seed and explicit reference date.
- Include multiple quotes per product, all risk levels, zero-stock/zero-demand products, price/lead-time tradeoffs and proposal history sufficient for the latest-five dashboard.
- Seed matching reservations and audit history for approved examples. Allocated budget remains `50_000_000` paise; available funds reflect seeded reservations.
- Seed staff/manager credentials from environment configuration with Argon2id hashes. Make reseeding reproducible for the local demo.

These business-seed requirements are already delivered. Do not run that seed or reset the database for RAG setup. Knowledge fixtures use a separate ingestion command. Preserve authentication/session behavior, completed read APIs, deterministic calculations and all existing business records/balances.

### Inventory, supplier and money services

- Average daily sales = previous 30 completed UTC days' quantity / 30; missing dates are zero; exclude today.
- Stock zero is CRITICAL with stockout days zero. Positive stock with zero demand is LOW with `null` days. Otherwise divide stock by average demand.
- Classify <=7 days as CRITICAL, >7 and <=14 as HIGH, >14 as LOW. Use full precision; round only for display.
- Return `atRiskNext14Days` and `stockoutWithin7Days` separately. Never label the combined count as a seven-day risk measure.
- Recommended quantity is `max(0, ceil(30 * averageDailySales - stock))`. Skip zero recommendations; require an explicit quantity for zero-demand purchases.
- Automatic replenishment excludes products already in draft/approved proposals and reports exclusions. Proposals never alter stock or risk estimates.
- Choose the lowest-price supplier arriving strictly before stockout, then shortest lead time, then supplier code. If none arrives in time, select fastest, then cheapest, then supplier code and flag delivery risk.
- For positive-stock/zero-demand products with an explicit quantity, select cheapest, then fastest, then supplier code.
- Group by supplier; snapshot prices/lead times; calculate line/proposal totals in paise on the server.
- Tax, freight, discounts, minimum orders and currency conversion remain out of scope and are disclosed in the UI.

### Proposals, budgets and audit

- Use one service for manual and AI draft creation. Accept product IDs, optional explicit quantities and reason; never trust model/client totals, supplier rankings, status or actor identity.
- Validate all groups before writing. Create all drafts/lines/audit records for one request atomically. No quote or missing quantity means clarification/error with no partial draft set.
- Allow drafts exceeding budget. Return visible warnings, `shortfallPaise` and budget `asOf`; include combined affordability for multi-proposal requests.
- Require server-authenticated managers for decision endpoints. The frontend is not an authorization boundary.
- Approval transaction locks budget then proposal, revalidates DRAFT and totals, conditionally reserves funds, creates the unique reservation, updates decision fields and inserts audit history.
- Insufficient funds strictly block approval with no mutation. Rejection requires a reason and writes decision/audit atomically without reserving funds.
- Identical repeated decisions return the existing result; conflicting decisions return `409`. Retry transaction conflicts a bounded number of times.
- Preserve request idempotency with user-scoped keys and canonical input hashes. Never blindly retry writes.
- No model calls inside transactions; no proposal edits/deletion, order execution or reservation release in this MVP.

### REST and security

Implement these `/api` routes:

| Group | Endpoints |
| --- | --- |
| Authentication | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` |
| Dashboard | `GET /dashboard` |
| Inventory | `GET /inventory/risks`, `GET /products/:id/sales` |
| Quotes and budget | `GET /products/:id/quotes`, `GET /budget` |
| Proposals | `GET /proposals`, `GET /proposals/:id`, `POST /proposals` |
| Manager decisions | `POST /proposals/:id/approve`, `POST /proposals/:id/reject` |
| Assistant | `POST /assistant/runs`, `GET /assistant/runs/:id` |
| Audit and readiness | `GET /audit-events`, `GET /health` |

Apply staff/manager access to business reads and draft creation; manager-only access to decisions and global audit; run-owner-only access to run recovery. Health is public and reveals no sensitive details.

Use eight-hour opaque database sessions, hashed tokens, HttpOnly/SameSite cookies, secure cookies outside local HTTP, CSRF tokens and origin checks, a local same-origin proxy, rate limiting and request-size limits. Resolve active users and roles server-side.

Use shared Zod contracts, integer monetary JSON fields, ISO times, pagination capped at 100 rows and request-correlated errors. Distinguish authentication/authorization failures, validation, missing resources, conflicts and unavailable model service. Require `Idempotency-Key` for assistant runs and manual draft creation.

### LangGraph and OpenRouter

Build an explicit parent `StateGraph`:

`START -> validate -> classify -> capability policy -> specialist route -> grounded response -> END`

Route inventory questions to Inventory; supplier/budget questions to read-only Procurement; policy questions and authorized supplier-scoped contract questions to Policy Knowledge. Purchase recommendations follow Inventory -> Procurement planning (quotes/budget) -> Policy Knowledge -> citation/advisory validation -> response or explicit Procurement draft phase. Clarify ambiguous input/supplier scope. Deny approval/rejection/order requests and link to the manager screen where appropriate.

The classifier returns a Zod-validated intent enum. It cannot grant capabilities. Draft execution requires both explicit `CREATE_DRAFT` client mode and validated draft intent. Default mode is `READ_ONLY`.

| Agent | Assigned tools |
| --- | --- |
| Inventory | `getStockLevels`, `getSalesHistory`, `getInventoryRisks` |
| Procurement | `getSupplierQuotes`, `getAvailableBudget`, `createPurchaseProposal` |
| Policy Knowledge | `searchProcurementPolicies`, `searchSupplierContracts` |

- Bind separate tool registries; reject cross-agent/unknown tools before execution. Remove the draft tool from read-only mode and recheck capabilities within its handler.
- Store run/input/routing/findings/progress/output in graph state. Keep authenticated identity, role, capabilities, registry and dependencies in immutable server-owned runtime context.
- Add knowledge query/type/supplier scope, retrieval status, authorized evidence and validated citations to state. Communication is parent-mediated typed state/transitions; agents do not call one another directly.
- Policy Knowledge is read-only; the server forces document type, manager-only contract permission and supplier scope. Do not expose upload/write/approval tools to it.
- Findings are advisory: supporting clauses, potential conflicts, `INSUFFICIENT_EVIDENCE` or `UNAVAILABLE`. Never certify compliance, change supplier ranking/prices/quantities or add an acknowledgement gate. Explicit drafts remain possible with missing-evidence warnings.
- Protect contract content and derived findings across state, handoffs, owned run results, responses, proposals, citations and audit metadata. Never copy them into staff-visible reasons/shared summaries or ordinary audit/log payloads. Revalidate access on stored-answer recovery and source opening.
- Procurement services revalidate structured inventory handoffs. Neither agent receives unrestricted database or manager decision access.
- Use `ChatOpenRouter` from `@langchain/openrouter` and exact `google/gemma-4-31b-it:free`. No paid fallback or implicit model substitution.
- Planning verification on 2026-11-15 found this ID in the public catalog with zero prompt/completion pricing and `tools`/`tool_choice` support. Native structured-output response formatting was not listed for this free model.
- Use function-calling-based classification and Zod validation instead of assuming native JSON-schema responses. Allow one repair attempt.
- Before implementing agents, recheck metadata and run an authenticated tool-call/classification smoke test. If unavailable or incompatible, report it before agent implementation and keep the manual workflow usable.
- Bound each run to 60 seconds and 12 tool calls. Persist status/result and proposal references; recover by run ID after an interrupted response. Successful writes remain visible even if final text generation fails.
- Reconcile interrupted/expired runs from committed state without replaying writes. Mock model calls in normal tests.

### Knowledge compatibility gate, migration and ingestion

Before implementing PDF ingestion, record PASS for both prerequisites on the actual runtime: (1) local model download/cache and finite, normalized correctly dimensioned embeddings; (2) pgvector insert/cosine-search compatibility on a copied existing data volume using the derived PostgreSQL image, with business-data/balance preservation checks. Time-box feasibility to two hours on Day 3. A package/image listing is not a successful test. Failures block ingestion, not independent procurement work.

- Derive the image from the same pinned PostgreSQL 17 Alpine base and a pinned compatible pgvector release. Preserve the real volume/mount/database settings and Prisma 7. Do not automatically switch OS or PostgreSQL major version.
- Before future rollout, back up the database, record existing business records/counts and budget/reservation values, verify the copied-volume preflight, then deploy a new additive migration enabling `vector` and creating `KnowledgeDocument`, `DocumentChunk`, `EmbeddingProfile` and `ChunkEmbedding`. No resets, volume deletion, database regeneration or business reseeding.
- Store PDF bytes/metadata/status in PostgreSQL; retain chunk text, original one-based page number/offsets and immutable embedding profiles. Use Prisma `Unsupported("vector")` plus parameterized Prisma SQL for vector operations, with dimension/profile checks.
- Manager upload requires authentication, role, origin and CSRF checks before multipart parsing. Validate extension/MIME/signature/parser, cap one file at 10 MiB and 50 pages, and require supplier association for contracts only. Reject encrypted, malformed and wholly image-only PDFs.
- Extract text page by page using `pdfjs-dist`. Skip blank pages without renumbering; do not perform OCR or promise table reconstruction. Split within each page at approximately 180 model tokens with 30-token overlap, retaining source text/offsets.
- Use a single background worker with persisted `QUEUED/PROCESSING/READY/FAILED/ARCHIVED` states. Extract/embed outside transactions and atomically publish complete chunks/vectors/READY status. Failed or partial documents are not searchable; interrupted work is marked failed for explicit duplicate-safe retry.
- Deduplicate identical bytes/type/supplier uploads. Re-upload/edit/version replacement is otherwise outside Week 1 scope; archive removes a document from retrieval and source access.
- Embed locally with `@huggingface/transformers` and default `Xenova/all-MiniLM-L6-v2` (mean pooling, normalized 384 dimensions). Configure model/revision/cache and retrieval threshold. Initial weights require network download; cached inference has no paid API call or GPU/Python-service requirement.
- Profile model/revision/dimensions/pooling/chunking immutably. Different profiles are never mixed. Model changes require knowledge re-embedding without touching business data.

### Retrieval, citations and knowledge interfaces

- Use exact pgvector cosine search, with SQL authorization/type/supplier/READY/profile filters before top-five selection. Defer ANN indexes, reranking and hybrid search. Contract queries require a validated relevant supplier, never implicit cross-supplier search.
- Start minimum similarity at configurable `0.45`; calibrate on development fixtures at the first working retrieval checkpoint (Day 4 if feasible, otherwise Day 5 after core UI acceptance) and record the chosen setting before evaluation. Similarity does not certify factual correctness or compliance.
- Server-built citations contain document ID, chunk ID, page number and supporting text. Validate against the current authorized results, original page and actual chunk text. Never accept invented references from the model.
- Return explicit `EVIDENCE_FOUND`, `INSUFFICIENT_EVIDENCE` or `UNAVAILABLE`; outages are not completed reviews. Recheck role/document/supplier permissions on citations and stored results, including archived documents or changed user roles.

| Endpoint | Planned access/behavior |
| --- | --- |
| `POST /api/knowledge/documents` | Manager upload; `202` with document/status |
| `GET /api/knowledge/documents` | Authorized paginated listing |
| `GET /api/knowledge/documents/:id` | Authorized metadata/status |
| `GET /api/knowledge/documents/:id/file` | Authorized PDF for citation review |
| `POST /api/knowledge/documents/:id/retry` | Manager retry |
| `POST /api/knowledge/documents/:id/archive` | Manager archive |
| `POST /api/knowledge/search` | Permission-filtered retrieval preview shared with agent tool services |

Both roles may read policies. Contracts are manager-only and supplier-scoped. Restrict metadata, excerpts and derived answers, not just raw file downloads. Document mutations use existing origin/CSRF/session controls.

### Frontend

Implement the original four routes plus the bounded knowledge interface:

| Route | Page/components |
| --- | --- |
| `/login` | Login form, session redirect and generic credential errors |
| `/` | App shell, KPI cards, inventory table, procurement overview, recent proposals, assistant |
| `/proposals` | Status-filtered paginated list and manual draft dialog |
| `/proposals/:id` | Supplier, lines, total, quote comparison, budget impact, warnings, decisions and audit timeline |
| `/knowledge` | Authorized list; manager type/supplier/upload controls, statuses, retry/archive; upload UI is deferrable under fallback |

Dashboard specifications:

- Four cards: Total Products, At Risk (Next 14 Days), Pending Proposals, Available Budget. Pending means DRAFT.
- Risk table: stock, average daily sales, days until stockout and risk level, with SKU/name/filter controls and replenishment indicators. Add the separate Stockout Within 7 Days summary.
- Procurement overview: status counts and allocated/reserved/available funds.
- Recent proposals: latest five by creation time, with stable tie-breaking and detail links.
- Assistant: input directly on dashboard, local transcript, progress, safe-rendered answers, retries and proposal links. Default to read-only with an explicit “Allow draft proposals” control.
- Add authorized page citations, advisory findings and explicit missing/unavailable evidence. Citation links recheck current access; never expose contract excerpts or derived findings to staff.
- Proposal details: manager-only confirmable approve/reject controls, required rejection reason, visible over-budget/late-delivery warnings and reservation-only wording. Staff have read-only decisions.
- Format integer paise as INR at the display boundary. Render backend calculations without recreating them in frontend logic.
- Invalidate dashboard/proposal/inventory/budget queries after writes and refresh on conflicts. Include responsive, accessible loading/empty/error states.

The core dashboard and manual proposal review flow must pass acceptance by Day 4, before Day 6 final integration. If delayed, finish them before expanding RAG on Day 5. Trim optional styling/polish before safety, original dashboard requirements, access controls or tests.

## 4. Seven-day milestones

| Day | Tasks | Completion gate |
| --- | --- | --- |
| 1 — Complete: foundation | Workspace, strict TypeScript, Vite/Express, PostgreSQL/Prisma, auth/sessions and smoke-test script | Recorded foundation checks passed; live chat inference deferred until credentials, before agents |
| 2 — Complete: data/calculations | Business seed; inventory/replenishment/supplier/budget/money services and authenticated reads | Exact counts and deterministic rules verified; 36 isolated and 11 PostgreSQL tests recorded at Day 2 completion |
| 3 — Complete: procurement safety and compatibility gate | Draft/list/detail/dashboard/audit APIs, manager decisions, atomic reservations, idempotency and concurrency/rollback tests. Actual-runtime local embeddings and copied-volume pgvector preflight. | 39 isolated and 28 PostgreSQL tests passed; type checks/build passed. Both compatibility gates PASS, including offline model reuse and clone restart/data checks. Original business data unchanged. No ingestion implemented. |
| 4 — Complete: functional procurement screens | Four-card dashboard, risk table, procurement overview/latest five, manual draft UI for both roles, proposal list/details and manager review. User selected manual procurement only; ingestion remains deferred. | Manual flow verified in Chromium, including decisions, budget refresh, warnings, session expiry and uncertain-request recovery. Backend/shared, frontend and isolated PostgreSQL tests pass. See Day 4 verification. |
| 5 — Complete: backend RAG and three-agent workflow | Additive pgvector/knowledge migration with backup/preservation checks; manager PDF upload/worker; pinned local embeddings and scoped retrieval; parent StateGraph, three specialists, explicit AI drafts and owned recovery. Operator synthetic corpus ingested. | Exact-free live graph with real cited retrieval and one DRAFT passed; deterministic privacy/authorization/recovery tests passed. Real retrieval: 10/10 expected pages, 5/5 missing-evidence abstentions. Browser procurement regression passes. See Day 5 verification. |
| 6 — Complete: final integration and evaluation | Integrate assistant/citations with already functional procurement screens; complete upload UI only if pipeline reliable. Run RAG, privacy, recovery and browser evaluations. | Manual flow remains independent; enabled RAG passes relevance/citation/abstention/injection/access tests; no leakage across state, responses, proposals or audit. |
| 7 — Freeze and demo rehearsal | Fix defects, verify preserved data, cache/warm models, rehearse startup/demo and document actual delivered scope. No new features. | Reproducible original procurement workflow, exact reservations/audit and passing required checks; working accepted RAG or clearly disclosed fallback/deferred scope. |

This expansion is a high-risk stretch for one engineer with five days remaining. The original end-to-end procurement workflow has highest priority; the basic UI must not first arrive on the final integration day. Day 3 preflight is time-boxed; Day 4–5 RAG is conditional on completed safety/UI prerequisites. Reduce optional polish before scope-critical behavior or verification.

Fallback ladder:

1. If embedding/pgvector compatibility fails, report it and keep ingestion blocked while continuing original procurement work.
2. If live upload/its UI is unreliable at the end of Day 4, prioritize a small synthetic corpus pre-ingested through the same pipeline by an operator command, after compatibility PASS. This is genuine RAG but deferred live upload, not full feature completion.
3. If retrieval, contract confidentiality or citation validity remains unsafe by the end of Day 5, disable RAG and Policy Knowledge explicitly; preserve the original procurement demo and label policy review unavailable.
4. If the free chat model/key is unavailable, preserve manual procurement and any working direct retrieval preview. No paid substitution, mocked live-agent claims or silent capability fallback.

## 5. Testing strategy

Use Vitest for services, contracts and graph logic; Supertest for HTTP; real disposable/local PostgreSQL for transaction behavior; Playwright for a small browser smoke suite. Automated tests mock LLM/external integrations and require no OpenRouter key. Keep the live smoke test opt-in and synthetic.

| Area | Required scenarios |
| --- | --- |
| Inventory | Exactly 7/14 days and values immediately around them; fractional averages; missing sales dates; exclusion of today; zero sales; zero stock; rounding only for display |
| KPI consistency | CRITICAL + HIGH equals At Risk (Next 14 Days); CRITICAL equals Stockout Within 7 Days; zero-demand exceptions follow policy |
| Replenishment | 30-day target, positive integer quantities, zero recommendation, explicit zero-demand quantity, existing proposal exclusions |
| Supplier selection | On-time versus late, cheapest on-time, fastest fallback, deterministic ties, inactive suppliers, missing quotes and no partial batch creation |
| Money | Exact integer totals/reservations, paise in API/tool/audit contracts, rejected fractions/overflow, correct INR display |
| Drafts | Both roles can create DRAFT only; price snapshots immutable; over-budget individual/batch warnings; no draft reservation |
| Approval | Authenticated manager only, funds sufficient/exact/insufficient, required rejection reason, terminal transition rules |
| Transactions | Duplicate approval, approval versus rejection, different proposals competing for funds, unique reservation, rollback on audit/reservation failure |
| Idempotency | Same key/same input returns prior outcome; same key/different input conflicts; repeated agent tool writes do not duplicate drafts |
| Authentication | Invalid credentials, expired/revoked sessions, logout, CSRF, inactive users, staff forbidden from decision/audit routes |
| Agent boundaries | Cross-agent/unknown tools, spoofed roles, prompt injection, approval/order requests, read-only draft attempts, malformed intent/arguments |
| Recovery | Timeout before writes, final-response failure after writes, retrieval of owned results, denied cross-user run access, interrupted-run reconciliation |
| Browser | Login; correct four cards; risk table and latest five; staff draft; manager approval/rejection; budget refresh; warnings/conflicts |
| Preservation | Existing Day 1–2 tests; business records/counts, decisions and reservation totals unchanged by knowledge migrations; copied-volume image test |
| Ingestion | Valid/oversized/spoofed/malformed/encrypted/image-only PDF; blank pages; original page numbers; duplicate upload; retry/interrupted processing |
| Retrieval relevance | Synthetic corpus with >=10 answerable and >=5 unanswerable questions; expected source in top five for >=80% of answerable cases; unanswerable fixtures abstain |
| Citation integrity | Every citation resolves to current authorized retrieved chunk/page/supporting text; reject fabricated IDs/pages/quotes |
| Confidentiality | Staff/manager isolation, contract supplier filters and changed-role recovery; inspect state/handoffs, answers, proposals, citations and audit/log metadata for leaks |
| Knowledge failure modes | Archived/failed/partial documents excluded; profile/dimension mismatch; missing local weights; unavailable retrieval distinguished from insufficient evidence |
| RAG prompt injection | Documents cannot change roles/tools/filters, purchasing calculations, budget rules or decision/order capabilities |

Run strict type checks, relevant Vitest suites, builds and browser smoke checks for implementation changes. Separate deterministic mocked tests from real PostgreSQL/pgvector/local-model retrieval evaluation and credential-dependent live chat checks. Record the calibrated relevance threshold before evaluation. Report checks not run and any failed gates; documentation-only edits require document/scope validation rather than application/database execution.

## 6. Acceptance, risks and handoff

### MVP acceptance

- Exactly 50 products, 10 suppliers and 1,500 sales rows are seeded reproducibly.
- The dashboard displays correct four KPIs, risk table, procurement overview, latest five proposals and integrated assistant input.
- Risk labels/time windows and backend formulas agree; the 30-day demand window is distinct from the 14-day risk horizon.
- Supplier recommendations explain price and delivery tradeoffs using server values.
- Explicit assistant requests create only audited drafts, one supplier per proposal, with correct integer-paise totals.
- Over-budget drafts are allowed and visibly warned. Approval with insufficient funds is rejected without writes.
- Only managers decide; approval reserves the exact amount once and records manager/time atomically.
- No agent can approve/reject, reserve funds directly or place orders.
- Manual workflows work when the model is unavailable. Free model selection is exact, with no paid fallback.
- Type checking, targeted automated tests and browser smoke checks pass. Fresh setup and the demo script are reproducible.
- Original manual procurement is the highest-priority acceptance path; dashboard and proposal review screens are functional at the Day 4 checkpoint, before Day 6 integration.
- Ingestion starts only after recorded actual-runtime local-model and copied-volume pgvector compatibility PASS results. Existing business records/balances and Day 1–2 functionality survive additive knowledge migrations.
- Full RAG acceptance requires safe manager PDF ingestion, local embeddings, authorized retrieval and valid source/page citations; missing evidence abstains and outages are explicit. Findings never represent definitive compliance approval.
- Contracts and derived findings remain confidential across agent state, responses, owned runs, proposals and audit metadata; supplier/type/role filters cannot be overridden by the model.
- If a fallback is used, list deferred upload/RAG/agent capability explicitly. A reduced demo is not full RAG feature completion.

### Risks and controls

| Risk | Control |
| --- | --- |
| Free model availability, limits or tool incompatibility | Catalog/live smoke gate before agent implementation; credentials deferred from Day 1; bounded retries, explicit issue report and no paid fallback |
| Solo one-week capacity | High-risk five-day expansion; procurement first, Day 4 UI checkpoint, time-boxed gates and explicit reduced-scope fallbacks |
| Budget races | Fixed row-lock order, conditional update, database constraints and concurrency tests |
| Hallucinated arithmetic or authority | Deterministic services, trusted context, strict tool validation and server authorization |
| Prompt injection/tool escalation | Separate allowlists, capability checks inside tools, untrusted content handling |
| Duplicate drafts on retry | User-scoped idempotency, run/supplier uniqueness and committed-result recovery |
| Integer monetary overflow | Shared paise schema, checked multiplication/sums and PostgreSQL integer bounds |
| Stale draft affordability | Timestamped warnings; authoritative funds check during approval |
| Unrepresentative seed | Fixed synthetic scenarios for ordinary, boundary and adverse cases |
| Demo confused with purchasing automation | Reservation-only wording; no supplier-order integration |
| Local model download/native compatibility | Hard Day 3 preflight, cached weights, recorded runtime/profile; ingestion blocked until PASS |
| pgvector image/data incompatibility | Same pinned PostgreSQL 17 Alpine base, copied-volume test, backup, additive migration and business-data checks; no reset/reseed |
| RAG evidence mistaken for compliance approval | Advisory wording and validated citations; explicit missing/unavailable evidence; deterministic rules unchanged |
| Contract disclosure | Server SQL filters before top-k plus output/state/proposal/audit checks and source/recovery reauthorization |
| Unsafe or late upload/retrieval | Pre-ingested synthetic corpus through same pipeline if upload slips; disable unsafe RAG by Day 5 gate |

### Day 6 readiness and documentation handoff

Days 1–6 are complete. The manual procurement screens remain functional, original business records are preserved, backend RAG/agents passed their gates, and the explicitly requested Day 6 UI passed its checks. See [Day 6 verification](day6-verification.md). See [Day 4 verification](day4-verification.md) and [Day 5 verification](day5-verification.md). Day 6 was subsequently started by explicit instruction on 2026-11-18. Both actual-runtime local-model and copied-volume pgvector gates passed; repeat them when changing the tested runtime/configuration. Day 5 subsequently authorized and verified the compatible image/additive migration rollout. Future migrations still require their own preservation checks. Exact-free live tool calling and the complete bounded graph were verified.

This plan, the architecture and root `AGENTS.md` are the handoff artifacts. Day 7 should record setup/environment guidance, non-destructive migration and separate knowledge-ingestion commands, demo steps, actual test/gate results and any fallback limitations. Do not automatically reseed completed business data. No production rollout is planned; diagnostics use IDs/timing/usage and sanitized events without contract text or derived restricted findings.

Model references are in [architecture.md](architecture.md); actual Day 3 evidence is in [day3-verification.md](day3-verification.md). The prior documentation-only stage is complete. The subsequent Day 6 instruction authorized its documented integration; it does not authorize additional MVP scope.


### Day 4 acceptance and fallback decision

The manual procurement checkpoint is delivered: both roles create supplier-grouped drafts; product lines and immutable snapshots are visible; manager-only confirmation/rejection, budget warnings, atomic server decisions and cache refresh work together. Day 4 verification records the actual automated/browser results. No business calculations were moved to the frontend and no existing data was reset or reseeded.

Live PDF upload and RAG were deliberately excluded from this authorized Day 4 scope. For Day 5, first revalidate the recorded compatibility gates if configuration/runtime changes. Prefer the approved small synthetic corpus ingested through the actual pipeline if live upload cannot fit safely; implement no ingestion until that next stage is explicitly authorized. If retrieval/citation/confidentiality checks fail, disable RAG/Policy Knowledge and retain the verified manual workflow. Live exact-free-model tool calling must pass before agent implementation; the deferred API key remains a prerequisite. This checkpoint is not full RAG or agent completion.


### Day 5 acceptance and remaining Day 6–7 work

Day 5 backend acceptance passed: bounded parent orchestration and all three specialist tool registries; READ_ONLY default; owned idempotent runs; explicit authenticated AI DRAFT-only writes with atomic deterministic pricing/grouping; no AI decisions/orders; manager-only contracts with supplier filters and safe recovery; page-cited retrieval and explicit insufficiency/unavailability; manager upload/retry/archive, global worker lease and explicit profile re-embedding. The ten-page synthetic policy corpus is indexed through the real pipeline. Existing business fingerprints match the pre-Day-5 baseline; no business seed/reset occurred.

The approved operator-ingestion fallback is ready and populated. The backend multipart endpoint also works; the live browser upload UI remains Day 6 work. Day 6 should connect dashboard chat, explicit Allow draft proposals mode, owned-run recovery/proposal links, safe structured-result rendering and authorized citation/file links. Add knowledge upload/status/retry/archive UI only within the remaining schedule; otherwise retain the operator path. Keep mandatory procurement and privacy checks unchanged. Day 7 remains freeze/repair/rehearsal, with no new features.

Read [Day 5 verification](day5-verification.md) for commands/results, supported configuration, APIs, private backup location and the known unpatched development-tool glob advisory. Do not claim production readiness or broaden RAG beyond the small English text-PDF corpus.


### Day 6 acceptance

Day 6 was explicitly requested and delivered on 2026-11-18. Dashboard assistant, read-only defaults, explicit per-request draft permission, selected product quantities, exact saved-request/owned-run recovery, typed structured result rendering, proposal links and authorized citation opening are connected. The Knowledge page includes scoped listing/search, manager upload/retry/archive and ingestion polling; the optional upload UI was completed. A manager-only supplier-identity directory supports validated scope selectors without exposing contract data.

All six browser checks pass, including real PDF/local-embedding retrieval and source denial after archive, plus the separately mocked assistant-response recovery flow to a real draft and manager decision. Existing manual procurement remains independent. The exact-free live graph passed separately. See [Day 6 verification](day6-verification.md) for test counts, scope, limitations and startup/demo steps. Earlier Day 4–5 sections describe their historical handoffs. No application database migration/reseed or production deployment occurred. Day 7 remains freeze, repair and demo rehearsal; no new features.
