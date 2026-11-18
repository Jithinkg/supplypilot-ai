# Day 6 — Assistant and knowledge frontend integration

Current follow-up status: the user authorized replacing Nemotron with `google/gemma-4-31b-it:free`. Catalog support and local checks pass; live inference remains unverified. A later user-reported inventory failure is not yet verified repaired. Local regression checks pass; the latest live retry is blocked by provider HTTP 429. See the final section below. Earlier PASS results record their actual checkpoint and do not establish current live reliability.

Delivered on 2026-11-18 after the explicit “start day 6” instruction. Day 5 backend capabilities are now connected to the existing React application. Day 7 remains freeze/repair/demo rehearsal; no new feature phase or production deployment was started.

## Delivered UI

- Dashboard assistant: independent questions, in-page transcript, honest pending/error states, structured backend results, warnings and committed proposal links. It starts READ_ONLY. “Allow draft proposals” must be explicitly selected for each new draft request and resets after submission. No AI approval/rejection/order controls exist.
- Inventory selection scopes assistant requests. Optional positive whole quantities are validated with the shared input schema and passed to the backend; omitted quantities use backend recommendations. Frontend rendering formats integer paise as INR and does not calculate prices, totals, budget, inventory risk or reorder quantities.
- Request recovery: persist the original user/role, input and idempotency key before POST. An uncertain outcome blocks another request. Explicit recovery reuses the exact key/payload; a known RUNNING run is polled by owned GET, never replayed as a new write. Terminal failures still show committed draft links. Storage failure blocks initial submission. No automatic POST retries or automatic replacement keys are used.
- Policy/contract guidance: explicit evidence/insufficiency/unavailability, advisory wording and source buttons. Opening a source resolves its exact document/chunk/page/supporting text with current authorization before showing the excerpt. Download URLs also require server authorization, matching supplier scope and non-archived documents.
- Knowledge page: both roles can list/search policies and download permitted PDFs. Managers can select a supplier to list/search its contracts, upload supported PDFs, retry FAILED ingestion and confirm archiving. Document status lists poll while QUEUED/PROCESSING; explicit refresh remains available. Search uses the existing retrieval endpoint without a chat-model call.
- Supplier selectors use a small new manager-only authenticated endpoint, `GET /api/knowledge/suppliers`, returning only id/code/name. Its service also rechecks manager authorization; it exposes no contracts, pricing, budget or credentials. Policy/contract endpoint filters remain unchanged.
- Role/session keyed components reset sensitive transient UI when identity/permissions change. Results/excerpts remain in memory and are not persisted to browser storage. Pending recovery is user-scoped; a changed role does not display the previous role's saved question. The backend remains authoritative for recovery, document and supplier authorization.
- The existing manual dashboard, proposals and manager decisions remain independently usable. Navigation now wraps on small screens to accommodate Knowledge without horizontal page overflow.

## Validation

| Check | Actual result |
| --- | --- |
| `npm test` backend/shared portion | PASS: 51 tests |
| `npm run test:web` final frontend suite | PASS: 29 tests, including 12 new assistant/knowledge/API-boundary checks |
| `npm run test:db` | PASS: 44 isolated PostgreSQL tests, including manager-only supplier-directory access and current-role recheck |
| `npm run test:rag` | PASS: 3 real cached local-model/pgvector scenarios |
| `npm run test:e2e` | PASS: all 6 Chromium scenarios |
| `npm run smoke:agents` | PASS: exact free model, complete graph, real cited evidence, 6 validated calls and one DRAFT |
| `npm run typecheck` | PASS: strict workspace and browser test checks |
| `npm run build` | PASS: frontend and backend production builds |

The backend/shared and frontend checks were also run separately while iterating. Final browser checks ran without concurrent source edits or shared-contract rebuilds, which otherwise trigger Vite page reloads.

New frontend tests cover default READ_ONLY, explicit draft permission/user quantities, original-key/payload recovery across remount, known-run GET recovery, RUNNING-to-terminal handling, persistence failure, links after committed-write/finalization failure, escaped hostile markup, denied citation opening, staff suppression of contract findings, staff policy search/missing evidence, scoped manager upload and multipart CSRF/response validation. Existing frontend tests continue to cover procurement and authentication handling.

