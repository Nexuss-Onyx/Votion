/**
 * `@votion/search` — public domain contracts.
 *
 * The search subsystem has three layers, and each exposes its own types:
 *
 *  1. **Index** (`SearchDocument`) — the flat, denormalised record stored in
 *     Meilisearch. Rich-text tuples are already stripped to plain text here.
 *  2. **Query** (`QuickFindQuery`, `QuickFindAccessScope`) — the pure,
 *     serialisable description of a search, including the ACL filter.
 *  3. **Transport** (`QuickFindHit`, `QuickFindSearchResult`) — the hydrated,
 *     highlight-aware payload consumed by the `Cmd+K` modal.
 */

import type { BlockType, Timestamp, UUID } from '@votion/types';

/* -------------------------------------------------------------------------- */
/* Index layer                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A single block flattened into a search record.
 *
 * `title` and `plain_text` are the only searchable attributes; every other
 * field exists for filtering, sorting or rendering. Rich-text modifiers are
 * never persisted: `DocumentTransformer` strips them before the document is
 * handed to Meilisearch.
 */
export interface SearchDocument {
  /** Block id (primary key). */
  id: string;
  /** Workspace the block belongs to (`blocks.space_id`). */
  space_id: string;
  /** Direct parent record id (`blocks.parent_id`). */
  parent_id: string;
  /** Root page of the sub-tree containing the block (ACL + filter scope). */
  root_page_id: string;
  /** Block type, e.g. `page`, `heading_1`, `code`. */
  type: BlockType;
  /** Plain-text projection of the block title (`properties.title`). */
  title: string;
  /** Every searchable token of the block, title included. */
  plain_text: string;
  /** Author of the block (`blocks.created_by_id`). */
  created_by: string;
  /** Last edit, epoch **milliseconds** (mirrors `Timestamp` in `@votion/types`). */
  last_edited_time: Timestamp;
  /** Ancestor ids from the root page down to the direct parent (inclusive). */
  ancestor_ids: string[];
  /** Principal tokens (`user:<id>`, `teamspace:<id>`, `public`) with explicit read grants. */
  access_principals: string[];
  /** Soft-deletion flag; `alive: false` records are always filtered out. */
  alive: boolean;
  /** Human-readable trail ("Projects / Q4 Plan") rendered in result rows. */
  breadcrumb?: string;
}

/** Fields of {@link SearchDocument} that are searchable in Meilisearch. */
export const SEARCHABLE_ATTRIBUTES: readonly ['title', 'plain_text'] = [
  'title',
  'plain_text',
];

/** Canonical primary key of the blocks index. */
export const SEARCH_PRIMARY_KEY = 'id';

/** Attributes that may appear in a `filter` expression. */
export const FILTERABLE_ATTRIBUTES: readonly string[] = [
  'space_id',
  'parent_id',
  'root_page_id',
  'ancestor_ids',
  'access_principals',
  'created_by',
  'last_edited_time',
  'type',
  'alive',
];

/** Ranking rules, in evaluation order (`sort` above `exactness`). */
export const RANKING_RULES: readonly string[] = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  'exactness',
];

/* -------------------------------------------------------------------------- */
/* Highlighting                                                               */
/* -------------------------------------------------------------------------- */

/** A run of text, either matched by the query or not. */
export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/* -------------------------------------------------------------------------- */
/* Access control                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Everything the query builder needs to enforce read access.
 *
 * The builder is **fail-closed**: with an empty `spaceIds` list it produces a
 * query that resolves to zero results without touching Meilisearch, so a
 * missing or malformed ACL resolution can never leak documents.
 */
