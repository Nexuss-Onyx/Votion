import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { makeApp, registerUser } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('workspace and teamspace routes', () => {
  it('lists the personal workspace and creates a teamspace', async () => {
    const app = await makeApp(); apps.push(app);
    const { body: user } = await registerUser(app);
    const listed = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { authorization: `Bearer ${user.accessToken}` } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().workspaces).toHaveLength(1);
    const created = await app.inject({ method: 'POST', url: '/api/workspaces',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { name: 'Engineering', isTeamspace: true, parentWorkspaceId: user.workspace.id },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().workspace.settings.isTeamspace).toBe(true);
  });

  it('prevents nonmembers from reading a workspace', async () => {
    const app = await makeApp(); apps.push(app);
    const { body: owner } = await registerUser(app);
    const { body: guest } = await registerUser(app);
    const response = await app.inject({ method: 'GET', url: `/api/workspaces/${owner.workspace.id}`,
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(response.statusCode).toBe(404);
  });
});