The new browser assistant scenario explicitly **mocks only assistant transport/model results**. It loses a response, reloads, checks identical recovery key/body, opens a real fixture draft and confirms a real manager approval through the existing services. The fixture draft is created by the authenticated test harness, so this scenario does not claim the model created it. Existing graph security/write tests and the separate live smoke establish actual graph behavior.

The other new browser scenario uses **real PDF extraction, cached 384-dimensional local embeddings and pgvector retrieval**: manager policy upload → READY → cited search → authorized source opening; manager supplier-contract upload; staff policy visibility and denial of contract download/supplier directory; then policy archive and denial of a previously returned citation. Mobile screenshots and width checks accompany the existing manual procurement scenarios. Screenshots are ignored local artifacts at `.cache/day6-knowledge.png`, `.cache/day6-knowledge-mobile.png` and the existing dashboard/proposal screenshot paths.

The separate live smoke used exactly `nvidia/nemotron-3.5-lightning:free` with the existing zero-price provider constraints. It reported COMPLETED, EVIDENCE_FOUND, evidence presented, six tool calls, one proposal and no error. No paid/different model, approval or order was used. It ran in its own disposable database, separately from mocked tests.

Initial browser runs exposed a product locator that assumed first-page inventory membership, navigation overflow, a navigation assertion made before the detail page loaded, and an exact implicit-label selector that did not resolve the supplier select reliably. Those were corrected; the final complete suite passed. Concurrent shared-contract builds also reloaded the development page during earlier attempts; no such builds ran during the passing browser run. A jsdom file-input validation limitation is handled by submitting the unit-test form directly; the real Chromium test exercises normal file selection and submission.

## Data and runtime preservation

No schema change, application migration, business seed, PostgreSQL image rollout, volume reset or application-data write was performed for Day 6 implementation/verification. All test migrations, fixture ingestion, proposals and manager decisions ran only in the harness's generated `supplypilot_test_*` databases; each harness confirmed removal afterward. The real application's synthetic corpus remains the Day 5 corpus. No real supplier contract was uploaded to the application database.

No dependency or model configuration changed. Existing server RBAC/CSRF checks, business pricing/grouping, approval reservations, idempotency and agent tool allowlists remain in force. The operator knowledge-ingestion fallback remains available.

## Try it locally

Start or restart `npm run dev` if needed, then open **http://localhost:5173**. This must match `WEB_ORIGIN`; `127.0.0.1` is a different origin and can be rejected at login. Do not reseed or migrate for this frontend change.

1. Sign in with an existing staff or manager account. Ask “What is the available procurement budget?” in the dashboard assistant; inspect the backend-calculated answer.
2. Ask “What guidance covers supplier price and delivery lead time?” and open the returned source/page. Alternatively, use Knowledge search to retrieve policy passages without a chat call.
3. Search inventory, select products and optionally specify quantities in the assistant. Explicitly enable Allow draft proposals and request drafts. Follow returned proposal links; a manager reviews them through the existing confirmable decision flow. Approval reserves funds only.
4. As manager, open Knowledge, enter a title and upload a supported English text PDF. Watch its status, search it after READY, and inspect a source. Select a specific supplier before uploading/searching contracts. Archiving requires confirmation.
5. If a draft response is interrupted, keep the tab/session storage and use Recover saved request. Do not start a replacement request or clear storage while the outcome is uncertain. Inspect Proposals if browser recovery storage was lost.

## Limits

- Transcript is local to the mounted dashboard; previous turns are not model conversation context and are cleared on navigation/reload. Outstanding requests survive same-tab reload through sessionStorage, which does not survive closing the tab or clearing storage.
- Progress is a pending indicator and owned-run polling, not streamed internal agent stages. Free-provider latency/rate limits can still produce safe failures; no paid fallback exists.
- Citation access is checked when opened and again for downloads. Already displayed page text is an in-memory snapshot; archive/scope navigation/new search clears the local search result. Server recovery revalidates stored evidence.
- Week 1 remains English text PDFs up to 10 MiB/50 pages; no OCR, document replacement/version editing, reranking or advanced hybrid search.
- Existing nonblocking pg concurrent-query deprecation and Vite bundle-size warnings remain. No dependency upgrade or production rollout was included.

## Post-acceptance repair — ordinary question routing

A user-reported dashboard question, “which products are at risk”, exposed a gap in the initial live evaluation: the earlier smoke exercised a detailed explicit draft request, while the browser assistant transport was mocked. A read-only live intent evaluation reproduced INVENTORY_QUERY being misclassified as CLARIFICATION, and the available-budget question being misclassified as POLICY_QUERY. The original classifier prompt did not define inventory/procurement queries explicitly.