export interface QuickFindAccessScope {
  /** Querying user. */
  userId: UUID;
  /** Workspaces the user is a member of. Required. */
  spaceIds: readonly UUID[];
  /**
   * Root pages the user can read. When present, results are restricted to
   * those sub-trees (`root_page_id IN [...]`).
   */
  readableRootPageIds?: readonly UUID[];
  /**
   * Sub-tree roots the user can read in isolation (a shared child page inside
   * an otherwise private tree). Matched against `ancestor_ids`.
   */
  readableSubtreeIds?: readonly UUID[];
  /**
   * Optional narrowing by explicit ACL grants. Only applied when supplied,
   * because plain workspace membership does not require an entry in the
   * `permissions` table.
   */
  principals?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Query layer                                                                */
/* -------------------------------------------------------------------------- */

/** Result ordering for Quick Find. */
export type QuickFindSort =
  'relevance' | 'last_edited_time:asc' | 'last_edited_time:desc';

/** User-supplied search parameters, before scoping is applied. */
export interface QuickFindSearchInput {
  /** Raw input from the modal; normalised by the builder. */
  term: string;
  /** Maximum number of hits (default 20, hard cap 100). */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
  /** Restrict to a single page sub-tree ("search in page"). */
  pageId?: UUID;
  /** Restrict to specific block types. */
  types?: readonly BlockType[];
  /** Restrict to blocks created by this user. */
  createdBy?: UUID;
  /** Inclusive lower bound on `last_edited_time`. */
  editedAfter?: Timestamp | Date;
  /** Inclusive upper bound on `last_edited_time`. */
  editedBefore?: Timestamp | Date;
  /** Ordering; `relevance` is the typo-tolerant default. */
  sort?: QuickFindSort;
  /** Ask Meilisearch for a `type` facet distribution. */
  facets?: boolean;
}

/**
 * A fully resolved Meilisearch request. Pure data: it can be logged, cached,
 * diffed in a snapshot test, or posted to an edge worker.
 */
export interface QuickFindQuery {
  /** Normalised query string (prefix matching applies to the last term). */
  q: string;
  /** Meilisearch filter expression, already scoped and escaped. */
  filter: string;
  /** Sort clauses (`["last_edited_time:desc"]`), empty for relevance. */
  sort: string[];
  limit: number;
  offset: number;
  attributesToRetrieve: string[];
  attributesToHighlight: string[];
  attributesToCrop: string[];
  cropLength: number;
  cropMarker: string;
  highlightPreTag: string;
  highlightPostTag: string;
  /** `last` keeps results that miss a term but match the rest. */
  matchingStrategy: 'last';
  showRankingScore: boolean;
  facets: string[];
  /**
   * `false` when the access scope was empty. Such a query must never be sent
   * to Meilisearch — the searcher returns an empty result set instead.
   */
  hasAccess: boolean;
}

/* -------------------------------------------------------------------------- */
/* Transport layer                                                            */
/* -------------------------------------------------------------------------- */

/** A single hydrated Quick Find result. */
export interface QuickFindHit {
  id: string;
  spaceId: string;
  parentId: string;
  rootPageId: string;
  type: BlockType;
  /** Highlight segments for the title. */
  title: HighlightSegment[];
  /** Highlight segments for the cropped body snippet. */
  snippet: HighlightSegment[];
  /** Plain title (used for recent-page bookkeeping and accessibility labels). */
  plainTitle: string;
  breadcrumb?: string;
  createdBy: string;
  lastEditedTime: Timestamp;
  rankingScore?: number;
}

/** Response delivered to the modal. */
export interface QuickFindSearchResult {
  /** Normalised term that produced these hits. */
  query: string;
  hits: QuickFindHit[];
  totalHits: number;
  processingTimeMs: number;
  /** Wall-clock duration observed by the client, including transport. */
  elapsedMs: number;
  facets?: Record<string, Record<string, number>>;
  /** `true` when the scope granted no read access and no request was made. */
  denied?: boolean;
}

/** Empty result helper shared by the searcher and the controller. */
export function emptyQuickFindResult(
  query: string,
  overrides: Partial<QuickFindSearchResult> = {},
): QuickFindSearchResult {
  return {
    query,
    hits: [],
    totalHits: 0,
    processingTimeMs: 0,
    elapsedMs: 0,
    ...overrides,
  };
}
