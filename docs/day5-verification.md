# Day 5 — Backend RAG and LangGraph orchestration

This records the Day 5 checkpoint. The subsequently authorized frontend integration is documented in [Day 6 verification](day6-verification.md).

Verified on 2026-11-18. Day 5 backend implementation is complete. Day 6 dashboard assistant, citation rendering and knowledge upload/status browser UI have not started. Manual Day 4 procurement remains functional independently of AI/RAG.

## Delivered architecture

A LangGraph JS parent StateGraph validates function-call classification, applies capability gates, and routes Inventory, Procurement and Policy Knowledge stages through Zod-validated checkpoint state. The specialists never call one another directly. State includes run/request IDs, captured time/input, intent, inventory/product/supplier handoffs, authorized evidence, progress/deadline and structured output. Authenticated identity, role, session, deadline and registries remain server-owned.

- Inventory tools: `getStockLevels`, `getSalesHistory`, `getInventoryRisks`.
- Procurement tools: `getSupplierQuotes`, `getAvailableBudget`; `createPurchaseProposal` exists only in the explicit draft phase.
- Policy Knowledge tools: `searchProcurementPolicies`, manager-only supplier-scoped `searchSupplierContracts`. No upload, approval, rejection or ordering tools.

One bounded function-calling turn per specialist avoids redundant final generations. Authorized manager recommendation reviews can make deterministic follow-up calls to the Knowledge specialist's assigned contract tool, within the same budget. The parent reads the retrieved passages through an isolated structured evidence-review formatter. It can select only supporting-clause, potential-conflict or insufficient-evidence labels and valid indices into the retrieved citations; no free-form compliance verdict or business action is accepted. The parent returns structured backend findings and server-built citations; model text cannot invent authoritative totals, citations or compliance verdicts.

READ_ONLY is the default. Writes require CREATE_DRAFT plus validated DRAFT_REQUEST intent, unchanged authenticated role/session and an owned active unexpired run checked inside the transaction. Explicit selected-product batches cannot silently drop selected items. Supplied user quantities take precedence; other model-invented quantities are rejected. The existing deterministic service still validates products, quantities, supplier ranking, prices, paise bounds and exclusions. It creates one atomic supplier-grouped DRAFT batch linked to the run. Over-budget drafts remain allowed; no funds are reserved until manager approval. AI cannot decide or order.

Run idempotency is user-scoped: same key/input recovers the original run; changed input conflicts; a pending run is not executed again. A hard 60-second signal/race and twelve-call ceiling bound execution. Expired/interrupted runs recover committed proposal links without replaying writes. Final publication failure after commit does not hide drafts. Audit metadata contains IDs, safe codes/stages, call counts, duration and usage when provided, without prompts or contract text. Chat uses exactly `nvidia/nemotron-3.5-lightning:free` with zero prompt/completion/request price provider limits and no paid/model fallback.

## Knowledge pipeline and privacy

Manager upload authenticates and checks role, origin and CSRF before multipart parsing. One PDF is limited to 10 MiB/50 pages; extension, MIME, signature and parser recognition are checked. PDF.js extracts selectable text with original page numbers. Blank pages are skipped without renumbering; encrypted/malformed/entirely image-only PDFs fail safely. Supported Week 1 content is English text PDFs; OCR, layout reconstruction, reranking and hybrid search remain deferred.

A database-scoped session advisory lease ensures only one API/operator ingestion worker runs at a time. Recovery marks PROCESSING records interrupted only while that lease is owned. Extraction and embedding occur outside database transactions; complete chunks/vectors/READY state publish atomically. Retry and explicit profile re-embedding are duplicate-safe, and archive prevents retrieval/citation access. Filename strings are metadata, not filesystem paths; original PDFs are stored in PostgreSQL.

