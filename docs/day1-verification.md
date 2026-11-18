# Day 1 — Implementation and Verification

Day 1 foundation implemented on 2026-11-15. The approved business architecture remains in [architecture.md](architecture.md); setup instructions are in [README.md](../README.md).

## Implemented

- npm monorepo: `apps/web`, `apps/api`, `packages/contracts`; shared strict TypeScript configuration and lockfile.
- React/Vite, Tailwind CSS v4, shadcn/ui configuration and local Button/Input components, React Router, TanStack Query, login, application shell and dashboard placeholder.
- Same-origin Vite `/api` proxy; typed/Zod-validated API client; visible connection/retry states.
- Express with CORS, Helmet, bounded JSON parsing, Zod request validation, safe centralized errors, request IDs and login rate limiting.
- Argon2id passwords; random eight-hour opaque sessions hashed in PostgreSQL; current-role resolution; role guard; origin/CSRF validation; logout/revocation and authentication audit records.
- Docker Compose PostgreSQL 17; Prisma 7 initial schema and migration for all approved models, with integer-paise and value constraints.
- Environment-driven seed for STAFF/MANAGER identities only. No Day 2 business-data seed.
- Installed LangGraph JS, LangChain JS and `@langchain/openrouter`; standalone calculator tool-calling smoke script. No Inventory/Procurement Agent or graph implementation.
- README, environment example and local verification scripts.

## Commands executed

Commands below were run from the repository root unless noted. Dependency repair steps were development-time fixes; normal setup uses `npm ci`.

| Command or check | Final outcome |
| --- | --- |
| `node --version`, `npm --version`, `docker --version`, `docker info` | Node 24.6.0, npm 11.5.1 and Docker 29.1.3 available; daemon access verified |
| `npm view ...` / `npm ls --depth=0` | Resolved and inspected compatible package versions |
| `npm install` | Dependencies installed; initial optional-native-package issue repaired |
| `npm install -D vitest@^5.1.0` | Patched initial test-tool audit findings |
| `npm install -D vite@^8.3.8 -w @supplypilot/web` | Aligned Vite with test/plugin dependencies |
| `npm install --include=optional` (including a force retry) | Incomplete npm optional-dependency state required a clean regeneration |
| Clean dependency regeneration | Previous install/lock state moved to `/tmp` backups; final lockfile includes native optional packages |
| `npm ci` | Fresh installation from final lockfile passed; 491 packages installed; zero audit findings |
| `npm run db:generate` | Prisma Client 7.10.1 generated successfully |
| `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output prisma/migrations/20261115000100_initial/migration.sql` (in `apps/api`) | Initial migration generated; explicit SQL value constraints added |
| `docker compose up -d --wait postgres` | Database container started and became healthy |
| `npm run db:migrate` | Initial migration applied successfully |
| `npm run db:seed` | STAFF and MANAGER seeded from ignored local environment; no credentials printed |
| `npm run db:check` | Connectivity and both active role accounts verified |
| `npm run typecheck` | All three workspaces passed strict TypeScript checks |
| `npm test` | 15 tests passed across 3 files |
| `npm run test:db` | 5 tests passed against real PostgreSQL |
| `npm run build` | Contracts, backend and frontend builds passed |
| `npm audit` | Zero known vulnerabilities in the final installation |
| `npm run dev` | Vite and Express started; contracts watch reported zero errors |
| Local HTTP smoke requests | `/`, `/login`, transformed React entry, direct/proxied API health, both-role login/session/logout/revocation passed |
| `npm run start -w @supplypilot/api` | Compiled backend started and returned healthy database status |
| `npm run smoke:openrouter` | **SKIPPED**: no configured API key; no inference request sent |
| `docker compose ps` | PostgreSQL running and healthy at handoff |

The initial install failures and Vite type conflict were resolved before the final clean-install verification. Tests/builds were rerun after the final `npm ci`; the results above describe that installation. Local socket, registry and Docker checks required execution outside the restricted sandbox.

## Test coverage

Isolated tests cover strict login/paise/calculator schemas, denied privilege fields, invalid/oversized JSON, safe health/error handling, required authentication, cookie attributes, origin/CSRF checks, login rate limits and manager-role middleware. Database tests cover both seeded roles, real password verification, token hashing, session expiry/revocation, logout audit records and PostgreSQL stock/budget constraints.

HTTP smoke verification used the real running applications and Vite proxy, retaining credentials/cookies in memory without logging them. Browser automation and visual review were not performed; HTTP startup/compilation verification is not a claim of browser end-to-end testing.

## Remaining limitations and configuration

- **Live model feasibility remains unverified.** Configure `OPENROUTER_API_KEY` and rerun `npm run smoke:openrouter`. The exact allowed model is `nvidia/nemotron-3.5-lightning:free`; paid fallback is prohibited. If the model, zero pricing or tool support cannot be verified, the script fails and agent implementation must remain blocked pending an explicit issue report.
- The live test includes catalog verification and a Zod-validated calculator tool/result round trip. No live API success is claimed from its skipped exit.
- Vite reports a non-blocking bundle-size warning for the initial frontend bundle (approximately 639 kB before gzip). The production build succeeds; route/vendor splitting can be addressed with later frontend implementation.
- Development/compiled verification servers were stopped after checks. PostgreSQL remains running with persistent local data.
- An ignored, mode-0600 `.env` contains generated local-only database and seed passwords. Review it for credentials; never commit or paste it into logs. `.env.example` contains placeholders only.
- Configure matching `DATABASE_URL`/Compose settings, distinct seed emails/passwords, `WEB_ORIGIN`, API port/proxy target, and optional OpenRouter key as documented in README.
- No business-data seed, risk services, full dashboard, proposal/approval APIs, specialized agents, supplier orders or Day 2–7 workflows are implemented.

## Created source/configuration files

```text
.env.example
.gitignore
README.md
apps/api/package.json
apps/api/prisma.config.ts
apps/api/prisma/migrations/20261115000100_initial/migration.sql
apps/api/prisma/migrations/migration_lock.toml
apps/api/prisma/schema.prisma
apps/api/prisma/seed.ts
apps/api/scripts/check-database.ts
apps/api/scripts/smoke-openrouter.ts
apps/api/src/app.test.ts
apps/api/src/app.ts
apps/api/src/auth.db.test.ts
apps/api/src/config/env.ts
apps/api/src/config/load-env.ts
apps/api/src/db/client.ts
apps/api/src/index.ts
apps/api/src/middleware/auth.ts
apps/api/src/middleware/errors.ts
apps/api/src/services/auth.ts
apps/api/src/services/calculator.test.ts
apps/api/src/services/calculator.ts
apps/api/tsconfig.json
apps/api/vitest.db.config.ts
apps/web/components.json
apps/web/index.html
apps/web/package.json
apps/web/src/app/auth.ts
apps/web/src/app/shell.tsx
apps/web/src/components/ui/button.tsx
apps/web/src/components/ui/input.tsx
apps/web/src/index.css
apps/web/src/lib/api.ts
apps/web/src/lib/utils.ts
apps/web/src/main.tsx
apps/web/src/pages/dashboard.tsx
apps/web/src/pages/login.tsx
apps/web/tsconfig.json
apps/web/vite.config.ts
compose.yaml
docs/day1-verification.md
package-lock.json
package.json
packages/contracts/package.json
packages/contracts/src/index.test.ts
packages/contracts/src/index.ts
packages/contracts/tsconfig.json
tsconfig.base.json
vitest.config.ts
```