The routing prompt now defines every supported intent, with short ordinary-question examples and clear distinctions between factual reads, document guidance, recommendations and explicit draft requests. Portfolio-wide inventory questions do not require product IDs. Forbidden decisions/orders retain priority; classification grants no capabilities.

Full live testing then exposed a separate inventory-call truncation: the provider returned no valid parsed call at the 1024-token output ceiling while handling the portfolio catalog. Inventory tool descriptions now explicitly permit `{}` for the server-owned scope, and the specialist prompt requests the required tool with minimal valid arguments. A bounded 4096-token allowance for `getInventoryRisks`/`getStockLevels` accommodates calls that still enumerate up to fifty UUIDs. The repaired live inventory call used 1789 output tokens and completed. Other calls retain 1024; the exact free model, zero-price provider limits, no-retry policy, twelve-call ceiling, 60-second deadline, schemas and server-owned permissions remain unchanged.

Added `npm run smoke:intents`: five credential-dependent live classification cases (portfolio risk, stock, budget, explicit draft, forbidden approval), using only the exact free model, with no database access or business writes. All five passed after the prompt repair. `npm run smoke:agents` now additionally executes the user's exact portfolio-risk question and the ordinary available-budget question through the real graph before its existing draft scenario. It asserts the correct intent/tool, completed backend results, zero draft creation for reads, and unchanged proposal counts/reserved budget across those reads. Both read cases and the six-call cited draft workflow passed in a disposable database, which was removed afterward.

`npm test` passed again (51 backend/shared + 29 frontend), as did strict type checks and the production build. No frontend behavior, business calculations, application records, approval rules, model or dependencies were changed for this repair. The six browser scenarios above were not rerun for this backend prompt/output-limit change; their separate mocked/live coverage remains explicitly distinguished.


## Follow-up: repeated missing inventory tool call — live verification pending

The user then reported “any products at risk” failing with MISSING_TOOL_CALL. A read-only inspection of sanitized application run metadata confirmed that the failure happened in Inventory Agent with INVENTORY_QUERY, approximately 23.5 seconds elapsed and 4180 total output tokens. The previous change was loaded; increasing the output limit did not make this reliable. No prompt, answer, document excerpt, contract finding or credential was read or printed by the diagnostic script.

Further disposable-database live attempts produced an invalid tool call with thousands of argument characters even after removing the full catalog from the handoff. Provider metadata reported one invalid call, 6706 argument characters, only 76 reasoning tokens, and 4096 output tokens. This is malformed argument generation, not evidence that stock data is unavailable. Earlier successful wording-specific smoke runs were insufficient to establish reliability; do not describe the repeated issue as resolved.

The current repair narrows stock/risk tool schemas to a strict empty object and lets them read the immutable server-owned scope. Optional request `items` still scopes actual service results; the model cannot supply product filters to broaden/change that scope. Sales-history reads retain validated product IDs because that operation requires identity selection. Risk/stock handoffs carry scope/count rather than the full catalog; the provider sees only the graph-selected tool from the assigned registry for a forced call. These are real validated model calls followed by real backend reads, not synthesized tool calls or a mocked runtime fallback. The original 1024-token cap is restored because these calls no longer need to generate catalog IDs. Exact-free-model/provider limits, deadline and twelve-call ceiling remain unchanged.

Sanitized diagnostic metadata now includes finish reason, invalid-call count, argument lengths and reasoning-token count without content. The operator script `apps/api/scripts/inspect-agent-diagnostics.ts` reads only whitelisted recent run/error/audit metadata. Provider codes containing digits (for example MODEL_HTTP_429) now survive owned-run recovery instead of becoming the generic RUN_FAILED. Read-only failures no longer misleadingly lead with a draft-creation message. The frontend explains malformed-operation failures and provider rate limits, retaining the exact code under Technical details, without automatically retrying.

`smoke:agents` now includes three ordinary risk phrasings, including the exact newly reported wording as MANAGER, plus the available-budget read before the draft scenario. `smoke:intents` includes the short risk wording too. These expanded live checks have **not passed for the current repair**: the latest two attempts were rejected at classification by HTTP 429, before the revised inventory tool could execute. No model was substituted, no provider price limits were relaxed and no failure was presented as success. Do not keep issuing live requests while rate-limited; rerun the credential-dependent checks when availability returns. Do not infer the provider's reset time from this error.