Local embeddings use cached `Xenova/all-MiniLM-L6-v2`, revision `751bff37182d3f1213fa05d7196b954e230abad9`, CPU q8, mean pooling and normalized 384 dimensions. Chunks stay within one page, at most 180 model tokens with approximately 30-token overlap and retained page offsets. Oversized embedding inputs are rejected rather than silently truncated. Profiles are immutable and vectors are checked for dimensions, finiteness and normalization. Database triggers also enforce profile dimensions and immutability.

Exact cosine retrieval materializes authorized READY/type/supplier/profile rows before ranking and returns up to five citations above the configured threshold. This also prevents incompatible-dimensional vectors from reaching the comparison operator. Results are EVIDENCE_FOUND, INSUFFICIENT_EVIDENCE or UNAVAILABLE, always advisory. Citations identify document/chunk/page/supporting text and are built from actual authorized rows. Source/citation opening and run recovery recheck role/supplier/archive status. Changed permissions or archived/replaced evidence suppress previously stored findings.

Staff can retrieve policies; contracts require a manager and explicit relevant supplier scope. Contract content/findings do not enter shared proposal reasons, procurement draft handoffs, general audit metadata or staff-visible results. AI draft reasons are fixed, nonconfidential server text. `RAG_ENABLED=false` disables search and citation replay; manual procurement remains usable.

## Migration and preservation

1. Recorded a private business fingerprint baseline before changes.
2. Re-ran cached local embeddings and pgvector against a consistent physical volume copy.
3. Applied the proposed SQL on the copy and verified business records after restart.
4. Created a private custom-format backup at `.cache/backups/before-day5-1794947608034.dump` (0600). Backups/copies are ignored local artifacts; keep them private.
5. Built pgvector 0.8.7 on the same pinned PostgreSQL 17.12 Alpine digest and recreated only the PostgreSQL container, retaining its existing volume, settings and port.
6. Applied `20261118000100_knowledge` forward-only. It enables vector, adds KnowledgeDocument/DocumentChunk/EmbeddingProfile/ChunkEmbedding and nullable run metadata. The original migration and business tables/data remain intact.
7. A read-only Prisma schema comparison returned an empty migration after explicitly matching the new FK update policies. No applied migration was rewritten.
8. The final fingerprint check passed: original users, products, sales, suppliers, quotes, budgets, proposals, lines, reservations, business audit and idempotency records are unchanged.

No application business seed, database reset or volume deletion occurred. Test harnesses migrate/seed only their randomly named disposable databases, which are removed afterward. Knowledge ingestion creates knowledge/auth audit records, not business seed records.

One clearly labeled **SYNTHETIC DEMO procurement policies** document is READY in the application database: ten pages, produced and indexed through the real pipeline. No real supplier contracts were invented or uploaded there. The operator synthetic generator is deterministic and identical-byte/type/supplier uploads deduplicate. This delivers the approved pre-ingested synthetic-corpus path while the browser upload UI remains Day 6 work. The authenticated backend multipart upload endpoint is implemented and tested.

## API handoff

All endpoints require existing server-side session authentication. Mutating routes and search/citation POSTs also require configured Origin and X-CSRF-Token. Responses use no-store caching.

| Endpoint | Behavior |
| --- | --- |
| `POST /api/knowledge/documents` | Manager multipart upload: file, title, type and supplierId for contracts; 202 metadata/status |
| `GET /api/knowledge/documents` | Authorized paginated listing; default policy type; contract type requires supplierId |
| `GET /api/knowledge/documents/:id` | Authorized metadata/status; contract access requires matching supplierId query parameter |
| `GET /api/knowledge/documents/:id/file` | Authorized non-archived PDF attachment; same contract scope requirement |
| `POST /api/knowledge/documents/:id/retry` | Manager FAILED-to-QUEUED transition, empty JSON body |
| `POST /api/knowledge/documents/:id/archive` | Manager archive, empty JSON body |
| `POST /api/knowledge/search` | Validated query/type/supplierId; advisory outcome, authorized type/supplier scope and server citations |
| `POST /api/knowledge/citations/resolve` | Revalidate documentId/chunkId/pageNumber/supportingText; contracts require matching supplierId query parameter |
| `POST /api/assistant/runs` | Execute one bounded owned request; requires Idempotency-Key; 202 if an existing run is still processing, otherwise 200 |
| `GET /api/assistant/runs/:id` | Recover only the owner's run/result and committed proposal links, with current authorization |

