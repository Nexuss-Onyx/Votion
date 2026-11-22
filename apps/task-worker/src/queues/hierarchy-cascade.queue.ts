import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';

import type { PermissionRole, PrincipalType, UUID } from '@votion/types';

import type { CreateQueueConfig } from './search-indexing.queue.js';

export const HIERARCHY_CASCADE_QUEUE_NAME = 'hierarchy-cascade' as const;

export interface PermissionOverrideRule {
  principalType: PrincipalType;
  principalId: UUID | null;
  role: PermissionRole;
}

export type HierarchyCascadeJobData =
  | {
      kind: 'soft-delete';
      spaceId: UUID;
      rootBlockId: UUID;
      /** Target `alive` state (defaults to `false` for soft-deletion). */
      alive?: boolean;
      /** User who initiated the deletion. */
      actorId?: UUID;
      /** Optional batch size override (defaults to 500). */
      batchSize?: number;
    }
  | {
      kind: 'permission-cascade';
      spaceId: UUID;
      workspaceId: UUID;
      rootBlockId: UUID;
      overrides: PermissionOverrideRule[];
      /** If true, replaces existing descendant block permission overrides. */
      replaceExisting?: boolean;
      batchSize?: number;
    };

export interface HierarchyCascadeJobResult {
  kind: HierarchyCascadeJobData['kind'];
  rootBlockId: UUID;
  visitedCount: number;
  updatedCount: number;
  batchCount: number;
  updatedBlockIds: UUID[];
}

export const DEFAULT_HIERARCHY_CASCADE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: { count: 250 },
  removeOnFail: { count: 500 },
};

export function buildHierarchyCascadeJobId(
  data: HierarchyCascadeJobData,
): string {
  if (data.kind === 'soft-delete') {
    const targetState = data.alive ?? false;
    return `cascade:soft-delete:${data.spaceId}:${data.rootBlockId}:${String(targetState)}`;
  }
  const rulesKey = data.overrides
    .map((r) => `${r.principalType}:${r.principalId ?? 'public'}:${r.role}`)
    .sort()
    .join('|');
  return `cascade:perm:${data.spaceId}:${data.rootBlockId}:${rulesKey}`;
}

export function createHierarchyCascadeQueue(
  config: CreateQueueConfig,
): Queue<HierarchyCascadeJobData, HierarchyCascadeJobResult, string> {
  const queueOptions: QueueOptions = {
    connection: config.connection,
    prefix: config.prefix ?? 'votion',
    defaultJobOptions: {
      ...DEFAULT_HIERARCHY_CASCADE_JOB_OPTIONS,
      ...config.defaultJobOptions,
    },
  };
  return new Queue<HierarchyCascadeJobData, HierarchyCascadeJobResult, string>(
    HIERARCHY_CASCADE_QUEUE_NAME,
    queueOptions,
  );
}
