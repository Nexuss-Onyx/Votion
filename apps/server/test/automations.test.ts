/**
 * Phase 11 — in-database automation engine tests.
 *
 * Verifies the full trigger → action pipeline for `page_added` and
 * `property_edited`, plus automation management and deletion.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { registerUser } from './helpers.js';
import { authHeaders, createIntegration, makeV1App, seedPage } from './v1-helpers.js';
import { InMemoryStore } from '../src/store/memory.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function richText(content: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text: { content } }];
}

interface PropertyValue {
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
}

interface Row {
  id: string;
  properties: Record<string, PropertyValue>;
}

async function setup() {
  const store = new InMemoryStore();
  const app = await makeV1App(store);
  apps.push(app);
  const { body: user } = await registerUser(app);
  const key = await createIntegration(store, user.workspace.id);
  const parent = await seedPage(store, user.workspace.id);
  return { app, store, workspaceId: user.workspace.id, token: key.token, parent };
}

async function createTasksDatabase(app: FastifyInstance, token: string, parentId: string) {
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
          select: {
            options: [
              { name: 'Todo', color: 'red' },
              { name: 'In Progress', color: 'yellow' },
              { name: 'Done', color: 'green' },
            ],
          },
        },
        Notes: { rich_text: {} },
      },
    },
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { id: string }).id;
}

async function createPage(
  app: FastifyInstance,
  token: string,
  databaseId: string,
  properties: Record<string, unknown>,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/pages',
    headers: authHeaders(token),
    payload: { parent: { database_id: databaseId }, properties },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { id: string; properties: Record<string, PropertyValue> };
}

async function queryRows(app: FastifyInstance, token: string, databaseId: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/databases/${databaseId}/query`,
    headers: authHeaders(token),
    payload: {},
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { results: Row[] }).results;
}

describe('automation engine', () => {
  it('runs create_page actions when a page is added to a database', async () => {
    const { app, token, parent } = await setup();
    const databaseId = await createTasksDatabase(app, token, parent.id);

    const rule = await app.inject({
      method: 'POST',
      url: '/v1/automations',
      headers: authHeaders(token),
      payload: {
        name: 'Mirror new rows',
        trigger: { type: 'page_added', database_id: databaseId },
        actions: [
          {
            type: 'create_page',
            parent: { database_id: databaseId },
            properties: { Name: { title: richText('From automation') } },
          },
        ],
      },
    });
    expect(rule.statusCode).toBe(201);

    await createPage(app, token, databaseId, {
      Name: { title: richText('Task A') },
      Status: { select: { name: 'Todo' } },
    });

    const rows = await queryRows(app, token, databaseId);
    expect(rows).toHaveLength(2);
    const mirrored = rows.find((row) =>
      row.properties['Name']?.title?.some(
        (entry: { plain_text: string }) => entry.plain_text === 'From automation',
      ),
    );
    expect(mirrored).toBeDefined();
  });

  it('runs update_property actions when a watched property reaches a value', async () => {
    const { app, token, parent } = await setup();
    const databaseId = await createTasksDatabase(app, token, parent.id);

    const rule = await app.inject({
      method: 'POST',
      url: '/v1/automations',
      headers: authHeaders(token),
      payload: {
        name: 'Mark completed',
        trigger: { type: 'property_edited', property: 'Status', value: 'Done', database_id: databaseId },
        actions: [{ type: 'update_property', property: 'Notes', value: 'Completed' }],
      },
    });
    expect(rule.statusCode).toBe(201);

    const page = await createPage(app, token, databaseId, {
      Name: { title: richText('Task B') },
      Status: { select: { name: 'Todo' } },
    });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/pages/${page.id}`,
      headers: authHeaders(token),
      payload: { properties: { Status: { select: { name: 'Done' } } } },
    });
    expect(patched.statusCode).toBe(200);

    const rows = await queryRows(app, token, databaseId);
    const updated = rows.find((row) => row.id === page.id);
    expect(updated?.properties['Notes']?.rich_text?.[0]?.plain_text).toBe('Completed');
  });

  it('does not fire property_edited when the value guard does not match', async () => {
    const { app, token, parent } = await setup();
    const databaseId = await createTasksDatabase(app, token, parent.id);

    const rule = await app.inject({
      method: 'POST',
      url: '/v1/automations',
      headers: authHeaders(token),
      payload: {
        name: 'Only when done',
        trigger: { type: 'property_edited', property: 'Status', value: 'Done', database_id: databaseId },
        actions: [{ type: 'update_property', property: 'Notes', value: 'Completed' }],
      },
    });
    expect(rule.statusCode).toBe(201);

    const page = await createPage(app, token, databaseId, {
      Name: { title: richText('Task C') },
      Status: { select: { name: 'Todo' } },
    });
    await app.inject({
      method: 'PATCH',
      url: `/v1/pages/${page.id}`,
      headers: authHeaders(token),
      payload: { properties: { Status: { select: { name: 'In Progress' } } } },
    });

    const rows = await queryRows(app, token, databaseId);
    const updated = rows.find((row) => row.id === page.id);
    expect(updated?.properties['Notes']?.rich_text ?? []).toHaveLength(0);
  });

  it('lists and deletes automation rules', async () => {
    const { app, token, parent } = await setup();
    const databaseId = await createTasksDatabase(app, token, parent.id);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/automations',
      headers: authHeaders(token),
      payload: {
        name: 'Temporary',
        trigger: { type: 'page_added', database_id: databaseId },
        actions: [{ type: 'update_property', property: 'Notes', value: 'x' }],
      },
    });
    const rule = created.json() as { id: string };

    const listed = await app.inject({ method: 'GET', url: '/v1/automations', headers: authHeaders(token) });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { results: Array<{ id: string }> }).results.some((entry) => entry.id === rule.id)).toBe(true);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/automations/${rule.id}`,
      headers: authHeaders(token),
    });
    expect(deleted.statusCode).toBe(200);
    expect((deleted.json() as { alive: boolean }).alive).toBe(false);
  });
});
