# Day 3 — Procurement Safety and Compatibility Gates

Implemented and verified on 2026-11-17. The work preserves the original end-to-end procurement workflow and completed Day 1–2 business rules/data. The full React dashboard/proposal screens remain Day 4 work.

## Delivered APIs

| Endpoint | Access and result |
| --- | --- |
| `POST /api/proposals` | Staff/manager; creates supplier-grouped DRAFTs with immutable line snapshots and individual/batch budget warnings |
| `GET /api/proposals` | Staff/manager; status-filtered, stable paginated summaries and current draft affordability |
| `GET /api/proposals/:id` | Staff/manager; product/price/lead-time snapshots, current delivery/budget warnings, decision and sanitized audit timeline |
| `POST /api/proposals/:id/approve` | Manager only; exact-once reservation, status and audit in one transaction |
| `POST /api/proposals/:id/reject` | Manager only; required reason, status and audit in one transaction; no reservation |
| `GET /api/dashboard` | Staff/manager; four KPI values, status/budget overview and latest five proposals |
| `GET /api/audit-events` | Manager only; filtered/paginated, allowlisted audit output |

Creation input is `{ items: [{ productId, quantity? }], reason }` with a user-scoped `Idempotency-Key`. Origin, CSRF and session checks protect mutations. Clients cannot set supplier, creator, role, status, total or price. Duplicate products and invalid quantities/keys are rejected. Equivalent normalized input/item ordering replays the original committed result; a changed payload under the same key returns 409.

The same deterministic Day 2 services select suppliers and quantities. Omitted quantities exclude existing replenishment or satisfied stock targets and report exclusions; no-demand products require an explicit quantity. Explicit repeats report an existing-replenishment warning. Invalid products/quotes/quantities cannot create partial supplier groups. Over-budget drafts are permitted and do not reserve funds.

Approval/rejection services revalidate a live active human session and current manager role inside the transaction. Shared user/session locks prevent role/deactivation/revocation races during the mutation. AI-context decision attempts are denied. Budget is locked before proposal; approval recomputes and validates immutable totals, conditionally increments reserved funds, inserts the uniquely constrained reservation, records the manager/time and writes audit together. Transaction/deadlock retries are bounded; all external calls are outside transactions.

An identical decision is repeat-safe; conflicting terminal decisions or differing repeated rejection reasons return 409. Approval with exact available funds succeeds; insufficient funds leaves status, balance, audit and reservations unchanged. Rejection never reserves funds. No supplier order or inventory increment endpoint exists.

List/detail/dashboard reads use consistent read transactions. Only draft affordability is shown; approved/rejected summaries return null affordability. Audit serialization allows only known monetary/status/fixture metadata; confidential or unexpected metadata is not echoed.

## Preservation and test isolation

- No schema change or migration was needed for the procurement backend. Existing Day 1 tables were reused.
- The application database was not migrated or reseeded. Its Compose image and persistent volume were not changed.
- A read-only fingerprint snapshot compared existing users, products, sales, suppliers, quotes, budgets, proposals, lines, reservations, business audit and idempotency records before/after. All were unchanged.
- A private logical backup was taken at `/tmp/supplypilot-before-day3.dump`; fingerprint metadata is at `/tmp/supplypilot-day3-preservation.json`. These are local verification artifacts, not repository source or a production backup policy.
- `npm run test:db` now creates an internally generated disposable PostgreSQL database, applies the existing migration/seed only there, runs all Day 1–3 integration tests, and removes only that database afterward. The local role needs CREATE DATABASE permission.
- A setup guard refuses direct integration-test execution against the application database. Existing Day 2 reseed/date-shift tests remain intact but now run safely in the disposable database.

## Test and build results

| Check | Result |
| --- | --- |
| `npm run db:generate` | Existing Prisma 7.10.1 client generated |
| `npm run typecheck` | All three workspaces passed strict TypeScript checks |
| `npm test` | 39 isolated/foundation tests passed across eight files |
| `npm run test:db` | 28 PostgreSQL integration tests passed across three files; temporary DB removed |
| `npm run build` | Contracts, backend and frontend production builds passed |
| `npm audit` | Zero known vulnerabilities in final dependencies |
| Compiled backend on temporary port 3103 | Database health 200; protected dashboard/list/audit and unauthenticated creation return 401; verification server stopped |
| Original database fingerprints | PASS; original business records unchanged |

