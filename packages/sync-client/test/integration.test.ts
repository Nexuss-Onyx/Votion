/**
 * End-to-end integration: the exact transaction lifecycle from Architecture.md.
 *
 * This file mimics a real editing session — boot from cache, edit offline, refresh
 * the tab, reconnect, receive a peer's realtime update — using nothing but the
 * package's public entry point (`../src/index.js`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  PresenceEnvelope,
  SaveTransactionsResponse,
  Transaction,
} from '@votion/types';

import {
  IndexedDBStorage,
  OutboxStorage,
  RetryStrategy,
  TransactionBuilder,
  VOTION_DB_NAME,
  VotionClient,
  VotionDatabase,
  getRecordStore,
  selectChildBlocksById,
  selectBlockById,
  resetRecordStore,
  setRecordStore,
  setVotionDatabase,
  createRecordStore,
} from '../src/index.js';
import {
  PAGE_ID,
  SPACE_ID,
  USER_ID,
  id,
  makePage,
  makeTextBlock,
  resetClock,
} from './factories.js';

class FakeSocket {
  sent: PresenceEnvelope[] = [];
  addEventListener(_type: string, _listener: () => void): void {}
  removeEventListener(_type: string, _listener: () => void): void {}
}

let db: VotionDatabase;
let databaseSeq = 0;

beforeEach(async () => {
  resetClock();
  databaseSeq += 1;
  db = new VotionDatabase(`${VOTION_DB_NAME}-integration-${databaseSeq}`);
  setVotionDatabase(db);
  await db.open();
});

afterEach(async () => {
  await db.delete();
  setVotionDatabase(undefined);
});

/** Server double: acknowledges every transaction and tracks the wire payload. */
function createServer() {
  const requests: { requestId: string; transactions: Transaction[] }[] = [];
  const fetchImpl = async (body: {
    requestId: string;
    transactions: Transaction[];
  }): Promise<SaveTransactionsResponse> => {
    requests.push(body);
    return {
      requestId: body.requestId,
      results: body.transactions.map((transaction) => ({
        id: transaction.id,
        applied: true,
        versions: Object.fromEntries(
          transaction.operations.map((operation) => [operation.pointer.id, 2]),
        ),
      })),
    };
  };
  return { fetchImpl, requests };
}

