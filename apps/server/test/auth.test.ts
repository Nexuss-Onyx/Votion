import { afterEach, describe, expect, it } from 'vitest';

import { makeApp, registerUser } from './helpers.js';
import type { FastifyInstance } from 'fastify';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('authentication routes', () => {
  it('registers a user and returns a JWT and refresh token', async () => {
    const app = await makeApp();
    apps.push(app);
    const { response, body } = await registerUser(app);
    expect(response.statusCode).toBe(201);
    expect(body.user.email).toContain('@example.test');
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(body.refreshToken.length).toBeGreaterThan(32);
  });

  it('logs in and rotates refresh tokens exactly once', async () => {
    const app = await makeApp();
    apps.push(app);
    const { body: registered } = await registerUser(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: registered.user.email, password: 'test-password-123' },
    });
    expect(login.statusCode).toBe(200);
    const loggedIn = login.json() as { refreshToken: string; accessToken: string };
    const refresh = await app.inject({
      method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: loggedIn.refreshToken },
    });
    expect(refresh.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: loggedIn.refreshToken },
    });
    expect(replay.statusCode).toBe(401);
    const me = await app.inject({
      method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${loggedIn.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('rejects invalid credentials and unauthenticated protected requests', async () => {
    const app = await makeApp();
    apps.push(app);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'none@example.test', password: 'bad' } });
    expect(login.statusCode).toBe(401);
    const protectedResponse = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(protectedResponse.statusCode).toBe(401);
  });
});