Local checks after the current repair:

- `npm test`: PASS, 53 backend/shared + 30 frontend tests.
- `npm run test:db`: PASS, 46 tests in a disposable database, removed afterward.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.

New tests verify provider-facing restriction to the selected assigned tool, rejection of unassigned forced tools before invocation, server-selected inventory scope, rejection of model-generated filters, unchanged proposals/reserved budget for inventory reads, preservation of sanitized HTTP 429 on recovery, and a clear rate-limit UI with no automatic replay. These mocked/real-database checks do not establish that the live free model is currently working. The earlier browser/RAG results remain historical; no browser or retrieval rerun was needed for the final scoped tool/error-message repair. The application database was read only for diagnosis, never migrated, reset, reseeded or written by this follow-up.


## Explicitly authorized free-model replacement — 2026-11-18

The user requested switching models, then explicitly asked to find a free tool-calling model. This overrides the prior Nemotron-only selection while retaining the free-only/no-automatic-fallback requirement.

Selected and pinned **`google/gemma-4-31b-it:free` (Google Gemma 4 31B free)** in `FREE_MODEL`, Zod configuration, `.env.example` and the ignored local `.env`. Only the model line was changed in `.env`; no credentials were displayed or replaced. Application and smoke integrations import the same pinned model. The paid variant, `openrouter/auto`, the previous model and other selections fail configuration validation rather than triggering implicit routing. Prompt/completion/request provider prices remain capped at zero; no model fallback list was added. Calculator smoke calls now use those same zero-price provider restrictions too.

The live public OpenRouter catalog returned this exact ID with prompt/completion prices `0`, a 262144-token context and supported parameters including both `tools` and `tool_choice`. This establishes advertised eligibility, **not** successful tool calling in this application. The [OpenRouter model page](https://openrouter.ai/google/gemma-4-31b-it:free) and [Google's function-calling guide](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4) also document tool support. No comparative reliability claim is made without live testing.

One read-only `GET /api/v1/key` using the existing server key returned only the whitelisted free-model counters: **used 51, limit 50, remaining 0**. No key, account label, balance, workspace metadata or raw account response was logged. Unlike the earlier monthly screenshot, this is direct evidence that the daily free allowance is exhausted. [OpenRouter's limits documentation](https://openrouter.ai/docs/api-reference/limits) describes the shared daily counter as current UTC-day free-model requests; changing model or key does not replenish that counter. The next UTC day begins at 05:30 IST on 2026-11-19; that does not guarantee model/provider availability then.

**No inference requests were made for this replacement.** The selected model's live tool use and the repeated inventory repair remain unverified. No mock result, public catalog result or local test is described as a live success. Earlier successful Nemotron runs remain historical and cannot validate Gemma.

Added quota preflight for credential-dependent smoke scripts: unknown/unavailable counters fail closed, and insufficient remaining allowance stops before inference. The agent harness checks before creating a disposable database. Classification checks reserve up to two attempts per case; calculator smoke requires two remaining calls; the full graph reserves at least twenty requests to avoid starting a multi-scenario run with almost no allowance. Provider availability and per-minute limits can still fail even when daily quota remains. Preflight output contains fixed safe messages, never raw provider errors or credentials. These guards are not automatic model retries.

Local checks after model replacement: `npm test` PASS (57 backend/shared + 30 frontend), strict type checks PASS, production build PASS. New tests reject paid/alternate model configuration, assert zero-price provider preferences, and exercise exhausted/insufficient/missing quota responses. These use mocks and make no live model calls. No database migration, reseed, volume change, application business write, dependency replacement or embedding-profile change was performed.

Limited next verification, only after the quota metadata reports remaining capacity:

1. Run `npm exec -w @supplypilot/api -- tsx scripts/check-openrouter-quota.ts` (metadata only).
2. Run `npm run smoke:openrouter` once (two model requests) to verify the new model's tool-call/result round trip. Stop if it fails; inspect sanitized diagnostics rather than repeatedly retrying.
3. If that passes and the quota preflight permits it, run `npm run smoke:agents` once in its disposable database. This includes both reported inventory wordings, staff/manager coverage, a third ordinary risk question, budget reads and the explicit cited draft flow. No application database writes or supplier orders occur.
4. Only after successful live checks describe the replacement/repair as verified. Manual procurement and direct Knowledge search remain independent throughout.
