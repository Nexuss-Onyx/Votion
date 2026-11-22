import { Worker, type ConnectionOptions, type Job, type WorkerOptions } from 'bullmq';

import {
  richTextToPlainText,
  type Block,
  type Collection,
  type CollectionProperty,
  type RichText,
  type RollupAggregation,
  type RollupConfig,
  type UUID,
} from '@votion/types';

import {
  ROLLUP_CALCULATOR_QUEUE_NAME,
  type PropertyId,
  type RollupCalculatorJobData,
  type RollupCalculatorJobResult,
  type RollupUpdateEntry,
} from '../queues/rollup-calculator.queue.js';

export type ComputedRollupValue = number | string | string[] | null;

export interface RollupStore {
  getBlockById(spaceId: UUID, blockId: UUID): Promise<Block | undefined>;
  getBlocksByIds(spaceId: UUID, blockIds: readonly UUID[]): Promise<Block[]>;
  getCollectionsInSpace(spaceId: UUID): Promise<Collection[]>;
  getCollectionRows(spaceId: UUID, collectionId: UUID): Promise<Block[]>;
  /**
   * Idempotently writes computed rollup property values onto a row block.
   * Returns `true` if any rollup value actually changed.
   */
  updateRowRollups(
    spaceId: UUID,
    rowId: UUID,
    values: Readonly<Record<PropertyId, ComputedRollupValue>>,
  ): Promise<boolean>;
}

/**
 * In-memory implementation of {@link RollupStore} for unit tests and offline worker execution.
 */
export class InMemoryRollupStore implements RollupStore {
  private readonly blocks = new Map<UUID, Block>();
  private readonly collections = new Map<UUID, Collection>();

  constructor(
    collections: Iterable<Collection> = [],
    blocks: Iterable<Block> = [],
  ) {
    for (const col of collections) {
      this.collections.set(col.id, structuredClone(col));
    }
    for (const block of blocks) {
      this.blocks.set(block.id, structuredClone(block));
    }
  }

  upsertCollection(collection: Collection): void {
    this.collections.set(collection.id, structuredClone(collection));
  }

  upsertBlock(block: Block): void {
    this.blocks.set(block.id, structuredClone(block));
  }

  getBlock(id: UUID): Block | undefined {
    const b = this.blocks.get(id);
    return b ? structuredClone(b) : undefined;
  }

  async getBlockById(spaceId: UUID, blockId: UUID): Promise<Block | undefined> {
    const block = this.blocks.get(blockId);
    if (!block || block.space_id !== spaceId || !block.alive) return undefined;
    return structuredClone(block);
  }

  async getBlocksByIds(
    spaceId: UUID,
    blockIds: readonly UUID[],
  ): Promise<Block[]> {
    const out: Block[] = [];
    for (const id of blockIds) {
      const block = this.blocks.get(id);
      if (block && block.space_id === spaceId && block.alive) {
        out.push(structuredClone(block));
      }
    }
    return out;
  }

  async getCollectionsInSpace(spaceId: UUID): Promise<Collection[]> {
    const out: Collection[] = [];
    for (const col of this.collections.values()) {
      if (col.space_id === spaceId && col.alive) {
        out.push(structuredClone(col));
      }
    }
    return out;
  }

  async getCollectionRows(
    spaceId: UUID,
    collectionId: UUID,
  ): Promise<Block[]> {
    const out: Block[] = [];
    for (const block of this.blocks.values()) {
      if (
        block.space_id === spaceId &&
        block.alive &&
        block.parent_table === 'collection' &&
        block.parent_id === collectionId
      ) {
        out.push(structuredClone(block));
      }
    }
    return out;
  }

