import { Worker, type ConnectionOptions, type Job, type WorkerOptions } from 'bullmq';

import {
  BatchIndexer,
  transformBlock,
  transformBlockTree,
  type DocumentWriter,
  type TransformContext,
} from '@votion/search';

import {
  SEARCH_INDEXING_QUEUE_NAME,
  type SearchIndexingJobData,
  type SearchIndexingJobResult,
} from '../queues/search-indexing.queue.js';

/**
 * In-memory implementation of `@votion/search`'s {@link DocumentWriter}
 * for testing and offline worker verification.
 */
export class InMemorySearchDocumentWriter implements DocumentWriter {
  private readonly documents = new Map<string, Record<string, unknown>>();
  private taskCounter = 0;

  async upsertDocuments(
    documents: readonly Record<string, unknown>[],
  ): Promise<number | null> {
    if (documents.length === 0) return null;
    for (const doc of documents) {
      const id = typeof doc.id === 'string' ? doc.id : String(doc.id ?? '');
      if (id) {
        this.documents.set(id, structuredClone(doc));
      }
    }
    this.taskCounter += 1;
    return this.taskCounter;
  }

  async deleteDocuments(ids: readonly string[]): Promise<number | null> {
    if (ids.length === 0) return null;
    for (const id of ids) {
      this.documents.delete(id);
    }
    this.taskCounter += 1;
    return this.taskCounter;
  }

  getDocument(id: string): Record<string, unknown> | undefined {
    const doc = this.documents.get(id);
    return doc ? structuredClone(doc) : undefined;
  }

  getAllDocuments(): Record<string, unknown>[] {
    return [...this.documents.values()].map((d) => structuredClone(d));
  }

  get size(): number {
    return this.documents.size;
  }
}

export interface SearchIndexingWorkerOptions {
  writer: DocumentWriter;
  batchSize?: number;
}

/**
 * Consumes block modification events, transforms rich text and block hierarchy
 * into Meilisearch documents via `@votion/search`, and flushes upserts and
 * deletions in idempotent batches.
 */
export class SearchIndexingWorker {
  private readonly writer: DocumentWriter;
  private readonly batchSize: number;

  constructor(options: SearchIndexingWorkerOptions) {
    this.writer = options.writer;
    this.batchSize = Math.max(1, options.batchSize ?? 250);
  }

  async process(data: SearchIndexingJobData): Promise<SearchIndexingJobResult> {
    const indexer = new BatchIndexer(this.writer, {
      batchSize: this.batchSize,
    });

    let skipped = 0;

    if (data.action === 'delete') {
      if (data.deleteBlockIds && data.deleteBlockIds.length > 0) {
        indexer.removeMany(data.deleteBlockIds);
      }
      if (data.blocks && data.blocks.length > 0) {
        indexer.removeMany(data.blocks.map((b) => b.id));
      }
    } else if (data.action === 'sync-tree' && data.blocks && data.blocks.length > 0) {
      const rootId = data.rootPageId ?? data.blocks[0]!.id;
      const treeDocs = transformBlockTree(rootId, data.blocks, {
        spaceId: data.spaceId,
      });
      const indexedIds = new Set(treeDocs.map((d) => d.id));
      indexer.addMany(treeDocs);

      for (const block of data.blocks) {
        if (!indexedIds.has(block.id)) {
          if (!block.alive) {
            indexer.remove(block.id);
          }
          skipped += 1;
        }
      }
      if (data.deleteBlockIds && data.deleteBlockIds.length > 0) {
        indexer.removeMany(data.deleteBlockIds);
      }
    } else {
      const normalizedBreadcrumb = Array.isArray(data.breadcrumb)
        ? data.breadcrumb.join(' / ')
        : data.breadcrumb;
      const context: TransformContext = {
        spaceId: data.spaceId,
        ...(data.rootPageId !== undefined ? { rootPageId: data.rootPageId } : {}),
        ...(normalizedBreadcrumb !== undefined
          ? { breadcrumb: normalizedBreadcrumb }
          : {}),
        ...(data.ancestorIds !== undefined ? { ancestorIds: data.ancestorIds } : {}),
      };

      for (const block of data.blocks ?? []) {
        const transformed = transformBlock(block, context);
        if (transformed.document) {
          indexer.add(transformed.document);
        } else {
          skipped += 1;
          if (transformed.reason === 'deleted' || transformed.reason === 'empty') {
            indexer.remove(block.id);
          }
        }
      }

      if (data.deleteBlockIds && data.deleteBlockIds.length > 0) {
        indexer.removeMany(data.deleteBlockIds);
      }
    }

    const flushResult = await indexer.flush();
    return {
      added: flushResult.added,
      deleted: flushResult.deleted,
      skipped,
      taskUids: flushResult.taskUids,
    };
  }
}

export interface CreateSearchIndexingBullWorkerConfig
  extends SearchIndexingWorkerOptions {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
  workerOptions?: Partial<WorkerOptions>;
}

export function createSearchIndexingBullWorker(
  config: CreateSearchIndexingBullWorkerConfig,
): Worker<SearchIndexingJobData, SearchIndexingJobResult, string> {
  const processor = new SearchIndexingWorker(config);
  return new Worker<SearchIndexingJobData, SearchIndexingJobResult, string>(
    SEARCH_INDEXING_QUEUE_NAME,
    async (job: Job<SearchIndexingJobData, SearchIndexingJobResult, string>) =>
      processor.process(job.data),
    {
      connection: config.connection,
      prefix: config.prefix ?? 'votion',
      concurrency: config.concurrency ?? 4,
      ...config.workerOptions,
    },
  );
}
