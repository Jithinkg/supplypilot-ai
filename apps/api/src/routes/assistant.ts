import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { assistantInputSchema, idempotencyKeySchema } from '@supplypilot/contracts';
import { requireCsrf, requireOrigin } from '../middleware/auth.js';
import { actor } from './knowledge.js';
import type { AssistantService } from '../agents/service.js';
export function assistantRoutes(service: AssistantService, webOrigin: string) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/assistant/runs', requireOrigin(webOrigin), requireCsrf, rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many assistant requests.', requestId: res.locals.requestId } }); } }), async (req, res) => {
    const result = await service.run(assistantInputSchema.parse(req.body), idempotencyKeySchema.parse(req.get('idempotency-key')), actor(req, res));
    res.status(result.status === 'RUNNING' ? 202 : 200).json(result);
  });
  router.get('/assistant/runs/:id', async (req, res) => { res.json(await service.get(z.uuid().parse(req.params.id), actor(req, res))); });
  return router;
}
