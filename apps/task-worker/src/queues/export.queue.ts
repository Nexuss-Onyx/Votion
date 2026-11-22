import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';

import type { Block, Collection, UUID } from '@votion/types';

import type { CreateQueueConfig } from './search-indexing.queue.js';

export const EXPORT_QUEUE_NAME = 'export' as const;

export type ExportFormat = 'markdown-csv-zip' | 'pdf';

export interface ExportJobData {
  /** Unique export job identifier used to build the deterministic S3 key. */
  exportId: string;
  spaceId: UUID;
  rootPageId: UUID;
  requestedBy: UUID;
  format: ExportFormat;
  /** Include nested sub-pages in the export bundle (defaults to true). */
  includeSubpages?: boolean;
  /** Optional inline blocks snapshot (otherwise loaded from the block store). */
  blocks?: Block[];
  /** Optional inline collections snapshot for CSV generation. */
  collections?: Collection[];
  /** Expiration time in seconds for the generated download URL (default 3600). */
  expiresInSeconds?: number;
}

export interface ExportFileEntry {
  path: string;
  contentType: 'text/markdown' | 'text/csv' | 'application/pdf';
  content: string | Buffer;
}

export interface ExportJobResult {
  exportId: string;
  format: ExportFormat;
  objectKey: string;
  downloadUrl: string;
  sizeBytes: number;
  filePaths: string[];
}

export const DEFAULT_EXPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 250 },
};

export function buildExportJobId(data: ExportJobData): string {
  return `export:${data.spaceId}:${data.exportId}:${data.format}`;
}

export function createExportQueue(
  config: CreateQueueConfig,
): Queue<ExportJobData, ExportJobResult, string> {
  const queueOptions: QueueOptions = {
    connection: config.connection,
    prefix: config.prefix ?? 'votion',
    defaultJobOptions: {
      ...DEFAULT_EXPORT_JOB_OPTIONS,
      ...config.defaultJobOptions,
    },
  };
  return new Queue<ExportJobData, ExportJobResult, string>(
    EXPORT_QUEUE_NAME,
    queueOptions,
  );
}
