import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { AuthService, AuthSession } from '../services/auth.js';
import { HttpError } from './errors.js';

declare global {
  namespace Express {
    interface Request { auth?: AuthSession }
  }
}
export const SESSION_COOKIE = 'supplypilot_session';
export function requireAuth(service: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const session = await service.resolve(typeof token === 'string' ? token : undefined);
    if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    req.auth = session;
    next();
  };
}
export function getAuth(req: Request): AuthSession {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  return req.auth;
}
export const requireManager: RequestHandler = (req, _res, next) => {
  if (getAuth(req).user.role !== 'MANAGER') throw new HttpError(403, 'FORBIDDEN', 'Manager access required.');
  next();
};
export function requireOrigin(origin: string): RequestHandler {
  return (req, _res, next) => {
    if (req.get('origin') !== origin) throw new HttpError(403, 'INVALID_ORIGIN', 'Request origin is not allowed.');
    next();
  };
}
export const requireCsrf: RequestHandler = (req, _res, next) => {
  const actual = Buffer.from(req.get('x-csrf-token') ?? '');
  const expected = Buffer.from(getAuth(req).csrfToken);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(403, 'INVALID_CSRF', 'Invalid CSRF token.');
  next();
};
