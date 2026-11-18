import { Router } from 'express';
import { approveProposalSchema, auditQuerySchema, createProposalSchema, idempotencyKeySchema, proposalIdSchema, proposalQuerySchema, rejectProposalSchema } from '@supplypilot/contracts';
import { getAuth, requireCsrf, requireManager, requireOrigin } from '../middleware/auth.js';
import type { ProposalService, MutationContext } from '../services/proposals.js';
import type { Request, Response } from 'express';

function context(req: Request, res: Response): MutationContext {
  const session = getAuth(req);
  return { userId: session.user.id, sessionId: session.sessionId, requestId: res.locals.requestId as string, actorKind: 'HUMAN' };
}
export function proposalRoutes(service: ProposalService, webOrigin: string) {
  const router = Router();
  const origin = requireOrigin(webOrigin);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/dashboard', async (_req, res) => { res.json(await service.dashboard()); });
  router.get('/proposals', async (req, res) => { res.json(await service.list(proposalQuerySchema.parse(req.query))); });
  router.get('/proposals/:id', async (req, res) => { res.json(await service.detail(proposalIdSchema.parse(req.params.id))); });
  router.post('/proposals', origin, requireCsrf, async (req, res) => {
    const result = await service.create(createProposalSchema.parse(req.body), idempotencyKeySchema.parse(req.get('idempotency-key')), context(req, res));
    res.status(result.proposals.length ? 201 : 200).json(result);
  });
  router.post('/proposals/:id/approve', requireManager, origin, requireCsrf, async (req, res) => {
    approveProposalSchema.parse(req.body ?? {});
    res.json(await service.approve(proposalIdSchema.parse(req.params.id), context(req, res)));
  });
  router.post('/proposals/:id/reject', requireManager, origin, requireCsrf, async (req, res) => {
    const body = rejectProposalSchema.parse(req.body);
    res.json(await service.reject(proposalIdSchema.parse(req.params.id), body.reason, context(req, res)));
  });
  router.get('/audit-events', requireManager, async (req, res) => { res.json(await service.audit(auditQuerySchema.parse(req.query))); });
  return router;
}