describe('integration — editor session lifecycle', () => {
  it('boots from an empty cache, edits locally, and syncs in the background', async () => {
    const server = createServer();
    const { client } = await VotionClient.bootstrap({
      spaceId: SPACE_ID,
      store: createRecordStore(),
      storage: new IndexedDBStorage(db),
      outbox: new OutboxStorage(db),
      fetcher: server.fetchImpl,
      eventTarget: undefined,
      isOnline: () => true,
    });

    // Seed the page as if `loadPageChunk` had returned it.
    const page = makePage({ id: PAGE_ID, children: [] });
    client.store.getState().setRecord('block', page);
    await client.storage.persistRecord('block', page);

    // The user types a title: this is the 0 ms path.
    const startedAt = performance.now();
    const transaction = new TransactionBuilder({
      spaceId: SPACE_ID,
      table: 'block',
      id: PAGE_ID,
    })
      .set(['properties', 'title'], [['Updated Document Title']])
      .set(['last_edited_time'], 1716300050000)
      .build();
    await client.submit(transaction);
    const localLatency = performance.now() - startedAt;

    expect(client.store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Updated Document Title'],
    ]);
    expect(localLatency).toBeLessThan(250);

    // ...and the same transaction reaches the server, verbatim.
    await client.flush();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.transactions[0]?.operations[0]).toEqual({
      pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
      path: ['properties', 'title'],
      command: 'set',
      args: [['Updated Document Title']],
    });
    client.dispose();
  });

  it('adds a child block with a listAfter op and renders it via selectors', async () => {
    const server = createServer();
    const store = createRecordStore();
    store
      .getState()
      .setRecord('block', makePage({ id: PAGE_ID, children: [] }));
    const child = makeTextBlock({ id: id(4242), parent_id: PAGE_ID });
    store.getState().setRecord('block', child);

    const client = VotionClient.create({
      spaceId: SPACE_ID,
      store,
      storage: new IndexedDBStorage(db),
      outbox: new OutboxStorage(db),
      fetcher: server.fetchImpl,
      eventTarget: undefined,
      isOnline: () => true,
    });

    await client.submit(
      new TransactionBuilder({ spaceId: SPACE_ID, table: 'block', id: PAGE_ID })
        .listAfter(['content'], null, child.id)
        .build(),
    );

    const children = selectChildBlocksById(PAGE_ID)(client.store.getState());
    expect(children.map((block) => block.id)).toEqual([child.id]);
    expect(
      selectBlockById(child.id)(client.store.getState())?.properties.title,
    ).toEqual([['Hello world']]);
    client.dispose();
  });

  it('survives a full offline → refresh → reconnect → replay cycle', async () => {
    // ---------- Session 1: offline editing ------------------------------
    let online = false;
    const server = createServer();
    const storeA = createRecordStore();
    const clientA = VotionClient.create({
      spaceId: SPACE_ID,
      store: storeA,
      storage: new IndexedDBStorage(db),
      outbox: new OutboxStorage(db),
      fetcher: server.fetchImpl,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => online,
    });

    const page = makePage({ id: PAGE_ID, children: [] });
    storeA.getState().setRecord('block', page);

    const edits: Transaction[] = [];
    for (const text of ['Draft one', 'Draft two', 'Final draft']) {
      const transaction = new TransactionBuilder({
        spaceId: SPACE_ID,
        table: 'block',
        id: PAGE_ID,
      })
        .set(['properties', 'title'], [[text]])
        .build();
      edits.push(transaction);
      await clientA.submit(transaction);
    }

    expect(server.requests).toHaveLength(0);
    expect(await clientA.outbox.pendingCount()).toBe(3);
    clientA.dispose();
    db.close();

    // ---------- Session 2: the user refreshes the tab --------------------
    const reopened = new VotionDatabase(db.name);
    const { client: clientB, hydration } = await VotionClient.bootstrap({
      spaceId: SPACE_ID,
      store: createRecordStore(),
      storage: new IndexedDBStorage(reopened),
      outbox: new OutboxStorage(reopened),
      fetcher: server.fetchImpl,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => false,
    });

    expect(hydration.records).toBe(1);
    expect(hydration.pending).toBe(3);
    // The in-progress edit is intact before any network call.
    expect(clientB.store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Final draft'],
    ]);

    // ---------- Session 3: the network comes back ------------------------
    online = true;
    const clientC = VotionClient.create({
      spaceId: SPACE_ID,
      store: clientB.store,
      storage: new IndexedDBStorage(reopened),
      outbox: new OutboxStorage(reopened),
      fetcher: server.fetchImpl,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => true,
    });
    await clientC.flush();

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.transactions.map((tx) => tx.id)).toEqual(
      edits.map((edit) => edit.id),
    );
    expect(await clientC.outbox.pendingCount()).toBe(0);
    expect(clientC.store.getState().blocks[PAGE_ID]?.properties.title).toEqual([
      ['Final draft'],
    ]);

    clientB.dispose();
    clientC.dispose();
    await reopened.delete();
  });

  it('receives a peer edit through the realtime path and persists it', async () => {
    const store = createRecordStore();
    store.getState().setRecord('block', makePage({ id: PAGE_ID, version: 1 }));
    const storage = new IndexedDBStorage(db);
    await storage.persistRecord('block', store.getState().blocks[PAGE_ID]!);

    const client = VotionClient.create({
      spaceId: SPACE_ID,
      store,
      storage,
      outbox: new OutboxStorage(db),
      fetcher: createServer().fetchImpl,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => false,
    });

    const applied = client.sync.applyRemoteUpdate({
      type: 'record_updated',
      table: 'block',
      id: PAGE_ID,
      version: 2,
      patch: {
        properties: { title: [['Written by a teammate']] },
        last_edited_by_id: USER_ID,
      },
    });

    expect(applied).toBe(true);
    expect(store.getState().blocks[PAGE_ID]?.version).toBe(2);
    const persisted = await storage.loadRecord('block', PAGE_ID);
    expect(persisted?.properties.title).toEqual([['Written by a teammate']]);
    client.dispose();
  });

  it('broadcasts local presence at 20 Hz through the client facade', async () => {
    const socket = new FakeSocket();
    const store = createRecordStore();
    const client = VotionClient.create({
      spaceId: SPACE_ID,
      store,
      storage: new IndexedDBStorage(db),
      outbox: new OutboxStorage(db),
      fetcher: createServer().fetchImpl,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => false,
    });

    const presence = client.usePresence({
      pageId: PAGE_ID,
      userId: USER_ID,
      send: (message) => socket.sent.push(message),
    });

    for (let index = 0; index < 50; index += 1) {
      presence.setCursor({ x: index, y: index });
    }
    presence.setActiveBlock(id(1), { start: 0, end: 4 });

    expect(socket.sent.length).toBeLessThanOrEqual(3);
    expect(socket.sent.at(-1)).toMatchObject({
      activeBlockId: id(1),
      selectedRange: { start: 0, end: 4 },
    });

    // Peer presence is ephemeral and lives only in the client.
    presence.receive({
      type: 'presence',
      pageId: PAGE_ID,
      userId: id(99),
      cursor: { x: 1, y: 1 },
    });
    expect(client.presence?.peerCount).toBe(1);

    client.dispose();
    expect(client.presence).toBeUndefined();
  });

  it('degrades gracefully when IndexedDB is unavailable (SSR / private mode)', async () => {
    const unavailable = {
      open: async () => {
        throw new Error('IndexedDB is not available');
      },
      loadAllLocalRecords: async () => {
        throw new Error('IndexedDB is not available');
      },
      persistRecords: async () => undefined,
      persistRecord: async () => undefined,
    } as unknown as IndexedDBStorage;

    const originalSetVotionDatabase = setVotionDatabase;
    originalSetVotionDatabase(undefined);

    const { client, hydration } = await VotionClient.bootstrap({
      spaceId: SPACE_ID,
      store: createRecordStore(),
      storage: unavailable,
      outbox: new OutboxStorage(db),
      fetcher: createServer().fetchImpl,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => true,
      hydrate: true,
    });

    expect(hydration.hydrated).toBe(false);
    expect(hydration.error).toBeTruthy();

    // The engine stays usable: mutations still apply locally and hit the network.
    const page = makePage({ id: PAGE_ID });
    client.store.getState().setRecord('block', page);
    await client.submit(
      new TransactionBuilder({ spaceId: SPACE_ID, table: 'block', id: PAGE_ID })
        .set(['alive'], false)
        .build(),
    );

    expect(client.store.getState().blocks[PAGE_ID]?.alive).toBe(false);
    client.dispose();
  });
});