  async updateRowRollups(
    spaceId: UUID,
    rowId: UUID,
    values: Readonly<Record<PropertyId, ComputedRollupValue>>,
  ): Promise<boolean> {
    const block = this.blocks.get(rowId);
    if (!block || block.space_id !== spaceId) return false;

    const props: Record<string, unknown> = { ...(block.properties ?? {}) };
    let changed = false;

    for (const [propId, nextVal] of Object.entries(values)) {
      const prevVal = props[propId];
      if (!areRollupValuesEqual(prevVal, nextVal)) {
        props[propId] = nextVal;
        changed = true;
      }
    }

    if (changed) {
      block.properties = props as Block['properties'];
      block.version += 1;
      block.last_edited_time = Date.now();
    }

    return changed;
  }
}

function areRollupValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, idx) => Object.is(item, b[idx]));
  }
  return false;
}

/**
 * Extracts target row UUIDs from a relation property value stored in `block.properties`.
 * Supports direct UUID arrays (`['id1', 'id2']`), RichText page mentions
 * (`[['‣', [['p', 'id1']]]]`), and plain RichText segments (`[['id1'], ['id2']]`).
 */
export function extractRelationTargetIds(rawValue: unknown): UUID[] {
  if (!rawValue) return [];
  if (typeof rawValue === 'string') {
    return rawValue.trim() ? [rawValue.trim()] : [];
  }
  if (!Array.isArray(rawValue)) return [];

  const ids = new Set<UUID>();
  for (const item of rawValue) {
    if (typeof item === 'string' && item.trim()) {
      ids.add(item.trim());
    } else if (Array.isArray(item)) {
      const [text, modifiers] = item as [unknown, unknown];
      if (Array.isArray(modifiers)) {
        for (const mod of modifiers) {
          if (
            Array.isArray(mod) &&
            mod[0] === 'p' &&
            typeof mod[1] === 'string' &&
            mod[1].trim()
          ) {
            ids.add(mod[1].trim());
          }
        }
      }
      if (typeof text === 'string' && text !== '‣' && text.trim()) {
        for (const part of text.split(',')) {
          const trimmed = part.trim();
          if (trimmed) ids.add(trimmed);
        }
      }
    }
  }

  return [...ids];
}

function extractRawPropertyScalar(rawValue: unknown): string | number | boolean | null {
  if (rawValue === null || rawValue === undefined) return null;
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue) ? rawValue : null;
  }
  if (typeof rawValue === 'boolean') return rawValue;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(rawValue)) {
    // Check if it looks like RichText (`[[text, modifiers?], ...]`)
    if (rawValue.length === 0) return null;
    if (rawValue.every((seg) => Array.isArray(seg) && typeof seg[0] === 'string')) {
      const plain = richTextToPlainText(rawValue as RichText).trim();
      return plain.length > 0 ? plain : null;
    }
    const joined = rawValue
      .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '')))
      .filter((s) => s.length > 0)
      .join(', ');
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function coerceFiniteNumber(val: string | number | boolean | null): number | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[,$€£¥₹%\s]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceTimestamp(val: string | number | boolean | null): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Pure aggregation evaluator implementing all {@link RollupAggregation} functions
 * defined in `@votion/types`.
 */
