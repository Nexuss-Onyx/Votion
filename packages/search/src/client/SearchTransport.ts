/**
 * Transport contracts.
 *
 * The search pipeline is split so that only `MeiliSearchClient` knows about the
 * `meilisearch` SDK. Everything upstream — query building, hit hydration, the
 * modal controller — depends on the narrow {@link SearchExecutor} interface and
 * can be unit-tested with a fake.
 */

import type { SearchDocument } from '../types.js';
import type { MeiliSearchOptions } from '../query/QuickFindQueryBuilder.js';

/** A raw hit as returned by Meilisearch, including `_formatted` highlights. */
export interface RawSearchHit extends Partial<SearchDocument> {
  _formatted?: Record<string, unknown>;
  _rankingScore?: number;
}

/** The subset of Meilisearch's search response that Votion consumes. */
export interface RawSearchResponse {
  hits: RawSearchHit[];
  /** Present with offset/limit pagination (the Quick Find default). */
  estimatedTotalHits?: number;
  /** Present with page/hitsPerPage pagination. */
  totalHits?: number;
  processingTimeMs: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

/** Per-request options that are not part of the search query. */
export interface SearchRequestInit {
  /** Abort signal used to cancel superseded keystrokes. */
  signal?: AbortSignal;
}

/** Executes a search against one index. */
export interface SearchExecutor {
  /** Index the executor is bound to (diagnostics + telemetry). */
  readonly indexUid: string;
  execute(
    query: string,
    options: MeiliSearchOptions,
    requestInit?: SearchRequestInit,
  ): Promise<RawSearchResponse>;
}

/** Structural view of an enqueued Meilisearch task. */
export interface EnqueuedTaskLike {
  uid: number;
  waitTask(): Promise<{ uid: number; status?: string }>;
}

/** Structural view of a Meilisearch index (only what Votion calls). */
export interface MeiliIndexLike {
  search(
    query: string,
    params: Record<string, unknown>,
    extra?: { signal?: AbortSignal },
  ): Promise<RawSearchResponse>;
  getSettings(): Promise<Record<string, unknown>>;
  updateSettings(settings: Record<string, unknown>): Promise<EnqueuedTaskLike>;
  addDocuments(documents: Record<string, unknown>[]): Promise<EnqueuedTaskLike>;
  deleteDocuments(ids: string[]): Promise<EnqueuedTaskLike>;
}

/**
 * Structural view of the Meilisearch client.
 *
 * Depending on this interface (rather than the SDK class) keeps the client
 * unit-testable without a live cluster and free of the SDK's generic response
 * types at every call site.
 */
export interface MeiliClientLike {
  readonly config?: { host?: string; apiKey?: string };
  createIndex(
    uid: string,
    options?: { primaryKey?: string },
  ): Promise<EnqueuedTaskLike>;
  getIndex(uid: string): Promise<MeiliIndexLike>;
  isHealthy(): Promise<boolean>;
  getVersion(): Promise<{ pkgVersion: string }>;
}

/** Raised when Meilisearch rejects a request or is unreachable. */
export class SearchTransportError extends Error {
  /** HTTP status, when the failure came from a response. */
  readonly status?: number;
  /** Meilisearch error code (`invalid_search_filter`, ...). */
  readonly code?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'SearchTransportError';
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.code !== undefined) {
      this.code = options.code;
    }
  }
}

/** Narrows an unknown error into a {@link SearchTransportError}. */
export function toSearchTransportError(error: unknown): SearchTransportError {
  if (error instanceof SearchTransportError) {
    return error;
  }
  if (error instanceof Error) {
    const candidate = error as Error & {
      response?: { status?: number };
      cause?: { code?: unknown };
    };
    const status = candidate.response?.status;
    const code =
      typeof candidate.cause?.code === 'string'
        ? candidate.cause.code
        : undefined;
    return new SearchTransportError(candidate.message, {
      cause: error,
      ...(status !== undefined ? { status } : {}),
      ...(code !== undefined ? { code } : {}),
    });
  }
  return new SearchTransportError('Unknown search transport failure', {
    cause: error,
  });
}