Assistant request:

```json
{
  "message": "What is the available procurement budget?",
  "mode": "READ_ONLY"
}
```

Optional `items` contains productId and optional positive integer quantity; optional supplierId scopes a contract question. CREATE_DRAFT must be explicitly selected for writes. Knowledge results include authorized type/supplier scope so the client can open a cited contract with the matching supplierId. Combined reviews follow all backend-selected supplier scopes; an unrelated supplied scope cannot redirect them.

Run responses contain runId/status/intent, a grounded answer, structured tool data, advisory knowledge/citations, warnings, createdProposalIds, toolCalls and sanitized errorCode. Financial fields remain integer paise. Existing manager-only decision endpoints and their atomic budget rules are unchanged.

## Tests and commands

| Check | Result |
| --- | --- |
| `npm install --include=optional` | PASS; PDF.js patched release 6.2.108 and bounded multipart tooling installed; existing stack retained |
| `npm run smoke:openrouter` | PASS; exact free catalog/tool call/calculator result round trip |
| `npm run check:embeddings -- --offline` | PASS; original pinned cached vectors reproduced |
| `npm run check:pgvector -- --migration` | PASS; physical-copy compatibility, additive migration, cosine round trip, restart and preservation |
| `npm run db:generate` | PASS; Prisma 7 client regenerated |
| `npm run db:migrate` | PASS; additive application migration, after backup/copy verification |
| Prisma migrate diff (read-only) | PASS; empty difference |
| `npm run typecheck` | PASS; strict workspace and browser-test/config checks |
| `npm run build` | PASS; API and frontend production builds |
| `npm test` | PASS; 51 backend/shared and 17 frontend tests |
| `npm run test:db` | PASS; 43 PostgreSQL tests, including all existing 28 and Day 5 security/recovery tests |
| `npm run test:rag` | PASS; three real local-model/pgvector evaluation scenarios |
| `npm run test:e2e` | PASS; three existing manual procurement scenarios plus private-cache serving protection |
| `npm run smoke:agents` | PASS; live classification → Inventory → Procurement planning → Policy Knowledge with real retrieval → source-bound advisory review → one AI DRAFT; six validated tool calls, isolated database only |
| `npm run knowledge:ingest -- --synthetic` | PASS; real ten-page synthetic policy READY in the application database |
| Business fingerprint verification | PASS after migration and knowledge ingestion |
| `npm audit --omit=dev` | PASS; zero production dependency findings |

The retrieval threshold was fixed at 0.45 before labeled evaluation. A separate calibration sanity pair scored approximately 0.8000 for related procurement text and -0.0080 for unrelated Antarctic text. On ten held-out question/page pairs, the expected page appeared in the top five **10/10** times; all **5/5** unrelated questions abstained; **12** returned citations were validated against source rows. The ignored local `.cache/rag-evaluation.json` records these metrics/profile. This small synthetic evaluation is an MVP feasibility check, not a production relevance guarantee.

The live smoke verifies retrieved text reaches the formatter and accepts either source-bound advisory findings or an explicit evidence-based abstention; it rejects unavailable/invalid reviews. Regular model/graph tests inject deterministic responses; PostgreSQL privacy/profile tests use injected three-dimensional embeddings to isolate permissions. The separate RAG evaluation and live graph smoke use real cached 384-dimensional local embeddings and pgvector. Live chat uses the configured exact free model. These results are intentionally distinguished.

