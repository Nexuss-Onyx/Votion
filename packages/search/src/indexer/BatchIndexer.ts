/**
 * Batched ingestion into Meilisearch.
 *
 * The worker fleet calls {@link BatchIndexer} from `SearchIndexingWorker`; the
 * modal never touches it. Two rules keep the index consistent:
 *
 *  1. **Last write wins per id.** Enqueueing the same block twice in one batch
 *     keeps only the newest document, so a burst of edits cannot reorder the
 *     applied state.
 *  2. **Skips become deletions.** `transformBlock()` returns `null` for
 *     soft-deleted, empty and non-indexable blocks; those ids are queued for
 *     deletion instead of being silently dropped, otherwise a page deleted
 *     while offline would keep matching forever.
 */

import type { Block, UUID } from '@votion/types';

import {
  transformBlock,
  transformBlockTree,
  type TransformContext,
} from './DocumentTransformer.js';
import type { SearchDocument } from '../types.js';

/** Narrow writer contract implemented by `MeiliSearchClient`. */
export interface DocumentWriter {
  upsertDocuments(
    documents: readonly Record<string, unknown>[],
  ): Promise<number | null>;
  deleteDocuments(ids: readonly string[]): Promise<number | null>;
}

/** Result of one flush. */
export interface FlushResult {
  added: number;
  deleted: number;
  /** Meilisearch task uids, in the order the tasks were enqueued. */
  taskUids: number[];
}

/** Options for {@link BatchIndexer}. */
export interface BatchIndexerOptions {
  /** Documents per request (Meilisearch is happiest around 500–1000). */
  batchSize?: number;
  /** Maximum ids pending before an automatic flush. */
  maxPending?: number;
  /** Auto-flush callback (invoked with the resolved result, errors swallowed). */
  onFlush?(result: FlushResult): void;
  /** Error hook (auto-flush failures). */
  onError?(error: unknown): void;
}

/** Projects a document onto the exact Meilisearch payload (no `undefined`). */
export function toIndexPayload(
  document: SearchDocument,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: document.id,
    space_id: document.space_id,
    parent_id: document.parent_id,
    root_page_id: document.root_page_id,
    type: document.type,
    title: document.title,
    plain_text: document.plain_text,
    created_by: document.created_by,
    last_edited_time: document.last_edited_time,
    ancestor_ids: [...document.ancestor_ids],
    access_principals: [...document.access_principals],
    alive: document.alive,
  };
  if (document.breadcrumb !== undefined) {
    payload.breadcrumb = document.breadcrumb;
  }
  return payload;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_PENDING = 5_000;

/**
 * Buffers documents and deletions, flushing in fixed-size chunks.
 *
 * ```ts
 * const indexer = new BatchIndexer(client, { batchSize: 200 });
 * for (const block of changedBlocks) indexer.queueBlock(block, { rootPageId });
 * await indexer.flush();
 * ```
 */
export class BatchIndexer {
  private readonly writer: DocumentWriter;
  private readonly batchSize: number;
  private readonly maxPending: number;
  private readonly onFlush?: (result: FlushResult) => void;
  private readonly onError?: (error: unknown) => void;

  /** Pending upserts, keyed by document id (insertion order preserved). */
  private readonly pendingDocuments = new Map<string, SearchDocument>();
  /** Pending deletions. */
  private readonly pendingDeletions = new Set<string>();

  constructor(writer: DocumentWriter, options: BatchIndexerOptions = {}) {
    this.writer = writer;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    this.maxPending = Math.max(
      this.batchSize,
      options.maxPending ?? DEFAULT_MAX_PENDING,
    );
    if (options.onFlush) {
      this.onFlush = options.onFlush;
    }
    if (options.onError) {
      this.onError = options.onError;
    }
  }

  /** Number of documents + deletions waiting to be written. */
  get pending(): number {
    return this.pendingDocuments.size + this.pendingDeletions.size;
  }

  /** Queues a transformed document. */
  add(document: SearchDocument): this {
    // An upsert always supersedes a queued deletion of the same id.
    this.pendingDeletions.delete(document.id);
    this.pendingDocuments.set(document.id, document);
    this.maybeAutoFlush();
    return this;
  }

  /** Queues documents. */
  addMany(documents: Iterable<SearchDocument>): this {
    for (const document of documents) {
      this.add(document);
    }
    return this;
  }

  /** Queues a removal. An id queued for deletion is dropped from the upserts. */
  remove(id: UUID | string): this {
    this.pendingDocuments.delete(id);
    this.pendingDeletions.add(id);
    this.maybeAutoFlush();
    return this;
  }

  /** Queues removals. */
  removeMany(ids: Iterable<UUID | string>): this {
    for (const id of ids) {
      this.remove(id);
    }
    return this;
  }

  /**
   * Transforms and queues one block: either an upsert, or a deletion when the
   * block is no longer indexable.
   */
  queueBlock(block: Block, context: TransformContext = {}): this {
    const result = transformBlock(block, context);
    if (result.document) {
      this.add(result.document);
    } else if (result.reason === 'deleted' || result.reason === 'empty') {
      this.remove(block.id);
    }
    // `not-indexable` blocks (column, divider, template) are neither indexed nor
    // deleted: they never produced a document in the first place.
    return this;
  }

  /** Transforms and queues an entire page sub-tree. */
  queueBlockTree(
    rootId: UUID,
    blocks: ReadonlyMap<UUID, Block> | readonly Block[],
    context: TransformContext = {},
  ): this {
    this.addMany(
      transformBlockTree(rootId, blocks, {
        ...(context.spaceId !== undefined ? { spaceId: context.spaceId } : {}),
      }),
    );
    return this;
  }

  /**
   * Writes everything that is pending, in `batchSize` chunks.
   *
   * Awaits each task so a failure is attributable to a specific chunk; the
   * buffers are cleared progressively so a mid-flush crash does not replay
   * already-applied documents.
   */
  async flush(): Promise<FlushResult> {
    let added = 0;
    let deleted = 0;
    const taskUids: number[] = [];

    while (this.pendingDocuments.size > 0) {
      const chunk: SearchDocument[] = [];
      for (const [id, document] of this.pendingDocuments) {
        chunk.push(document);
        this.pendingDocuments.delete(id);
        if (chunk.length >= this.batchSize) {
          break;
        }
      }
      const uid = await this.writer.upsertDocuments(chunk.map(toIndexPayload));
      if (uid !== null) {
        taskUids.push(uid);
      }
      added += chunk.length;
    }

    while (this.pendingDeletions.size > 0) {
      const chunk: string[] = [];
      for (const id of this.pendingDeletions) {
        chunk.push(id);
        this.pendingDeletions.delete(id);
        if (chunk.length >= this.batchSize) {
          break;
        }
      }
      const uid = await this.writer.deleteDocuments(chunk);
      if (uid !== null) {
        taskUids.push(uid);
      }
      deleted += chunk.length;
    }

    const result: FlushResult = { added, deleted, taskUids };
    this.onFlush?.(result);
    return result;
  }

  /** Drops everything pending without writing (shutdown / failed job). */
  discard(): void {
    this.pendingDocuments.clear();
    this.pendingDeletions.clear();
  }

  private maybeAutoFlush(): void {
    if (this.pending < this.maxPending) {
      return;
    }
    void this.flush().catch((error: unknown) => {
      this.onError?.(error);
    });
  }
}
