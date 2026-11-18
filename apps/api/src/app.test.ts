import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { HttpError, errorHandler } from './middleware/errors.js';
import { requireManager } from './middleware/auth.js';
import type { AuthService, AuthSession } from './services/auth.js';

const user = { id: 'a86e459b-ef7b-4fc8-8bd2-57ac5c34c6d3', email: 'staff@example.test', role: 'STAFF' as const };
const session: AuthSession = { user, sessionId: 'test-session', csrfToken: 'c'.repeat(64) };
function fixture() {
  const auth: AuthService = {
    login: vi.fn(async () => ({ ...session, token: 'a'.repeat(64), expiresAt: new Date(Date.now() + 3600_000) })),
    resolve: vi.fn(async (token) => token === 'a'.repeat(64) ? session : null),
    logout: vi.fn(async () => {}),
  };
  const checkDatabase = vi.fn(async () => {});
  return { auth, checkDatabase, app: createApp({ auth, checkDatabase, webOrigin: 'http://localhost:5173', production: false }) };
}
describe('HTTP foundation', () => {
  it('reports healthy and unavailable database states without leaking internals', async () => {
    const { app, checkDatabase } = fixture();
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok', database: 'up' });
    checkDatabase.mockRejectedValueOnce(new Error('secret-url'));
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(503);
    expect(response.text).not.toContain('secret-url');
  });
  it('requires authentication for the current user', async () => {
    expect((await request(fixture().app).get('/api/auth/me')).status).toBe(401);
  });
  it('rejects malformed JSON and privilege fields before authentication logic', async () => {
    const { app, auth } = fixture();
    const malformed = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect((await request(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'x', role: 'MANAGER' })).status).toBe(400);
    expect(auth.login).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies', async () => {
    expect((await request(fixture().app).post('/api/auth/login').send({ password: 'x'.repeat(20_000) })).status).toBe(413);
  });
  it('requires the configured origin on login', async () => {
    expect((await request(fixture().app).post('/api/auth/login').set('Origin', 'https://attacker.test').send({ email: user.email, password: 'x' })).status).toBe(403);
  });
  it('sets protected cookie, returns only public user fields and prevents auth caching', async () => {
    const response = await request(fixture().app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'x' });
    expect(response.status).toBe(200);
    expect(String(response.headers['set-cookie'])).toMatch(/HttpOnly/);
    expect(String(response.headers['set-cookie'])).toMatch(/SameSite=Lax/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.body).sort()).toEqual(['csrfToken', 'user']);
  });
  it('requires both matching origin and CSRF token on logout', async () => {
    const { app, auth } = fixture();
    const cookie = `supplypilot_session=${'a'.repeat(64)}`;
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie).set('Origin', 'http://localhost:5173')).status).toBe(403);
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie).set('Origin', 'https://attacker.test').set('x-csrf-token', session.csrfToken)).status).toBe(403);
    expect(auth.logout).not.toHaveBeenCalled();
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie).set('Origin', 'http://localhost:5173').set('x-csrf-token', session.csrfToken)).status).toBe(204);
    expect(auth.logout).toHaveBeenCalledOnce();
  });
  it('hides unexpected errors and preserves generic invalid credentials', async () => {
    const { app, auth } = fixture();
    vi.mocked(auth.login).mockRejectedValueOnce(new Error('database-password'));
    const response = await request(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'x' });
    expect(response.status).toBe(500);
    expect(response.text).not.toContain('database-password');
    vi.mocked(auth.login).mockRejectedValueOnce(new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'));
    expect((await request(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'x' })).status).toBe(401);
  });
  it('rate limits login attempts', async () => {
    const { app } = fixture();
    for (let i = 0; i < 20; i++) await request(app).post('/api/auth/login').set('Origin', 'http://localhost:5173').send({ email: user.email, password: 'x' });
    expect((await request(app).post('/api/auth/login')).status).toBe(429);
  });
});
describe('manager authorization boundary', () => {
  it.each([['STAFF', 403], ['MANAGER', 204]] as const)('enforces role %s', async (role, expected) => {
    const app = express();
    app.use((req, _res, next) => { req.auth = { ...session, user: { ...user, role } }; next(); });
    app.get('/manager-test', requireManager, (_req, res) => { res.status(204).end(); });
    app.use(errorHandler);
    expect((await request(app).get('/manager-test')).status).toBe(expected);
  });
});
