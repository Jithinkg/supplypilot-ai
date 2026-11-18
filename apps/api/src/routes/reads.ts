import { Router } from 'express';
import { inventoryQuerySchema, productIdSchema, quoteQuerySchema } from '@supplypilot/contracts';
import type { ReadService } from '../services/reads.js';

export function readRoutes(service: ReadService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/inventory/risks', async (req, res) => { res.json(await service.inventory(inventoryQuerySchema.parse(req.query))); });
  router.get('/products/:id/sales', async (req, res) => { res.json(await service.sales(productIdSchema.parse(req.params.id))); });
  router.get('/products/:id/quotes', async (req, res) => {
    const { quantity } = quoteQuerySchema.parse(req.query);
    res.json(await service.quotes(productIdSchema.parse(req.params.id), quantity));
  });
  router.get('/budget', async (_req, res) => { res.json(await service.budget()); });
  return router;
}
