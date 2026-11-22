/**
 * Quick Find search service.
 *
 * Glue between the pure query builder and the transport:
 *
 * ```
 * input + ACL scope ──buildQuickFindQuery──▶ QuickFindQuery
 *                                    │
 *              hasAccess === false ? ─┴─▶ empty result (no request issued)
 *                                    │
 *                               executor.execute
 *                                    │
 *                             hydrateHits ──▶ QuickFindSearchResult
 * ```
 *
 * The service never trusts the transport: hydrated hits are re-checked against
 * the ACL scope before being returned, so a mis-configured index (or a cached
 * response from before a permission change) still cannot leak a document.
 */

import type { UUID } from '@votion/types';

import { hydrateHits } from './hitHydration.js';
import type { SearchExecutor } from './SearchTransport.js';
import {
  buildQuickFindQuery,
  buildRecentPagesQuery,
  normalizeQuickFindTerm,
  toMeiliSearchOptions,
} from '../query/QuickFindQueryBuilder.js';
import {
  emptyQuickFindResult,
  type QuickFindAccessScope,
  type QuickFindSearchInput,
  type QuickFindQuery,
  type QuickFindSearchResult,
  type SearchDocument,
} from '../types.js';

/** Telemetry sink; every hook is optional. */
export interface QuickFindTelemetry {
  onResult?(event: {
    term: string;
    hits: number;
    latencyMs: number;
    serverTimeMs: number;
    denied: boolean;
  }): void;
  onError?(error: unknown, context: { term: string }): void;
}

/** Options for {@link QuickFindSearchService}. */
export interface QuickFindSearchServiceOptions {
  /** Clock injection (tests). */
  now?: () => number;
  /** Telemetry hooks. */
  telemetry?: QuickFindTelemetry;
  /**
   * Re-check hydrated hits against the ACL scope client-side. Enabled by
   * default; disabling is only appropriate for trusted server-side callers that
   * already resolved the filter themselves.
   */
  verifyHits?: boolean;
}

/** Structural fields needed to judge a document's readability. */
export type AclFields = Pick<
  SearchDocument,
  'space_id' | 'root_page_id' | 'ancestor_ids' | 'access_principals' | 'alive'
>;

function cleanSet(values: readonly string[] | undefined): Set<string> | null {
  if (values === undefined) {
    return null;
  }
  const set = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      set.add(trimmed);
    }
  }
  return set;
}

/**
 * Client-side re-verification of an indexed document against the ACL scope.
 *
 * Mirrors `buildAccessScopeFilter()` exactly and is used both as defence in
 * depth in the service and by the indexing worker when it drops documents.
 */
export function isDocumentReadable(
  document: AclFields,
  scope: QuickFindAccessScope,
): boolean {
  if (document.alive === false) {
    return false;
  }
  const spaceIds = cleanSet(scope.spaceIds) ?? new Set<string>();
  if (!spaceIds.has(document.space_id)) {
    return false;
  }

  const roots = cleanSet(scope.readableRootPageIds);
  const subtrees = cleanSet(scope.readableSubtreeIds) ?? new Set<string>();
  if (roots !== null && roots.size === 0 && subtrees.size === 0) {
    return false;
  }
  if (
    roots === null &&
    scope.readableSubtreeIds !== undefined &&
    subtrees.size === 0
  ) {
    return false;
  }

  if (roots !== null || subtrees.size > 0) {
    const treeAllowed =
      (roots?.has(document.root_page_id) ?? false) ||
      subtrees.has(document.root_page_id) ||
      (document.ancestor_ids ?? []).some((id) => subtrees.has(id));
    if (!treeAllowed) {
      return false;
    }
  }

  const principals = cleanSet(scope.principals);
  if (principals !== null) {
    const documentPrincipals = document.access_principals ?? [];
    if (!documentPrincipals.some((principal) => principals.has(principal))) {
      return false;
    }
  }
  return true;
}

/**
 * Readability check for an already-hydrated hit.
 *
 * Hydrated hits only carry render-ready fields (`ancestor_ids` stays on the
 * server), so the ancestor branch of the filter cannot be replayed here; the
 * workspace + root-page checks catch cross-workspace and cross-tree leakage,
 * which is what a stale or mis-configured index would expose.
 */
export function isQuickFindHitInScope(
  hit: { spaceId: string; rootPageId: string },
  scope: QuickFindAccessScope,
): boolean {
  const spaceIds = cleanSet(scope.spaceIds) ?? new Set<string>();
  if (!spaceIds.has(hit.spaceId)) {
    return false;
  }
  const roots = cleanSet(scope.readableRootPageIds);
  const subtrees = cleanSet(scope.readableSubtreeIds) ?? new Set<string>();
  if ((roots === null || roots.size === 0) && subtrees.size === 0) {
    return true;
  }
  return (roots?.has(hit.rootPageId) ?? false) || subtrees.has(hit.rootPageId);
}

