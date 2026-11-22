import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';

import type { UUID } from '@votion/types';

import type { CreateQueueConfig } from './search-indexing.queue.js';

export type PropertyId = string;

export const ROLLUP_CALCULATOR_QUEUE_NAME = 'rollup-calculator' as const;

export interface RollupCalculatorJobData {
  /** Workspace / space containing the collections. */
  spaceId: UUID;
  /** The edited row (page block) whose change triggered rollup recalculation. */
  changedRowId: UUID;
  /** Optional collection ID that owns `changedRowId`. */
  sourceCollectionId?: UUID;
  /** Optional explicit target collection IDs to scope recalculation. */
  targetCollectionIds?: UUID[];
  /** Optional specific rollup property IDs to recompute. */
  rollupPropertyIds?: PropertyId[];
}

export interface RollupUpdateEntry {
  rowId: UUID;
  collectionId: UUID;
  rollupPropertyId: PropertyId;
  value: number | string | string[] | null;
}

export interface RollupCalculatorJobResult {
  changedRowId: UUID;
  updatedRowsCount: number;
  updates: RollupUpdateEntry[];
}

export const DEFAULT_ROLLUP_CALCULATOR_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 500 },
};

export function buildRollupCalculatorJobId(
  data: RollupCalculatorJobData,
): string {
  const propSuffix = data.rollupPropertyIds?.slice().sort().join(',') ?? 'all';
  return `rollup:${data.spaceId}:${data.changedRowId}:${propSuffix}`;
}

export function createRollupCalculatorQueue(
  config: CreateQueueConfig,
): Queue<RollupCalculatorJobData, RollupCalculatorJobResult, string> {
  const queueOptions: QueueOptions = {
    connection: config.connection,
    prefix: config.prefix ?? 'votion',
    defaultJobOptions: {
      ...DEFAULT_ROLLUP_CALCULATOR_JOB_OPTIONS,
      ...config.defaultJobOptions,
    },
  };
  return new Queue<RollupCalculatorJobData, RollupCalculatorJobResult, string>(
    ROLLUP_CALCULATOR_QUEUE_NAME,
    queueOptions,
  );
}
