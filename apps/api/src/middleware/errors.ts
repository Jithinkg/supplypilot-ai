import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const malformed = error instanceof SyntaxError && 'body' in error;
  const tooLarge = error instanceof Error && 'type' in error && error.type === 'entity.too.large';
  const status = error instanceof HttpError ? error.status : error instanceof ZodError || malformed ? 400 : tooLarge ? 413 : 500;
  const code = error instanceof HttpError ? error.code : status === 400 ? 'VALIDATION_ERROR' : status === 413 ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : status === 400 ? 'Invalid request input.' : status === 413 ? 'Request body too large.' : 'The request could not be completed.';
  res.status(status).json({ error: { code, message, requestId: res.locals.requestId } });
};
