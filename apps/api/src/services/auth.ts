import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import type { User } from '@supplypilot/contracts';
import { HttpError } from '../middleware/errors.js';

const SESSION_MS = 8 * 60 * 60 * 1000;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export interface AuthSession { user: User; sessionId: string; csrfToken: string }
export interface AuthService {
  login(email: string, password: string, requestId: string): Promise<AuthSession & { token: string; expiresAt: Date }>;
  resolve(token: string | undefined): Promise<AuthSession | null>;
  logout(session: AuthSession, requestId: string): Promise<void>;
}

export function createAuthService(db: PrismaClient): AuthService {
  // Equal-cost verification for unknown accounts reduces account enumeration.
  const dummyHash = argon2.hash(randomBytes(32), { type: argon2.argon2id });
  return {
    async login(email, password, requestId) {
      const user = await db.user.findUnique({ where: { email } });
      const valid = await argon2.verify(user?.passwordHash ?? await dummyHash, password);
      if (!user || !user.active || !valid) {
        await db.auditEvent.create({ data: { actorKind: 'HUMAN', action: 'LOGIN_FAILED', entityType: 'Session', requestId } });
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      }
      const token = randomBytes(32).toString('hex');
      const csrfToken = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_MS);
      const session = await db.$transaction(async (tx) => {
        const created = await tx.session.create({ data: { userId: user.id, tokenHash: hashToken(token), csrfSecret: csrfToken, expiresAt } });
        await tx.auditEvent.create({ data: { actorUserId: user.id, actorKind: 'HUMAN', action: 'LOGIN', entityType: 'Session', entityId: created.id, requestId } });
        return created;
      });
      return { user: { id: user.id, email: user.email, role: user.role }, sessionId: session.id, csrfToken, token, expiresAt };
    },
    async resolve(token) {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
      if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
      return { user: { id: session.user.id, email: session.user.email, role: session.user.role }, sessionId: session.id, csrfToken: session.csrfSecret };
    },
    async logout(session, requestId) {
      await db.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { id: session.sessionId } });
        await tx.auditEvent.create({ data: { actorUserId: session.user.id, actorKind: 'HUMAN', action: 'LOGOUT', entityType: 'Session', entityId: session.sessionId, requestId } });
      });
    },
  };
}
