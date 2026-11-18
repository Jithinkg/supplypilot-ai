import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { readEnv } from './config/env.js';
import { createDatabase } from './db/client.js';
import { createAuthService, hashToken } from './services/auth.js';
import { createApp } from './app.js';

const env = readEnv();
const credentials = z.object({ SEED_STAFF_EMAIL: z.email(), SEED_STAFF_PASSWORD: z.string().min(16), SEED_MANAGER_EMAIL: z.email(), SEED_MANAGER_PASSWORD: z.string().min(16) }).parse(process.env);
const db = createDatabase(env.DATABASE_URL);
const app = createApp({ auth: createAuthService(db), checkDatabase: async () => { await db.$queryRaw`SELECT 1`; }, webOrigin: env.WEB_ORIGIN, production: false });
afterAll(async () => { await db.$disconnect(); });
describe('real PostgreSQL and seeded authentication', () => {
  it('serves readiness after migrations', async () => { expect((await request(app).get('/api/health')).status).toBe(200); });
  it.each([
    ['STAFF', credentials.SEED_STAFF_EMAIL, credentials.SEED_STAFF_PASSWORD],
    ['MANAGER', credentials.SEED_MANAGER_EMAIL, credentials.SEED_MANAGER_PASSWORD],
  ])('authenticates %s and revokes its session on logout', async (role, email, password) => {
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').set('Origin', env.WEB_ORIGIN).send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe(role);
    expect((await agent.get('/api/auth/me')).body.user.role).toBe(role);
    const cookieHeader = String(login.headers['set-cookie']);
    const token = /supplypilot_session=([a-f0-9]+)/.exec(cookieHeader)?.[1];
    expect(token).toBeDefined();
    const stored = await db.session.findUniqueOrThrow({ where: { tokenHash: hashToken(token!) } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(7.9 * 3600_000);
    expect((await agent.post('/api/auth/logout').set('Origin', env.WEB_ORIGIN).set('x-csrf-token', login.body.csrfToken)).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect(await db.session.findUnique({ where: { id: stored.id } })).toBeNull();
    expect(await db.auditEvent.count({ where: { entityId: stored.id, action: 'LOGOUT' } })).toBe(1);
  });
  it('rejects wrong passwords and expired sessions', async () => {
    expect((await request(app).post('/api/auth/login').set('Origin', env.WEB_ORIGIN).send({ email: credentials.SEED_STAFF_EMAIL, password: 'incorrect-password' })).status).toBe(401);
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').set('Origin', env.WEB_ORIGIN).send({ email: credentials.SEED_STAFF_EMAIL, password: credentials.SEED_STAFF_PASSWORD });
    const token = /supplypilot_session=([a-f0-9]+)/.exec(String(login.headers['set-cookie']))?.[1];
    if (!token) throw new Error('Login session missing');
    await db.session.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(0) } });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    await db.session.delete({ where: { tokenHash: hashToken(token) } });
  });
  it('enforces nonnegative stock and budget bounds in PostgreSQL', async () => {
    await expect(db.product.create({ data: { sku: 'invalid-day1-test', name: 'Invalid', unit: 'each', stockQuantity: -1 } })).rejects.toThrow();
    const budget = await db.budget.findUniqueOrThrow({ where: { key: 'SHARED' } });
    await expect(db.budget.update({ where: { id: budget.id }, data: { reservedPaise: budget.allocatedPaise + 1 } })).rejects.toThrow();
  });
});
