import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { loginSchema } from '@supplypilot/contracts';
import type { AuthService } from './services/auth.js';
import { errorHandler, HttpError } from './middleware/errors.js';
import { getAuth, requireAuth, requireCsrf, requireOrigin, SESSION_COOKIE } from './middleware/auth.js';
import { readRoutes } from './routes/reads.js';
import type { ReadService } from './services/reads.js';
import type { ProposalService } from './services/proposals.js';
import type { KnowledgeService } from './knowledge/service.js';
import type { AssistantService } from './agents/service.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { assistantRoutes } from './routes/assistant.js';
import { proposalRoutes } from './routes/proposals.js';

export interface AppDependencies {
  auth: AuthService;
  checkDatabase: () => Promise<void>;
  webOrigin: string;
  production: boolean;
  reads?: ReadService;
  proposals?: ProposalService;
  knowledge?: KnowledgeService;
  assistant?: AssistantService;
}
export function createApp(deps: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('x-request-id', res.locals.requestId as string); next(); });
  app.use(helmet());
  app.use(cors({ origin: deps.webOrigin, credentials: true }));
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(cookieParser());
  app.use('/api/auth', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const authenticated = requireAuth(deps.auth);
  const origin = requireOrigin(deps.webOrigin);
  const cookieOptions = { httpOnly: true, secure: deps.production, sameSite: 'lax' as const, path: '/api' };

  app.get('/api/health', async (_req, res) => {
    try { await deps.checkDatabase(); res.json({ status: 'ok', database: 'up' }); }
    catch { res.status(503).json({ status: 'degraded', database: 'down' }); }
  });
  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => { res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts.', requestId: res.locals.requestId } }); },
  }), origin, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const session = await deps.auth.login(email, password, res.locals.requestId as string);
    res.cookie(SESSION_COOKIE, session.token, { ...cookieOptions, expires: session.expiresAt });
    res.json({ user: session.user, csrfToken: session.csrfToken });
  });
  app.get('/api/auth/me', authenticated, (req, res) => {
    const session = getAuth(req);
    res.json({ user: session.user, csrfToken: session.csrfToken });
  });
  app.post('/api/auth/logout', authenticated, origin, requireCsrf, async (req, res) => {
    await deps.auth.logout(getAuth(req), res.locals.requestId as string);
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.status(204).end();
  });
  if (deps.reads || deps.proposals || deps.knowledge || deps.assistant) {
    const protectedApi = express.Router();
    if (deps.reads) protectedApi.use(readRoutes(deps.reads));
    if (deps.proposals) protectedApi.use(proposalRoutes(deps.proposals, deps.webOrigin));
    if (deps.knowledge) protectedApi.use(knowledgeRoutes(deps.knowledge, deps.webOrigin));
    if (deps.assistant) protectedApi.use(assistantRoutes(deps.assistant, deps.webOrigin));
    app.use('/api', authenticated, protectedApi);
  }
  app.use(() => { throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found.'); });
  app.use(errorHandler);
  return app;
}
