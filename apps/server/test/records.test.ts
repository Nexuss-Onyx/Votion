import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { addBlock, makeApp, registerUser } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('record retrieval and collection query', () => {
  it('returns a normalized page tree up to requested depth', async () => {
    const app = await makeApp();
    apps.push(app);
    const { body: user } = await registerUser(app);
    const root = await addBlock(app.store as import('../src/store/memory.js').InMemoryStore, user.workspace.id);
    const child = await addBlock(app.store as import('../src/store/memory.js').InMemoryStore, user.workspace.id, { parentId: root.id });
    const grandchild = await addBlock(app.store as import('../src/store/memory.js').InMemoryStore, user.workspace.id, { parentId: child.id });
    // The child links are represented by the parent's ordered content array.
    const memoryStore = app.store as import('../src/store/memory.js').InMemoryStore;
    // Add links via set-operation semantics would need WAL; create fixture rows with linked ids.
    const state = memoryStore as unknown as { state: { blocks: Map<string, { content: string[] }> } };
    state.state.blocks.get(root.id)!.content = [child.id];
    state.state.blocks.get(child.id)!.content = [grandchild.id];

    const response = await app.inject({ method: 'POST', url: '/api/v3/loadPageChunk',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { pageId: root.id, depth: 1 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { recordMap: { block: Record<string, { value: { id: string; space_id: string; created_time: string } }> }; hasMore: boolean };
    expect(Object.keys(body.recordMap.block)).toHaveLength(2);
    expect(body.recordMap.block[root.id]?.value.id).toBe(root.id);
    expect(body.recordMap.block[root.id]?.value.space_id).toBe(user.workspace.id);
    expect(body.recordMap.block[root.id]?.value.created_time).toMatch(/^\d{4}-/);
    expect(body.hasMore).toBe(true);
  });

  it('enforces collection-query membership and pagination/filtering', async () => {
    const app = await makeApp();
    apps.push(app);
    const { body: user } = await registerUser(app);
    const store = app.store as import('../src/store/memory.js').InMemoryStore;
    const collection = await store.createCollection({ spaceId: user.workspace.id, parentId: user.workspace.id });
    await addBlock(store, user.workspace.id, { parentId: collection.id, properties: { title: [['Alpha']] } });
    await addBlock(store, user.workspace.id, { parentId: collection.id, properties: { title: [['Beta']] } });
    // Table rows are addressed by parent_table=collection.
    const state = store as unknown as { state: { blocks: Map<string, { parentTable: string }> } };
    for (const row of state.state.blocks.values()) if (row.parentTable === 'space') row.parentTable = 'collection';
    const response = await app.inject({ method: 'POST', url: '/api/v3/queryCollection',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { collectionId: collection.id, search: 'a', limit: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(2);
    expect(response.json().results).toHaveLength(1);
  });
});