Coverage includes file validation, blank-page numbering, malformed/encrypted/image-only/oversized PDFs, bounded chunks/offsets, duplicate uploads, retry/interruption, global worker exclusion, atomic publication, profile/dimension isolation and explicit re-embedding. Agent checks cover whole-batch tool validation, cross-agent/approval/order denial, role spoofing, READ_ONLY mode, unchanged-role checks, supplier isolation, citations, archives, owner-only recovery, same-key concurrent requests, and recovery when final publication fails after drafts commit. Prompt-injection text cannot escape assigned tool registries or populate shared draft/audit fields.

Initial live multi-step checks did not complete. Redundant follow-up generations were removed, preserving the fixed deadline/call limit, and subsequent full runs passed, including the final zero-price provider configuration. The first browser attempt was interrupted by development-watch restarts during edits; the harness now runs a stable API process and the manual scenarios passed. Vite additionally denies runtime-cache/backup paths while retaining its default sensitive-file protections. An initial operator attempt ended before a confirmed READY result; bounded polling and global worker leasing now coordinate API/operator work, and the synthetic document is READY. No failure was treated as a live success or triggered a paid fallback.

## Local operation and remaining work

Restart the development process to load the new backend:

```bash
docker compose up -d --wait postgres
npm run dev
```

For an already updated checkout, no reseed is needed. A fresh checkout follows README setup; migrations require the compatible image to be running. Existing `.env` secrets/credentials were not changed.

Configuration defaults are `RAG_ENABLED=true`, `ASSISTANT_ENABLED=true`, `RAG_MIN_SIMILARITY=0.45`, with the existing exact OPENROUTER_MODEL/key and local embedding settings. Missing/unavailable chat credentials fail closed without blocking manual procurement. Set RAG_ENABLED or ASSISTANT_ENABLED to false for the documented fallback. Existing health/manual API startup remains available even if knowledge-worker initialization/recovery cannot reach the database; restart after repairing connectivity/migrations.

Use `npm run knowledge:ingest -- --synthetic` for the built-in policy or an absolute PDF path with type/title/supplier arguments as shown in README. The command authenticates the configured manager; it does not impersonate users or reset credentials. After a verified embedding-profile change and API restart, use explicit `--reembed DOCUMENT_UUID` with a matching supplier UUID for contracts. Only that knowledge index is rebuilt. Browser upload/status/retry/archive and chat/citation rendering remain Day 6 work. No Day 6 implementation was started automatically.

Known limitations:

- Free-provider availability/latency/rate limits still apply. Bounded failures return safe diagnostics/recoverable draft links; no paid fallback.
- The development/test toolchain has one unpatched [picomatch ReDoS advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), reported through five dependency findings. Its glob patterns here are repository-controlled, not procurement/PDF input. No unsupported Vite/Vitest downgrade was applied. Production dependency audit is clean.
- [PDF.js's reported scripting issue](https://github.com/advisories/GHSA-hq66-cqwq-w95j) was addressed by selecting patched 6.2.108; extraction uses the parser, not the interactive viewer.
- Existing pg concurrent-query deprecation and frontend chunk-size warnings remain nonblocking. The live demo remains local/synthetic; no production rollout, OCR, advanced retrieval or real supplier orders.


## Main implementation files

- `apps/api/src/agents/`: model/tool dispatch, parent StateGraph, structured evidence review, persistent owned-run service.
- `apps/api/src/knowledge/`: authorization, local embeddings/profile validation, PDF extraction/chunking, ingestion/retrieval/citations and synthetic fixtures.
- `apps/api/src/routes/assistant.ts` and `knowledge.ts`; shared Zod types in `packages/contracts/src/knowledge.ts`.
- Additive Prisma schema/migration; compatible Compose build; guarded AI creation extension in the existing procurement service; environment/startup wiring.
- Operator/backup/live-smoke scripts, isolated test harness modes, real RAG evaluation config/tests, stable browser-test server configuration and updated documentation. The Day 4 frontend screens were not expanded; Vite now denies private runtime-cache/backup paths.