export function computeRollupAggregation(
  rawValues: readonly unknown[],
  aggregation: RollupAggregation,
): ComputedRollupValue {
  const totalCount = rawValues.length;
  const scalars = rawValues.map(extractRawPropertyScalar);
  const nonEmptyScalars = scalars.filter(
    (v): v is string | number | boolean => v !== null && v !== '',
  );
  const emptyCount = totalCount - nonEmptyScalars.length;

  switch (aggregation) {
    case 'count':
    case 'count_all':
      return totalCount;
    case 'count_empty':
      return emptyCount;
    case 'count_not_empty':
      return nonEmptyScalars.length;
    case 'count_unique':
      return new Set(nonEmptyScalars.map((v) => String(v))).size;
    case 'percent_empty':
      return totalCount === 0
        ? 0
        : Number(((emptyCount / totalCount) * 100).toFixed(2));
    case 'percent_not_empty':
      return totalCount === 0
        ? 0
        : Number(((nonEmptyScalars.length / totalCount) * 100).toFixed(2));
    case 'show_original':
      return nonEmptyScalars.map((v) => String(v));
    case 'show_unique':
      return [...new Set(nonEmptyScalars.map((v) => String(v)))];
    case 'sum': {
      const nums = nonEmptyScalars
        .map(coerceFiniteNumber)
        .filter((n): n is number => n !== null);
      return nums.reduce((acc, n) => acc + n, 0);
    }
    case 'average': {
      const nums = nonEmptyScalars
        .map(coerceFiniteNumber)
        .filter((n): n is number => n !== null);
      if (nums.length === 0) return null;
      const sum = nums.reduce((acc, n) => acc + n, 0);
      return Number((sum / nums.length).toFixed(4));
    }
    case 'median': {
      const nums = nonEmptyScalars
        .map(coerceFiniteNumber)
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b);
      if (nums.length === 0) return null;
      const mid = Math.floor(nums.length / 2);
      return nums.length % 2 === 1
        ? nums[mid]!
        : Number(((nums[mid - 1]! + nums[mid]!) / 2).toFixed(4));
    }
    case 'min': {
      const nums = nonEmptyScalars
        .map(coerceFiniteNumber)
        .filter((n): n is number => n !== null);
      return nums.length === 0 ? null : Math.min(...nums);
    }
    case 'max': {
      const nums = nonEmptyScalars
        .map(coerceFiniteNumber)
        .filter((n): n is number => n !== null);
      return nums.length === 0 ? null : Math.max(...nums);
    }
    case 'range': {
      const nums = nonEmptyScalars
        .map(coerceFiniteNumber)
        .filter((n): n is number => n !== null);
      if (nums.length === 0) return null;
      return Math.max(...nums) - Math.min(...nums);
    }
    case 'earliest_date': {
      const dates = nonEmptyScalars
        .map(coerceTimestamp)
        .filter((t): t is number => t !== null);
      return dates.length === 0 ? null : new Date(Math.min(...dates)).toISOString();
    }
    case 'latest_date': {
      const dates = nonEmptyScalars
        .map(coerceTimestamp)
        .filter((t): t is number => t !== null);
      return dates.length === 0 ? null : new Date(Math.max(...dates)).toISOString();
    }
    case 'date_range': {
      const dates = nonEmptyScalars
        .map(coerceTimestamp)
        .filter((t): t is number => t !== null);
      if (dates.length === 0) return null;
      return Math.max(...dates) - Math.min(...dates);
    }
  }
}

function resolveRollupConfig(property: CollectionProperty): RollupConfig | null {
  if (property.type !== 'rollup') return null;
  if (property.rollup) return property.rollup;
  if (property.relation_property_id && property.target_property_id) {
    return {
      relation_property_id: property.relation_property_id,
      target_property_id: property.target_property_id,
      aggregation: 'show_original',
    };
  }
  return null;
}

export interface RollupWorkerOptions {
  store: RollupStore;
}

/**
 * Finds all database rows referencing an edited page through a `relation`
 * property and recomputes their dependent `rollup` properties idempotently.
 */
export class RollupWorker {
  private readonly store: RollupStore;

  constructor(options: RollupWorkerOptions) {
    this.store = options.store;
  }

