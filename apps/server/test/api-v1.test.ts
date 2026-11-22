/**
 * Phase 11 — Developer API (`/v1`) integration tests.
 *
 * Covers authentication, blocks, pages, databases, search, pagination and
 * integration-token management against the in-memory store.
 */

import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerUser } from './helpers.js';
import {
  authHeaders,
  createIntegration,
  makeV1App,
  seedPage,
} from './v1-helpers.js';
import { InMemoryStore } from '../src/store/memory.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function setup() {
  const store = new InMemoryStore();
  const app = await makeV1App(store);
  apps.push(app);
  const { body: user } = await registerUser(app);
  const key = await createIntegration(store, user.workspace.id);
  return { app, store, workspaceId: user.workspace.id, token: key.token };
}

function richText(content: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text: { content } }];
}

describe('v1 authentication', () => {
  it('rejects requests without a bearer token', async () => {
    const { app } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/pages/${randomUUID()}`,
      headers: { 'notion-version': '2022-06-28' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as { object: string; code: string };
    expect(body.object).toBe('error');
    expect(body.code).toBe('unauthorized');
  });

  it('rejects malformed and unknown tokens', async () => {
    const { app } = await setup();
    const bad = await app.inject({
      method: 'GET',
      url: `/v1/pages/${randomUUID()}`,
      headers: authHeaders('secret_not-a-real-token'),
    });
    expect(bad.statusCode).toBe(401);

    const unknown = await app.inject({
      method: 'GET',
      url: `/v1/pages/${randomUUID()}`,
      headers: authHeaders(`secret_${'a'.repeat(48)}`),
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('rejects unsupported Notion-Version headers', async () => {
    const { app, token } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/pages/${randomUUID()}`,
      headers: authHeaders(token, { 'notion-version': '1999-01-01' }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_request');
  });

  it('enforces capability scopes', async () => {
    const store = new InMemoryStore();
    const app = await makeV1App(store);
    apps.push(app);
    const { body: user } = await registerUser(app);
    const readOnly = await createIntegration(store, user.workspace.id, ['read']);

    const forbidden = await app.inject({
      method: 'POST',
      url: '/v1/pages',
      headers: authHeaders(readOnly.token),
      payload: { parent: { workspace: true }, properties: {} },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().code).toBe('restricted_resource');
  });
});

describe('v1 blocks', () => {
  it('retrieves, renames, appends children, paginates and archives blocks', async () => {
    const { app, store, workspaceId, token } = await setup();
    const headers = authHeaders(token);
    const page = await seedPage(store, workspaceId, { title: [['Home']] });
    const childA = await store.createBlock({
      spaceId: workspaceId,
      type: 'text',
      parentId: page.id,
      parentTable: 'block',
      properties: { title: [['Child A']] },
    });
    const childB = await store.createBlock({
      spaceId: workspaceId,
      type: 'text',
      parentId: page.id,
      parentTable: 'block',
      properties: { title: [['Child B']] },
    });
    await store.updateBlock(page.id, { content: [childA.id, childB.id] });

    const retrieved = await app.inject({ method: 'GET', url: `/v1/blocks/${page.id}`, headers });
    expect(retrieved.statusCode).toBe(200);
    const block = retrieved.json() as {
      object: string;
      type: string;
      has_children: boolean;
      child_page: { title: string };
    };
    expect(block.object).toBe('block');
    expect(block.type).toBe('child_page');
    expect(block.has_children).toBe(true);
    expect(block.child_page.title).toBe('Home');

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/blocks/${page.id}`,
      headers,
      payload: { child_page: { title: 'Renamed' } },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { child_page: { title: string } }).child_page.title).toBe('Renamed');

    const firstPage = await app.inject({
      method: 'GET',
      url: `/v1/blocks/${page.id}/children?page_size=1`,
      headers,
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json() as {
      object: string;
      results: Array<{ id: string }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    expect(firstBody.object).toBe('list');
    expect(firstBody.results).toHaveLength(1);
    expect(firstBody.results[0]?.id).toBe(childA.id);
    expect(firstBody.has_more).toBe(true);
    expect(firstBody.next_cursor).toBeTruthy();

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/blocks/${page.id}/children?page_size=1&start_cursor=${encodeURIComponent(
        firstBody.next_cursor as string,
      )}`,
      headers,
    });
    const secondBody = secondPage.json() as { results: Array<{ id: string }>; has_more: boolean };
    expect(secondBody.results).toHaveLength(1);
    expect(secondBody.results[0]?.id).toBe(childB.id);
    expect(secondBody.has_more).toBe(false);

    const appended = await app.inject({
      method: 'PATCH',
      url: `/v1/blocks/${page.id}/children`,
      headers,
      payload: {
        children: [
          {
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: 'Appended' } }] },
          },
        ],
      },
    });
    expect(appended.statusCode).toBe(200);
    const appendedBody = appended.json() as {
      results: Array<{ paragraph: { rich_text: Array<{ plain_text: string }> } }>;
    };
    expect(appendedBody.results[0]?.paragraph.rich_text[0]?.plain_text).toBe('Appended');

    const afterAppend = await store.findBlockById(page.id);
    expect(afterAppend?.content).toHaveLength(3);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/blocks/${page.id}`,
      headers,
    });
    expect(deleted.statusCode).toBe(200);
    expect((deleted.json() as { archived: boolean }).archived).toBe(true);

    const afterDelete = await app.inject({ method: 'GET', url: `/v1/blocks/${page.id}`, headers });
    expect(afterDelete.statusCode).toBe(404);
  });
});

describe('v1 databases and pages', () => {
  async function createDatabase(app: FastifyInstance, token: string, parentId: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/databases',
      headers: authHeaders(token),
      payload: {
        parent: { page_id: parentId },
        title: richText('Tasks'),
        properties: {
          Name: { title: {} },
          Status: {
            select: { options: [{ name: 'Todo', color: 'red' }, { name: 'Done', color: 'green' }] },
          },
          Notes: { rich_text: {} },
          Due: { date: {} },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      object: string;
      id: string;
      title: Array<{ plain_text: string }>;
      properties: Record<string, { type: string; select?: { options: unknown[] } }>;
    };
  }

  it('creates a database and returns its schema', async () => {
    const { app, store, workspaceId, token } = await setup();
    const parent = await seedPage(store, workspaceId);
    const database = await createDatabase(app, token, parent.id);
    expect(database.object).toBe('database');
    expect(database.title[0]?.plain_text).toBe('Tasks');
    expect(database.properties['Name']?.type).toBe('title');
    expect(database.properties['Status']?.select?.options).toHaveLength(2);

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/databases/${database.id}`,
      headers: authHeaders(token),
    });
    expect(fetched.statusCode).toBe(200);
    expect((fetched.json() as { object: string }).object).toBe('database');
  });

  it('creates, reads, updates and archives pages in a database', async () => {
    const { app, store, workspaceId, token } = await setup();
    const headers = authHeaders(token);
    const parent = await seedPage(store, workspaceId);
    const database = await createDatabase(app, token, parent.id);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/pages',
      headers,
      payload: {
        parent: { database_id: database.id },
        properties: {
          Name: { title: richText('Task A') },
          Status: { select: { name: 'Todo' } },
        },
      },
    });
    expect(created.statusCode).toBe(200);
    const page = created.json() as {
      object: string;
      id: string;
      parent: { type: string; database_id: string };
      properties: {
        Name: { title: Array<{ plain_text: string }> };
        Status: { select: { name: string } };
      };
    };
    expect(page.object).toBe('page');
    expect(page.parent).toEqual({ type: 'database_id', database_id: database.id });
    expect(page.properties.Name.title[0]?.plain_text).toBe('Task A');
    expect(page.properties.Status.select?.name).toBe('Todo');

    const fetched = await app.inject({ method: 'GET', url: `/v1/pages/${page.id}`, headers });
    expect(fetched.statusCode).toBe(200);
    expect((fetched.json() as { id: string }).id).toBe(page.id);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/v1/pages/${page.id}`,
      headers,
      payload: { properties: { Status: { select: { name: 'Done' } } } },
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = updated.json() as {
      properties: { Status: { select: { name: string } } };
    };
    expect(updatedBody.properties.Status.select?.name).toBe('Done');

    const archived = await app.inject({
      method: 'DELETE',
      url: `/v1/pages/${page.id}`,
      headers,
    });
    expect(archived.statusCode).toBe(200);
    expect((archived.json() as { archived: boolean }).archived).toBe(true);
    const missing = await app.inject({ method: 'GET', url: `/v1/pages/${page.id}`, headers });
    expect(missing.statusCode).toBe(404);
  });

  it('queries databases with filters and cursor pagination', async () => {
    const { app, store, workspaceId, token } = await setup();
    const headers = authHeaders(token);
    const parent = await seedPage(store, workspaceId);
    const database = await createDatabase(app, token, parent.id);

    for (const [name, status] of [
      ['Task A', 'Todo'],
      ['Task B', 'Done'],
      ['Task C', 'Done'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/pages',
        headers,
        payload: {
          parent: { database_id: database.id },
          properties: {
            Name: { title: richText(name) },
            Status: { select: { name: status } },
          },
        },
      });
      expect(response.statusCode).toBe(200);
    }

    const filtered = await app.inject({
      method: 'POST',
      url: `/v1/databases/${database.id}/query`,
      headers,
      payload: { filter: { property: 'Status', select: { equals: 'Done' } } },
    });
    expect(filtered.statusCode).toBe(200);
    const filteredBody = filtered.json() as { results: Array<{ id: string }>; has_more: boolean };
    expect(filteredBody.results).toHaveLength(2);
    expect(filteredBody.has_more).toBe(false);

    const page1 = await app.inject({
      method: 'POST',
      url: `/v1/databases/${database.id}/query`,
      headers,
      payload: { page_size: 2 },
    });
    const page1Body = page1.json() as {
      results: Array<{ id: string }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    expect(page1Body.results).toHaveLength(2);
    expect(page1Body.has_more).toBe(true);

    const page2 = await app.inject({
      method: 'POST',
      url: `/v1/databases/${database.id}/query`,
      headers,
      payload: { page_size: 2, start_cursor: page1Body.next_cursor as string },
    });
    const page2Body = page2.json() as { results: Array<{ id: string }>; has_more: boolean };
    expect(page2Body.results).toHaveLength(1);
    expect(page2Body.has_more).toBe(false);
  });

  it('searches pages and databases with object filters', async () => {
    const { app, store, workspaceId, token } = await setup();
    const headers = authHeaders(token);
    const parent = await seedPage(store, workspaceId, { title: [['Searchable Page']] });
    const database = await createDatabase(app, token, parent.id);

    const pages = await app.inject({
      method: 'POST',
      url: '/v1/search',
      headers,
      payload: { query: 'Searchable' },
    });
    expect(pages.statusCode).toBe(200);
    const pagesBody = pages.json() as { results: Array<{ object: string }> };
    expect(pagesBody.results.some((entry) => entry.object === 'page')).toBe(true);

    const databases = await app.inject({
      method: 'POST',
      url: '/v1/search',
      headers,
      payload: { filter: { property: 'object', value: 'database' } },
    });
    const databasesBody = databases.json() as { results: Array<{ id: string }> };
    expect(databasesBody.results.some((entry) => entry.id === database.id)).toBe(true);
  });
});

describe('v1 integration token management', () => {
  it('creates, lists, revokes and enforces API keys', async () => {
    const { app, token } = await setup();
    const headers = authHeaders(token);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers,
      payload: { name: 'CI key', capabilities: ['read'] },
    });
    expect(created.statusCode).toBe(201);
    const key = created.json() as { id: string; secret: string; capabilities: string[] };
    expect(key.secret.startsWith('secret_')).toBe(true);
    expect(key.capabilities).toEqual(['read']);

    const listed = await app.inject({ method: 'GET', url: '/v1/api-keys', headers });
    const listedBody = listed.json() as { results: Array<{ id: string }> };
    expect(listedBody.results.some((entry) => entry.id === key.id)).toBe(true);

    const authed = await app.inject({
      method: 'GET',
      url: `/v1/pages/${randomUUID()}`,
      headers: authHeaders(key.secret),
    });
    expect(authed.statusCode).toBe(404);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${key.id}`,
      headers,
    });
    expect(revoked.statusCode).toBe(200);
    expect((revoked.json() as { revoked_at: string | null }).revoked_at).not.toBeNull();

    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/v1/pages/${randomUUID()}`,
      headers: authHeaders(key.secret),
    });
    expect(afterRevoke.statusCode).toBe(401);
  });
});
