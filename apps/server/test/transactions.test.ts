import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { MemoryPublisher, spaceEventsChannel } from '../src/lib/redis.js';
import { InMemoryStore } from '../src/store/memory.js';
import { addBlock, config, makeApp, registerUser } from './helpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('POST /api/v3/saveTransactions', () => {
  it('atomically applies operations, bumps versions, writes WAL, publishes after commit', async () => {
    const store = new InMemoryStore();
    const publisher = new MemoryPublisher();
    const { buildServer } = await import('../src/app.js');
    const integrated = await buildServer({ config, store, publisher, logger: false });
    apps.push(integrated);
    const { body: user } = await registerUser(integrated);
    const anchor = randomUUID();
    const block = await addBlock(store, user.workspace.id, { properties: { title: [['Before']] }, content: [anchor] });
    const afterId = randomUUID();
    const beforeId = randomUUID();
    const secondBlock = await addBlock(store, user.workspace.id, { properties: { title: [['Second before']] } });
    const transactionId = randomUUID();
    const requestId = randomUUID();
    const response = await integrated.inject({
      method: 'POST', url: '/api/v3/saveTransactions',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { requestId, transactions: [{ id: transactionId, spaceId: user.workspace.id, operations: [
        { pointer: { table: 'block', id: block.id, spaceId: user.workspace.id }, path: ['properties', 'title'], command: 'set', args: [['After']] },
        { pointer: { table: 'block', id: block.id, spaceId: user.workspace.id }, path: ['properties', 'metadata'], command: 'update', args: { flag: true } },
        { pointer: { table: 'block', id: block.id, spaceId: user.workspace.id }, path: ['properties', 'metadata'], command: 'keyedObjectSet', args: { key: 'last', value: 'yes' } },
        { pointer: { table: 'block', id: block.id, spaceId: user.workspace.id }, path: ['content'], command: 'listAfter', args: { id: afterId, after: anchor } },
        { pointer: { table: 'block', id: block.id, spaceId: user.workspace.id }, path: ['content'], command: 'listBefore', args: { id: beforeId, before: anchor } },
        { pointer: { table: 'block', id: block.id, spaceId: user.workspace.id }, path: ['content'], command: 'listRemove', args: { id: afterId } },
        { pointer: { table: 'block', id: secondBlock.id, spaceId: user.workspace.id }, path: ['properties', 'title'], command: 'set', args: [['Second after']] },
      ] }] },
    });
    expect(response.statusCode).toBe(200);
    const updated = await store.findBlockById(block.id);
    expect(updated?.version).toBe(2);
    expect(updated?.properties.title).toEqual([['After']]);
    expect(updated?.properties.metadata).toEqual({ flag: true, last: 'yes' });
    expect(updated?.content).toEqual([beforeId, anchor]);
    expect((await store.listTransactionRecords(user.workspace.id))).toHaveLength(1);
    const events = publisher.messagesFor(spaceEventsChannel(user.workspace.id));
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.id === block.id)).toMatchObject({
      type: 'record_updated',
      table: 'block',
      id: block.id,
      version: 2,
      spaceId: user.workspace.id,
      patch: {
        properties: { title: [['After']], metadata: { flag: true, last: 'yes' } },
        content: [beforeId, anchor],
      },
    });
    expect(events.find((event) => event.id === secondBlock.id)).toMatchObject({
      type: 'record_updated',
      table: 'block',
      id: secondBlock.id,
      version: 2,
      patch: { properties: { title: [['Second after']] } },
    });
  });

  it('rolls back all effects when any operation in the batch fails', async () => {
    const store = new InMemoryStore();
    const app = await makeApp(store);
    apps.push(app);
    const { body: user } = await registerUser(app);
    const block = await addBlock(store, user.workspace.id, { properties: { title: [['Stable']] } });
    const requestId = randomUUID();
    const response = await app.inject({
      method: 'POST', url: '/api/v3/saveTransactions',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { requestId, transactions: [
        { id: randomUUID(), spaceId: user.workspace.id, operations: [
          { pointer: { table: 'block', id: block.id, spaceId: user.workspace.id }, path: ['properties', 'title'], command: 'set', args: [['Changed']] },
        ] },
        { id: randomUUID(), spaceId: user.workspace.id, operations: [
          { pointer: { table: 'block', id: randomUUID(), spaceId: user.workspace.id }, path: ['properties', 'title'], command: 'set', args: [['Fail']] },
        ] },
      ] },
    });
    expect(response.statusCode).toBe(409);
    expect((await store.findBlockById(block.id))?.properties.title).toEqual([['Stable']]);
    expect((await store.findBlockById(block.id))?.version).toBe(1);
    expect(await store.listTransactionRecords(user.workspace.id)).toHaveLength(0);
  });

  it('rejects non-members before mutation', async () => {
    const store = new InMemoryStore();
    const app = await makeApp(store);
    apps.push(app);
    const { body: user } = await registerUser(app);
    const outsider = randomUUID();
    const response = await app.inject({ method: 'POST', url: '/api/v3/saveTransactions',
      headers: { authorization: `Bearer ${user.accessToken}` },
      payload: { requestId: randomUUID(), transactions: [{ id: randomUUID(), spaceId: outsider, operations: [
        { pointer: { table: 'block', id: randomUUID(), spaceId: outsider }, path: ['properties'], command: 'set', args: {} },
      ] }] },
    });
    expect(response.statusCode).toBe(403);
  });
});
