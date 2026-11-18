import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { citationSchema, knowledgeSearchSchema } from '@supplypilot/contracts';
import { getAuth, requireCsrf, requireManager, requireOrigin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { MAX_PDF_BYTES } from '../knowledge/pdf.js';
import type { KnowledgeService } from '../knowledge/service.js';
import type { Actor } from '../knowledge/access.js';
import type { Request, Response } from 'express';
export function actor(req: Request, res: Response): Actor { const auth = getAuth(req); return { userId: auth.user.id, sessionId: auth.sessionId, requestId: res.locals.requestId as string }; }
export function knowledgeRoutes(service: KnowledgeService, webOrigin: string) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 3, fieldSize: 1000, parts: 4 } }).single('file');
  const supplier = (req: Request) => z.uuid().optional().parse(req.query.supplierId);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/knowledge/documents', requireManager, requireOrigin(webOrigin), requireCsrf, (req, res, next) => {
    upload(req, res, (error: unknown) => {
      if (error) { next(new HttpError(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'INVALID_UPLOAD', 'Upload one PDF of at most 10 MiB with valid metadata.')); return; }
      if (!req.file) { next(new HttpError(400, 'MISSING_PDF', 'A PDF file is required.')); return; }
      void service.upload(req.body, { bytes: req.file.buffer, filename: req.file.originalname, mime: req.file.mimetype }, actor(req, res)).then((document) => res.status(202).json(document)).catch(next);
    });
  });
  router.get('/knowledge/documents', async (req, res) => { res.json(await service.list(req.query, actor(req, res))); });
  router.get('/knowledge/suppliers', requireManager, async (req, res) => { res.json(await service.suppliers(actor(req, res))); });
  router.get('/knowledge/documents/:id', async (req, res) => { res.json(await service.get(z.uuid().parse(req.params.id), actor(req, res), supplier(req))); });
  router.get('/knowledge/documents/:id/file', async (req, res) => { const pdf = await service.file(z.uuid().parse(req.params.id), actor(req, res), supplier(req)); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="source.pdf"'); res.send(Buffer.from(pdf)); });
  router.post('/knowledge/documents/:id/retry', requireManager, requireOrigin(webOrigin), requireCsrf, async (req, res) => { z.object({}).strict().parse(req.body ?? {}); res.json(await service.retry(z.uuid().parse(req.params.id), actor(req, res), supplier(req))); });
  router.post('/knowledge/documents/:id/archive', requireManager, requireOrigin(webOrigin), requireCsrf, async (req, res) => { z.object({}).strict().parse(req.body ?? {}); res.json(await service.archive(z.uuid().parse(req.params.id), actor(req, res), supplier(req))); });
  router.post('/knowledge/search', requireOrigin(webOrigin), requireCsrf, async (req, res) => { res.json(await service.search(knowledgeSearchSchema.parse(req.body), actor(req, res))); });
  router.post('/knowledge/citations/resolve', requireOrigin(webOrigin), requireCsrf, async (req, res) => { res.json(await service.citation(citationSchema.parse(req.body), actor(req, res), supplier(req))); });
  return router;
}