/** Detects a cancellation without depending on the DOM lib. */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'AbortError' || candidate.code === 20;
}

/**
 * Build, execute, hydrate, verify.
 *
 * Safe to share across requests: the service holds only the injected executor
 * and stateless configuration.
 */
export class QuickFindSearchService {
  private readonly executor: SearchExecutor;
  private readonly now: () => number;
  private readonly telemetry: QuickFindTelemetry;
  private readonly verifyHits: boolean;

  constructor(
    executor: SearchExecutor,
    options: QuickFindSearchServiceOptions = {},
  ) {
    this.executor = executor;
    this.now = options.now ?? (() => Date.now());
    this.telemetry = options.telemetry ?? {};
    this.verifyHits = options.verifyHits !== false;
  }

  /** Index used by this service (telemetry / cache keys). */
  get indexUid(): string {
    return this.executor.indexUid;
  }

  /** Builds the request without executing it (caching, debugging, snapshots). */
  build(
    input: QuickFindSearchInput,
    scope: QuickFindAccessScope,
  ): QuickFindQuery {
    return buildQuickFindQuery(input, scope);
  }

  /** Runs a Quick Find query. Denied access resolves to an empty result. */
  async search(
    input: QuickFindSearchInput,
    scope: QuickFindAccessScope,
    requestInit?: { signal?: AbortSignal },
  ): Promise<QuickFindSearchResult> {
    const term = normalizeQuickFindTerm(input.term);
    const started = this.now();
    const query = buildQuickFindQuery(input, scope);

    if (!query.hasAccess) {
      const denied = emptyQuickFindResult(term, {
        denied: true,
        elapsedMs: this.now() - started,
      });
      this.telemetry.onResult?.({
        term,
        hits: 0,
        latencyMs: denied.elapsedMs,
        serverTimeMs: 0,
        denied: true,
      });
      return denied;
    }

    try {
      const response = await this.executor.execute(
        query.q,
        toMeiliSearchOptions(query),
        requestInit,
      );
      const hydrated = hydrateHits(response.hits, {
        preTag: query.highlightPreTag,
        postTag: query.highlightPostTag,
      });
      const hits = this.verifyHits
        ? hydrated.filter((hit) => isQuickFindHitInScope(hit, scope))
        : hydrated;

      const result: QuickFindSearchResult = {
        query: term,
        hits,
        totalHits:
          response.estimatedTotalHits ?? response.totalHits ?? hits.length,
        processingTimeMs: response.processingTimeMs,
        elapsedMs: this.now() - started,
        ...(response.facetDistribution !== undefined
          ? { facets: response.facetDistribution }
          : {}),
      };

      this.telemetry.onResult?.({
        term,
        hits: hits.length,
        latencyMs: result.elapsedMs,
        serverTimeMs: result.processingTimeMs,
        denied: false,
      });
      return result;
    } catch (error) {
      if (isAbortError(error)) {
        return emptyQuickFindResult(term, { elapsedMs: this.now() - started });
      }
      this.telemetry.onError?.(error, { term });
      throw error;
    }
  }

  /**
   * Empty-state "recent pages": pages in scope, newest edit first.
   *
   * `spaceId` narrows the scope to the workspace currently open in the sidebar.
   */
  async recentPages(
    scope: QuickFindAccessScope,
    options: { limit?: number; spaceId?: UUID } = {},
  ): Promise<QuickFindSearchResult> {
    const started = this.now();
    const narrowedScope: QuickFindAccessScope =
      options.spaceId === undefined
        ? scope
        : { ...scope, spaceIds: [options.spaceId] };
    const query = buildRecentPagesQuery(
      { limit: options.limit ?? 10 },
      narrowedScope,
    );

    if (!query.hasAccess) {
      return emptyQuickFindResult('', { denied: true });
    }

    try {
      const response = await this.executor.execute(
        query.q,
        toMeiliSearchOptions(query),
      );
      const hits = hydrateHits(response.hits, {
        preTag: query.highlightPreTag,
        postTag: query.highlightPostTag,
      }).filter(
        (hit) => !this.verifyHits || isQuickFindHitInScope(hit, narrowedScope),
      );

      return {
        query: '',
        hits,
        totalHits:
          response.estimatedTotalHits ?? response.totalHits ?? hits.length,
        processingTimeMs: response.processingTimeMs,
        elapsedMs: this.now() - started,
      };
    } catch (error) {
      if (isAbortError(error)) {
        return emptyQuickFindResult('');
      }
      this.telemetry.onError?.(error, { term: '' });
      throw error;
    }
  }
}