  async process(data: RollupCalculatorJobData): Promise<RollupCalculatorJobResult> {
    const changedRow = await this.store.getBlockById(
      data.spaceId,
      data.changedRowId,
    );
    const sourceCollectionId =
      data.sourceCollectionId ??
      (changedRow?.parent_table === 'collection' ? changedRow.parent_id : undefined);

    const allCollections = await this.store.getCollectionsInSpace(data.spaceId);
    const targetCollectionFilter = data.targetCollectionIds
      ? new Set(data.targetCollectionIds)
      : null;
    const rollupPropFilter = data.rollupPropertyIds
      ? new Set(data.rollupPropertyIds)
      : null;

    const updates: RollupUpdateEntry[] = [];
    let updatedRowsCount = 0;

    for (const collection of allCollections) {
      if (targetCollectionFilter && !targetCollectionFilter.has(collection.id)) {
        continue;
      }

      // Collect rollup properties on this collection
      const rollupEntries: Array<{
        rollupPropId: PropertyId;
        config: RollupConfig;
      }> = [];

      for (const [propId, propDef] of Object.entries(collection.schema)) {
        if (rollupPropFilter && !rollupPropFilter.has(propId)) continue;
        const config = resolveRollupConfig(propDef);
        if (!config) continue;

        const relationDef = collection.schema[config.relation_property_id];
        if (!relationDef || relationDef.type !== 'relation') continue;

        const targetColId =
          relationDef.relation?.collection_id ?? relationDef.collection_id;
        if (
          sourceCollectionId &&
          targetColId &&
          targetColId !== sourceCollectionId
        ) {
          continue;
        }

        rollupEntries.push({ rollupPropId: propId, config });
      }

      if (rollupEntries.length === 0) continue;

      const rows = await this.store.getCollectionRows(data.spaceId, collection.id);

      for (const row of rows) {
        const props = (row.properties ?? {}) as Record<string, unknown>;

        // Check if this row references `changedRowId` via any relevant relation property
        const relevantRollups = rollupEntries.filter(({ config }) => {
          const relatedIds = extractRelationTargetIds(
            props[config.relation_property_id],
          );
          return relatedIds.includes(data.changedRowId);
        });

        if (relevantRollups.length === 0) continue;

        const computedForRow: Record<PropertyId, ComputedRollupValue> = {};

        for (const { rollupPropId, config } of relevantRollups) {
          const relatedIds = extractRelationTargetIds(
            props[config.relation_property_id],
          );
          const relatedBlocks = await this.store.getBlocksByIds(
            data.spaceId,
            relatedIds,
          );
          // Preserve order of `relatedIds`
          const blockById = new Map(relatedBlocks.map((b) => [b.id, b]));
          const targetValues: unknown[] = [];
          for (const relId of relatedIds) {
            const relBlock = blockById.get(relId);
            if (!relBlock) continue;
            const relProps = (relBlock.properties ?? {}) as Record<string, unknown>;
            targetValues.push(relProps[config.target_property_id]);
          }

          const value = computeRollupAggregation(
            targetValues,
            config.aggregation,
          );
          computedForRow[rollupPropId] = value;
          updates.push({
            rowId: row.id,
            collectionId: collection.id,
            rollupPropertyId: rollupPropId,
            value,
          });
        }

        const changed = await this.store.updateRowRollups(
          data.spaceId,
          row.id,
          computedForRow,
        );
        if (changed) {
          updatedRowsCount += 1;
        }
      }
    }

    return {
      changedRowId: data.changedRowId,
      updatedRowsCount,
      updates,
    };
  }
}

export interface CreateRollupBullWorkerConfig extends RollupWorkerOptions {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
  workerOptions?: Partial<WorkerOptions>;
}

export function createRollupBullWorker(
  config: CreateRollupBullWorkerConfig,
): Worker<RollupCalculatorJobData, RollupCalculatorJobResult, string> {
  const processor = new RollupWorker(config);
  return new Worker<RollupCalculatorJobData, RollupCalculatorJobResult, string>(
    ROLLUP_CALCULATOR_QUEUE_NAME,
    async (job: Job<RollupCalculatorJobData, RollupCalculatorJobResult, string>) =>
      processor.process(job.data),
    {
      connection: config.connection,
      prefix: config.prefix ?? 'votion',
      concurrency: config.concurrency ?? 4,
      ...config.workerOptions,
    },
  );
}
