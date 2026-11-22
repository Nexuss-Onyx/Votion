import { fileURLToPath } from 'node:url';
import type { Worker } from 'bullmq';

import { createDatabaseFromEnv, type DatabaseHandle } from '@votion/db';
import { MeiliSearchClient, type DocumentWriter } from '@votion/search';

import { loadConfig, type TaskWorkerConfig } from './config.js';
import {
  ALL_QUEUE_NAMES,
  createTaskWorkerQueues,
  parseRedisConnectionOptions,
  type TaskWorkerQueues,
} from './queues/index.js';
import {
  InMemoryObjectStorage,
  type ObjectStorageAdapter,
} from './storage.js';
import {
  createExportBullWorker,
  createHierarchyCascadeBullWorker,
  createImportBullWorker,
  createMediaProcessorBullWorker,
  createRollupBullWorker,
  createSearchIndexingBullWorker,
  DatabaseHierarchyCascadeStore,
  InMemoryHierarchyCascadeStore,
  InMemoryRollupStore,
  InMemorySearchDocumentWriter,
  type HierarchyCascadeStore,
  type RollupStore,
} from './workers/index.js';

export * from './config.js';
export * from './storage.js';
export * from './queues/index.js';
export * from './workers/index.js';

export interface TaskWorkerFleetDependencies {
  cascadeStore?: HierarchyCascadeStore;
  searchWriter?: DocumentWriter;
  rollupStore?: RollupStore;
  storage?: ObjectStorageAdapter;
}

export interface TaskWorkerFleetHandle {
  readonly config: TaskWorkerConfig;
  readonly queues: TaskWorkerQueues;
  readonly workers: readonly Worker[];
  close(): Promise<void>;
}

/**
 * Starts the BullMQ worker fleet across all 6 Phase 9 queues (`search-indexing`,
 * `hierarchy-cascade`, `rollup-calculator`, `media-processor`, `export`, `import`)
 * and returns a handle that drains and closes all workers and queues cleanly on
 * `SIGTERM` / `SIGINT`.
 */
export function startTaskWorkerFleet(
  config: TaskWorkerConfig = loadConfig(),
  deps: TaskWorkerFleetDependencies = {},
): TaskWorkerFleetHandle {
  const connection = parseRedisConnectionOptions(config.redisUrl);
  const queues = createTaskWorkerQueues({
    connection,
    prefix: config.queuePrefix,
  });

  let dbHandle: DatabaseHandle | undefined;
  if (!deps.cascadeStore && config.databaseUrl) {
    dbHandle = createDatabaseFromEnv({ DATABASE_URL: config.databaseUrl });
  }

  const cascadeStore: HierarchyCascadeStore =
    deps.cascadeStore ??
    (dbHandle
      ? new DatabaseHierarchyCascadeStore(dbHandle.db)
      : new InMemoryHierarchyCascadeStore());

  const searchWriter: DocumentWriter =
    deps.searchWriter ??
    (config.meilisearchHost
      ? new MeiliSearchClient({
          host: config.meilisearchHost,
          ...(config.meilisearchApiKey !== undefined
            ? { apiKey: config.meilisearchApiKey }
            : {}),
        })
      : new InMemorySearchDocumentWriter());

  const rollupStore: RollupStore = deps.rollupStore ?? new InMemoryRollupStore();

  const storage: ObjectStorageAdapter =
    deps.storage ??
    new InMemoryObjectStorage({
      bucket: config.s3Bucket,
      publicBaseUrl: config.s3PublicBaseUrl,
    });

  const hierarchyWorker = createHierarchyCascadeBullWorker({
    connection,
    prefix: config.queuePrefix,
    concurrency: config.workerConcurrency,
    defaultBatchSize: config.cascadeBatchSize,
    store: cascadeStore,
    onBlocksSoftDeleted: async (spaceId, blockIds) => {
      await queues.searchIndexing.add('cascade-purge', {
        spaceId,
        action: 'delete',
        deleteBlockIds: blockIds,
      });
    },
  });

  const searchWorker = createSearchIndexingBullWorker({
    connection,
    prefix: config.queuePrefix,
    concurrency: config.workerConcurrency,
    writer: searchWriter,
  });

  const rollupWorker = createRollupBullWorker({
    connection,
    prefix: config.queuePrefix,
    concurrency: config.workerConcurrency,
    store: rollupStore,
  });

  const mediaWorker = createMediaProcessorBullWorker({
    connection,
    prefix: config.queuePrefix,
    concurrency: Math.max(1, Math.floor(config.workerConcurrency / 2)),
    storage,
  });

  const exportWorker = createExportBullWorker({
    connection,
    prefix: config.queuePrefix,
    concurrency: Math.max(1, Math.floor(config.workerConcurrency / 2)),
    storage,
    defaultExpiresInSeconds: config.exportUrlExpiresInSeconds,
    ...(config.chromiumExecutablePath !== undefined
      ? { chromiumExecutablePath: config.chromiumExecutablePath }
      : {}),
  });

  const importWorker = createImportBullWorker({
    connection,
    prefix: config.queuePrefix,
    concurrency: Math.max(1, Math.floor(config.workerConcurrency / 2)),
  });

  const workers: readonly Worker[] = [
    hierarchyWorker,
    searchWorker,
    rollupWorker,
    mediaWorker,
    exportWorker,
    importWorker,
  ];

  let closed = false;
  return {
    config,
    queues,
    workers,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await Promise.all(workers.map((w) => w.close()));
      await queues.closeAll();
      if (dbHandle) {
        await dbHandle.close();
      }
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const fleet = startTaskWorkerFleet(config);

  console.warn(
    `[@votion/task-worker] started ${fleet.workers.length} BullMQ workers for queues: ${ALL_QUEUE_NAMES.join(', ')}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.warn(`[@votion/task-worker] received ${signal}, draining workers...`);
    try {
      await fleet.close();
      process.exit(0);
    } catch (err) {
      console.error('[@votion/task-worker] error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
  void main();
}
