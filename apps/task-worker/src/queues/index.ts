import type { ConnectionOptions } from 'bullmq';

import {
  EXPORT_QUEUE_NAME,
  createExportQueue,
  type ExportJobData,
  type ExportJobResult,
} from './export.queue.js';
import {
  HIERARCHY_CASCADE_QUEUE_NAME,
  createHierarchyCascadeQueue,
  type HierarchyCascadeJobData,
  type HierarchyCascadeJobResult,
} from './hierarchy-cascade.queue.js';
import {
  IMPORT_QUEUE_NAME,
  createImportQueue,
  type ImportJobData,
  type ImportJobResult,
} from './import.queue.js';
import {
  MEDIA_PROCESSOR_QUEUE_NAME,
  createMediaProcessorQueue,
  type MediaProcessorJobData,
  type MediaProcessorJobResult,
} from './media-processor.queue.js';
import {
  ROLLUP_CALCULATOR_QUEUE_NAME,
  createRollupCalculatorQueue,
  type RollupCalculatorJobData,
  type RollupCalculatorJobResult,
} from './rollup-calculator.queue.js';
import {
  SEARCH_INDEXING_QUEUE_NAME,
  createSearchIndexingQueue,
  type CreateQueueConfig,
  type SearchIndexingJobData,
  type SearchIndexingJobResult,
} from './search-indexing.queue.js';

export * from './search-indexing.queue.js';
export * from './hierarchy-cascade.queue.js';
export * from './rollup-calculator.queue.js';
export * from './media-processor.queue.js';
export * from './export.queue.js';
export * from './import.queue.js';

export const ALL_QUEUE_NAMES = [
  SEARCH_INDEXING_QUEUE_NAME,
  HIERARCHY_CASCADE_QUEUE_NAME,
  ROLLUP_CALCULATOR_QUEUE_NAME,
  MEDIA_PROCESSOR_QUEUE_NAME,
  EXPORT_QUEUE_NAME,
  IMPORT_QUEUE_NAME,
] as const;

export type QueueName = (typeof ALL_QUEUE_NAMES)[number];

/**
 * Parses a `redis://` or `rediss://` URL into BullMQ `ConnectionOptions` with
 * `maxRetriesPerRequest: null` as required by BullMQ blocking consumers.
 */
export function parseRedisConnectionOptions(
  redisUrl: string,
): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const isTls = parsed.protocol === 'rediss:';
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 6379;
  const dbPath = parsed.pathname.replace(/^\/+/, '');
  const db = dbPath ? Number.parseInt(dbPath, 10) : 0;

  return {
    host: parsed.hostname || '127.0.0.1',
    port: Number.isFinite(port) ? port : 6379,
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    ...(Number.isFinite(db) && db > 0 ? { db } : {}),
    ...(isTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export interface TaskWorkerQueues {
  searchIndexing: ReturnType<typeof createSearchIndexingQueue>;
  hierarchyCascade: ReturnType<typeof createHierarchyCascadeQueue>;
  rollupCalculator: ReturnType<typeof createRollupCalculatorQueue>;
  mediaProcessor: ReturnType<typeof createMediaProcessorQueue>;
  exportQueue: ReturnType<typeof createExportQueue>;
  importQueue: ReturnType<typeof createImportQueue>;
  closeAll(): Promise<void>;
}

export function createTaskWorkerQueues(
  config: CreateQueueConfig,
): TaskWorkerQueues {
  const searchIndexing = createSearchIndexingQueue(config);
  const hierarchyCascade = createHierarchyCascadeQueue(config);
  const rollupCalculator = createRollupCalculatorQueue(config);
  const mediaProcessor = createMediaProcessorQueue(config);
  const exportQueue = createExportQueue(config);
  const importQueue = createImportQueue(config);

  return {
    searchIndexing,
    hierarchyCascade,
    rollupCalculator,
    mediaProcessor,
    exportQueue,
    importQueue,
    async closeAll(): Promise<void> {
      await Promise.all([
        searchIndexing.close(),
        hierarchyCascade.close(),
        rollupCalculator.close(),
        mediaProcessor.close(),
        exportQueue.close(),
        importQueue.close(),
      ]);
    },
  };
}

export type AnyTaskWorkerJobData =
  | SearchIndexingJobData
  | HierarchyCascadeJobData
  | RollupCalculatorJobData
  | MediaProcessorJobData
  | ExportJobData
  | ImportJobData;

export type AnyTaskWorkerJobResult =
  | SearchIndexingJobResult
  | HierarchyCascadeJobResult
  | RollupCalculatorJobResult
  | MediaProcessorJobResult
  | ExportJobResult
  | ImportJobResult;