Real-PostgreSQL tests cover supplier grouping, automatic exclusions, explicit repeats, individual/batch totals, concurrent idempotency retries, key/user scoping, partial-request rejection, over-budget drafts, exact/insufficient funds, duplicate approvals, competing approvals, approve-versus-reject, repeat rejection, current-role/session/AI denials, corrupted totals, dashboard/list/detail serialization and HTTP session/origin/CSRF/RBAC/validation boundaries.

Database fault-injection triggers in the disposable test database verify rollback when audit or reservation insertion fails. Isolated unit tests verify bounded transaction/deadlock retries and canonical request hashing. Existing Day 1–2 tests also pass. Order-placement paths return 404 for authenticated callers.

Non-blocking upstream warnings remain: Prisma 7's PostgreSQL adapter emits a `pg` concurrent-query deprecation notice during relation reads; the frontend bundle is approximately 649 kB before gzip and triggers Vite's size advisory. Neither prevented the checks. No Prisma major upgrade was performed.

## Local embedding gate — PASS

Runtime: Node 24.6.0, `@huggingface/transformers` 4.3.2, local CPU inference.

| Configuration | Verified value |
| --- | --- |
| Model | `Xenova/all-MiniLM-L6-v2` |
| Pinned model revision | `751bff37182d3f1213fa05d7196b954e230abad9` |
| Dimensions | 384 |
| Pooling / normalization | Mean / normalized |
| Weights | q8 |
| Cache | Ignored `.cache/embeddings` by default |

`npm run check:embeddings` downloaded public weights, generated finite vectors for synthetic sentences, checked dimensions/unit norms and recorded the profile/fingerprint. `npm run check:embeddings -- --offline` then reproduced the same vectors with remote models disabled. No paid embedding or chat API was used.

The older documented runtime release exposed dependency advisories, so the patched 4.3.2 release was selected and audited. Its repository-ID offline discovery failed initially; using the supported explicit pinned local directory with `local_files_only` fixed cached inference. No dependency source was patched, and offline success was verified rather than assumed.

Profile: `.cache/embeddings/preflight-profile.json`. Vector fingerprint: `c8e4261b0de45d8ee162da7cdf9f0d5ad5e0d614bd2d9a752a113792357aadc9`.

## pgvector/copied-volume gate — PASS

`npm run check:pgvector` built the preflight-only image from the exact running PostgreSQL 17 Alpine digest:

```text
postgres@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7
```

Verified PostgreSQL 17.12 and pgvector 0.8.7. The standalone script:

1. Records source business fingerprints.
2. Builds pinned pgvector into the same PostgreSQL base.
3. Uses `pg_basebackup` to obtain a consistent physical copy, not an unsafe raw copy of live PGDATA.
4. Restores that copy into a separate temporary volume/container with no host port.
5. Confirms copied business fingerprints, enables pgvector only in the copy, and verifies 384-dimensional insertion/cosine nearest-neighbor search.
6. Restarts the copied container and rechecks the extension/data and original business fingerprints.
7. Removes only the invocation's temporary container and volume.

The preflight Dockerfile is `infra/postgres/Dockerfile.pgvector`; it is not wired into application Compose automatically. The machine-local report is `.cache/pgvector/preflight.json`. The retained physical backup tar is mode 0600 and ignored; it contains sensitive database data and must not be committed/shared. Future migration planning must still back up/recheck the then-current database.

These checks fit within the two-hour feasibility time box. They establish compatibility for this runtime/base/model, not PDF parsing or retrieval quality. No knowledge tables, real application extension migration, PDF parser, document ingestion, retrieval pipeline or agent was implemented.

## Commands and handoff

Normal application startup is unchanged:

```bash
docker compose up -d --wait postgres
npm run dev
```

Reproduce verification with `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build`, `npm audit`, `npm run check:embeddings`, `npm run check:embeddings -- --offline` and `npm run check:pgvector`. Compatibility commands need model-download/Docker access as documented in README. The patched runtime installation and a clean optional-dependency reinstall were performed; the npm native-optional-package omission encountered during updates was resolved before final verification.

No OpenRouter key or live chat-model call was used. Its feasibility check remains deferred until credentials are configured before agents. The original application service was not stopped; only the separate verification server and temporary test resources were stopped/removed.

Day 3 is complete. Day 4 should implement the already specified functional dashboard and manual proposal review screens before extending RAG. No automatic Day 4, PDF ingestion, knowledge migration or agent work is authorized by this handoff.
