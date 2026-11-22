import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';

import type { Block, Collection, UUID } from '@votion/types';

import type { CreateQueueConfig } from './search-indexing.queue.js';

export const IMPORT_QUEUE_NAME = 'import' as const;

export type ImportSourceFormat = 'markdown' | 'html' | 'csv';

export interface ImportJobData {
  /** Deterministic import batch ID for idempotence. */
  importId: string;
  spaceId: UUID;
  /** Parent page or workspace ID under which the imported page/database is attached. */
  parentId: UUID;
  parentTable?: 'block' | 'space' | 'collection';
  createdBy: UUID;
  format: ImportSourceFormat;
  /** Optional explicit title for the root page or imported collection. */
  title?: string;
  /** Raw UTF-8 document content (Markdown, HTML, or CSV). */
  content: string;
}

export interface ImportJobResult {
  importId: string;
  format: ImportSourceFormat;
  rootBlockId: UUID;
  blocks: Block[];
  collection?: Collection;
}

export const DEFAULT_IMPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

export function buildImportJobId(data: ImportJobData): string {
  return `import:${data.spaceId}:${data.importId}:${data.format}`;
}

export function createImportQueue(
  config: CreateQueueConfig,
): Queue<ImportJobData, ImportJobResult, string> {
  const queueOptions: QueueOptions = {
    connection: config.connection,
    prefix: config.prefix ?? 'votion',
    defaultJobOptions: {
      ...DEFAULT_IMPORT_JOB_OPTIONS,
      ...config.defaultJobOptions,
    },
  };
  return new Queue<ImportJobData, ImportJobResult, string>(
    IMPORT_QUEUE_NAME,
    queueOptions,
  );
}