describe('integration — shared store singleton', () => {
  afterEach(() => {
    // The singleton is process-wide by design; reset it so test files that run
    // in the same worker cannot observe this file's store.
    resetRecordStore();
  });

  it('the default store is what the sync engine writes to', async () => {
    const store = createRecordStore();
    setRecordStore(store);
    expect(getRecordStore()).toBe(store);

    store.getState().setRecord('block', makePage({ id: PAGE_ID }));
    // No explicit `store`: the client must bind to the shared singleton.
    const client = VotionClient.create({
      spaceId: SPACE_ID,
      storage: new IndexedDBStorage(db),
      outbox: new OutboxStorage(db),
      fetcher: createServer().fetchImpl,
      eventTarget: undefined,
      autoFlush: false,
      isOnline: () => true,
      retryStrategy: new RetryStrategy({
        baseDelayMs: 1,
        maxDelayMs: 1,
        random: () => 1,
      }),
    });

    expect(client.store).toBe(store);
    await client.submit(
      new TransactionBuilder({ spaceId: SPACE_ID, table: 'block', id: PAGE_ID })
        .set(['properties', 'title'], [['Singleton write']])
        .build(),
    );
    expect(
      getRecordStore().getState().blocks[PAGE_ID]?.properties.title,
    ).toEqual([['Singleton write']]);
    client.dispose();
  });
});
