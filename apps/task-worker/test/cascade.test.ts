import { describe, expect, it } from 'vitest';

import type { Block, Collection, UUID } from '@votion/types';

import {
  ALL_QUEUE_NAMES,
  buildHierarchyCascadeJobId,
  buildRollupCalculatorJobId,
  buildSearchIndexingJobId,
  parseRedisConnectionOptions,
} from '../src/queues/index.js';
import {
  HierarchyCascadeWorker,
  InMemoryHierarchyCascadeStore,
} from '../src/workers/HierarchyCascadeWorker.js';
import {
  InMemoryRollupStore,
  RollupWorker,
  computeRollupAggregation,
} from '../src/workers/RollupWorker.js';
import {
  InMemorySearchDocumentWriter,
  SearchIndexingWorker,
} from '../src/workers/SearchIndexingWorker.js';

const SPACE_ID: UUID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID: UUID = '00000000-0000-4000-8000-000000000002';
const USER_ID: UUID = '00000000-0000-4000-8000-000000000099';

function makeBlockId(index: number): UUID {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function createNestedChain(count: number): Block[] {
  const now = 1_700_000_000_000;
  const blocks: Block[] = [];

  for (let i = 0; i < count; i += 1) {
    const id = makeBlockId(i + 1);
    const parentId = i === 0 ? SPACE_ID : makeBlockId(i);
    const childIds = i < count - 1 ? [makeBlockId(i + 2)] : [];

    blocks.push({
      id,
      space_id: SPACE_ID,
      version: 1,
      type: i === 0 ? 'page' : 'text',
      properties: {
        title: [[`Nested Block #${i + 1}`]],
      },
      format: {},
      content: childIds,
      parent_id: parentId,
      parent_table: i === 0 ? 'space' : 'block',
      alive: true,
      created_time: now,
      last_edited_time: now,
      created_by_id: USER_ID,
      last_edited_by_id: USER_ID,
    });
  }

  return blocks;
}

describe('HierarchyCascadeWorker', () => {
  it('recursively cascades soft-delete (alive: false) down 100 nested blocks', async () => {
    const chain = createNestedChain(100);
    const store = new InMemoryHierarchyCascadeStore(chain);
    const purgedBatches: UUID[][] = [];

    const worker = new HierarchyCascadeWorker({
      store,
      onBlocksSoftDeleted: (_spaceId, ids) => {
        purgedBatches.push(ids);
      },
    });

    const rootBlockId = chain[0]!.id;
    const result = await worker.process({
      kind: 'soft-delete',
      spaceId: SPACE_ID,
      rootBlockId,
      alive: false,
      actorId: USER_ID,
    });

    expect(result.kind).toBe('soft-delete');
    expect(result.rootBlockId).toBe(rootBlockId);
    expect(result.visitedCount).toBe(100);
    expect(result.updatedCount).toBe(100);
    expect(result.batchCount).toBe(1);
    expect(result.updatedBlockIds).toHaveLength(100);

    // Every single one of the 100 nested blocks must now be marked alive: false
    for (const original of chain) {
      const updated = store.getBlock(original.id);
      expect(updated).toBeDefined();
      expect(updated?.alive).toBe(false);
      expect(updated?.version).toBe(2);
    }

    expect(purgedBatches.flat()).toHaveLength(100);

    // Idempotence check: re-running the same cascade job must not re-mutate blocks
    const secondRun = await worker.process({
      kind: 'soft-delete',
      spaceId: SPACE_ID,
      rootBlockId,
      alive: false,
      actorId: USER_ID,
    });

    expect(secondRun.visitedCount).toBe(100);
    expect(secondRun.updatedCount).toBe(0);
    expect(store.getBlock(chain[99]!.id)?.version).toBe(2);
  });

  it('processes large block hierarchies in batches of 500', async () => {
    const totalBlocks = 1_200;
    const now = 1_700_000_000_000;
    const rootId = makeBlockId(1);
    const childrenIds: UUID[] = [];
    const blocks: Block[] = [];

    for (let i = 2; i <= totalBlocks; i += 1) {
      const id = makeBlockId(i);
      childrenIds.push(id);
      blocks.push({
        id,
        space_id: SPACE_ID,
        version: 1,
        type: 'text',
        properties: { title: [[`Leaf ${i}`]] },
        format: {},
        content: [],
        parent_id: rootId,
        parent_table: 'block',
        alive: true,
        created_time: now,
        last_edited_time: now,
        created_by_id: USER_ID,
        last_edited_by_id: USER_ID,
      });
    }

    blocks.unshift({
      id: rootId,
      space_id: SPACE_ID,
      version: 1,
      type: 'page',
      properties: { title: [['Root Page']] },
      format: {},
      content: childrenIds,
      parent_id: SPACE_ID,
      parent_table: 'space',
      alive: true,
      created_time: now,
      last_edited_time: now,
      created_by_id: USER_ID,
      last_edited_by_id: USER_ID,
    });

    const store = new InMemoryHierarchyCascadeStore(blocks);
    const worker = new HierarchyCascadeWorker({
      store,
      defaultBatchSize: 500,
    });

    const result = await worker.process({
      kind: 'soft-delete',
      spaceId: SPACE_ID,
      rootBlockId: rootId,
    });

    expect(result.visitedCount).toBe(1_200);
    expect(result.updatedCount).toBe(1_200);
    // 1,200 blocks at batchSize=500 -> ceil(1200 / 500) = 3 batches
    expect(result.batchCount).toBe(3);
  });

  it('cascades permission overrides down descendant blocks idempotently', async () => {
    const chain = createNestedChain(25);
    const store = new InMemoryHierarchyCascadeStore(chain);
    const worker = new HierarchyCascadeWorker({ store });
    const guestId: UUID = '00000000-0000-4000-8000-000000000777';

    const firstResult = await worker.process({
      kind: 'permission-cascade',
      spaceId: SPACE_ID,
      workspaceId: WORKSPACE_ID,
      rootBlockId: chain[0]!.id,
      overrides: [
        {
          principalType: 'user',
          principalId: guestId,
          role: 'read',
        },
      ],
    });

    expect(firstResult.visitedCount).toBe(25);
    expect(firstResult.updatedCount).toBe(25);

    const deepestPerms = store.getPermissionsForBlock(chain[24]!.id);
    expect(deepestPerms).toHaveLength(1);
    expect(deepestPerms[0]?.role).toBe('read');

    // Retrying with identical overrides is a no-op
    const retryResult = await worker.process({
      kind: 'permission-cascade',
      spaceId: SPACE_ID,
      workspaceId: WORKSPACE_ID,
      rootBlockId: chain[0]!.id,
      overrides: [
        {
          principalType: 'user',
          principalId: guestId,
          role: 'read',
        },
      ],
    });

    expect(retryResult.updatedCount).toBe(0);
    expect(store.getPermissionsForBlock(chain[24]!.id)).toHaveLength(1);
  });
});

describe('SearchIndexingWorker & RollupWorker', () => {
  it('transforms blocks into Meilisearch documents and deletes soft-deleted blocks', async () => {
    const writer = new InMemorySearchDocumentWriter();
    const worker = new SearchIndexingWorker({ writer });
    const chain = createNestedChain(3);

    const indexResult = await worker.process({
      spaceId: SPACE_ID,
      action: 'sync-tree',
      rootPageId: chain[0]!.id,
      blocks: chain,
    });

    expect(indexResult.added).toBe(3);
    expect(writer.size).toBe(3);

    // Mark middle block soft-deleted and send upsert
    const deletedBlock: Block = {
      ...chain[1]!,
      alive: false,
      version: 2,
    };

    const deleteResult = await worker.process({
      spaceId: SPACE_ID,
      action: 'upsert',
      rootPageId: chain[0]!.id,
      blocks: [deletedBlock],
    });

    expect(deleteResult.deleted).toBe(1);
    expect(writer.size).toBe(2);
    expect(writer.getDocument(deletedBlock.id)).toBeUndefined();
  });

  it('recalculates cross-collection rollups when a linked relation row changes', async () => {
    const tasksCollectionId: UUID = '00000000-0000-4000-8000-000000000101';
    const projectsCollectionId: UUID = '00000000-0000-4000-8000-000000000102';
    const task1Id: UUID = '00000000-0000-4000-8000-000000000201';
    const task2Id: UUID = '00000000-0000-4000-8000-000000000202';
    const project1Id: UUID = '00000000-0000-4000-8000-000000000301';
    const now = 1_700_000_000_000;

    const tasksCollection: Collection = {
      id: tasksCollectionId,
      space_id: SPACE_ID,
      parent_id: SPACE_ID,
      name: [['Tasks']],
      schema: {
        title: { name: 'Task', type: 'title' },
        points: { name: 'Story Points', type: 'number' },
      },
      alive: true,
      version: 1,
    };

    const projectsCollection: Collection = {
      id: projectsCollectionId,
      space_id: SPACE_ID,
      parent_id: SPACE_ID,
      name: [['Projects']],
      schema: {
        title: { name: 'Project', type: 'title' },
        tasks_rel: {
          name: 'Tasks',
          type: 'relation',
          collection_id: tasksCollectionId,
        },
        total_points: {
          name: 'Total Points',
          type: 'rollup',
          rollup: {
            relation_property_id: 'tasks_rel',
            target_property_id: 'points',
            aggregation: 'sum',
          },
        },
        avg_points: {
          name: 'Average Points',
          type: 'rollup',
          rollup: {
            relation_property_id: 'tasks_rel',
            target_property_id: 'points',
            aggregation: 'average',
          },
        },
      },
      alive: true,
      version: 1,
    };

    const task1: Block = {
      id: task1Id,
      space_id: SPACE_ID,
      version: 1,
      type: 'page',
      properties: { title: [['Design API']], points: 5 },
      format: {},
      content: [],
      parent_id: tasksCollectionId,
      parent_table: 'collection',
      alive: true,
      created_time: now,
      last_edited_time: now,
      created_by_id: USER_ID,
      last_edited_by_id: USER_ID,
    };

    const task2: Block = {
      id: task2Id,
      space_id: SPACE_ID,
      version: 1,
      type: 'page',
      properties: { title: [['Build Worker']], points: 13 },
      format: {},
      content: [],
      parent_id: tasksCollectionId,
      parent_table: 'collection',
      alive: true,
      created_time: now,
      last_edited_time: now,
      created_by_id: USER_ID,
      last_edited_by_id: USER_ID,
    };

    const projectRow: Block = {
      id: project1Id,
      space_id: SPACE_ID,
      version: 1,
      type: 'page',
      properties: {
        title: [['Phase 9 Launch']],
        tasks_rel: [task1Id, task2Id],
      },
      format: {},
      content: [],
      parent_id: projectsCollectionId,
      parent_table: 'collection',
      alive: true,
      created_time: now,
      last_edited_time: now,
      created_by_id: USER_ID,
      last_edited_by_id: USER_ID,
    };

    const store = new InMemoryRollupStore(
      [tasksCollection, projectsCollection],
      [task1, task2, projectRow],
    );
    const worker = new RollupWorker({ store });

    const res = await worker.process({
      spaceId: SPACE_ID,
      changedRowId: task2Id,
      sourceCollectionId: tasksCollectionId,
    });

    expect(res.updatedRowsCount).toBe(1);
    const updatedProject = store.getBlock(project1Id);
    expect(updatedProject?.properties?.total_points).toBe(18);
    expect(updatedProject?.properties?.avg_points).toBe(9);

    // Re-running without any change is idempotent
    const retryRes = await worker.process({
      spaceId: SPACE_ID,
      changedRowId: task2Id,
      sourceCollectionId: tasksCollectionId,
    });
    expect(retryRes.updatedRowsCount).toBe(0);

    // Direct unit checks on additional aggregations
    expect(computeRollupAggregation([10, 20, 30], 'median')).toBe(20);
    expect(computeRollupAggregation([10, 20, 35], 'range')).toBe(25);
    expect(computeRollupAggregation(['a', 'b', 'a', ''], 'show_unique')).toEqual([
      'a',
      'b',
    ]);
  });

  it('registers all 6 BullMQ queue names and deterministic job IDs', () => {
    expect(ALL_QUEUE_NAMES).toEqual([
      'search-indexing',
      'hierarchy-cascade',
      'rollup-calculator',
      'media-processor',
      'export',
      'import',
    ]);

    const conn = parseRedisConnectionOptions('redis://localhost:6379/2');
    expect(conn).toMatchObject({
      host: 'localhost',
      port: 6379,
      db: 2,
      maxRetriesPerRequest: null,
    });

    expect(
      buildHierarchyCascadeJobId({
        kind: 'soft-delete',
        spaceId: SPACE_ID,
        rootBlockId: makeBlockId(1),
      }),
    ).toBe(`cascade:soft-delete:${SPACE_ID}:${makeBlockId(1)}:false`);

    expect(
      buildSearchIndexingJobId({
        spaceId: SPACE_ID,
        action: 'upsert',
        transactionId: 'tx-42',
      }),
    ).toBe(`search:${SPACE_ID}:upsert:tx-42`);

    expect(
      buildRollupCalculatorJobId({
        spaceId: SPACE_ID,
        changedRowId: makeBlockId(5),
      }),
    ).toBe(`rollup:${SPACE_ID}:${makeBlockId(5)}:all`);
  });
});
