import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../middleware/errors.js';
export interface Actor { userId: string; sessionId: string; requestId: string }
export async function authorize(db: PrismaClient, actor: Actor, manager = false) {
  const session = await db.session.findFirst({ where: { id: actor.sessionId, userId: actor.userId, expiresAt: { gt: new Date() }, user: { active: true } }, include: { user: true } });
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  if (manager && session.user.role !== 'MANAGER') throw new HttpError(403, 'FORBIDDEN', 'Manager access required.');
  return session.user;
}
