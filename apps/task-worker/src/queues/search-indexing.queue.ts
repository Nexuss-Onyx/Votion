import { Queue, type ConnectionOptions, type JobsOptions, type QueueOptions } from 'bullmq';

import type { Block, UUID } from '@votion/types';

export const SEARCH_INDEXING_QUEUE_NAME = 'search-indexing' as const;

export type SearchIndexingAction = 'upsert' | 'delete' | 'sync-tree';

export interface SearchIndexingJobData {
  /** Workspace / space owning the mutated blocks. */
  spaceId: UUID;
  /** Operation type for the search index update. */
  action: SearchIndexingAction;
  /** Optional root page id for breadcrumb & hierarchy context. */
  rootPageId?: UUID;
  /** Breadcrumb trail of ancestor titles for `upsert` jobs. */
  breadcrumb?: string | string[];
  /** Ancestor UUID chain from root down to immediate parent. */
  ancestorIds?: UUID[];
  /** Block snapshots to transform and index (or remove if soft-deleted/empty). */
  blocks?: Block[];
  /** Explicit block IDs to delete from the Meilisearch index. */
  deleteBlockIds?: UUID[];
  /** Optional transaction version or idempotency token. */
  transactionId?: string;
}

export interface SearchIndexingJobResult {
  added: number;
  deleted: number;
  skipped: number;
  taskUids: number[];
}

export const DEFAULT_SEARCH_INDEXING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

export function buildSearchIndexingJobId(data: SearchIndexingJobData): string {
  if (data.transactionId) {
    return `search:${data.spaceId}:${data.action}:${data.transactionId}`;
  }
  const blockKey =
    data.blocks?.map((b) => `${b.id}@${b.version}`).join(',') ||
    data.deleteBlockIds?.join(',') ||
    data.rootPageId ||
    'batch';
  return `search:${data.spaceId}:${data.action}:${blockKey}`;
}

export interface CreateQueueConfig {
  connection: ConnectionOptions;
  prefix?: string;
  defaultJobOptions?: JobsOptions;
}

export function createSearchIndexingQueue(
  config: CreateQueueConfig,
): Queue<SearchIndexingJobData, SearchIndexingJobResult, string> {
  const queueOptions: QueueOptions = {
    connection: config.connection,
    prefix: config.prefix ?? 'votion',
    defaultJobOptions: {
      ...DEFAULT_SEARCH_INDEXING_JOB_OPTIONS,
      ...config.defaultJobOptions,
    },
  };
  return new Queue<SearchIndexingJobData, SearchIndexingJobResult, string>(
    SEARCH_INDEXING_QUEUE_NAME,
    queueOptions,
  );
}
