/**
 * Quick Find query builder.
 *
 * Turns a raw modal input plus an {@link QuickFindAccessScope} into a
 * ready-to-send {@link QuickFindQuery}:
 *
 *  - **Instant / prefix search** — the term is tokenised, lower-cased and
 *    collapsed to single spaces. Meilisearch matches the last token as a prefix
 *    by default, so `"roa"` already finds `"Roadmap"`; `prefixSearch` and the
 *    crop/highlight options keep the payload small enough to stay < 50 ms.
 *  - **Typo tolerance** — nothing is "fixed" client-side. Queries are passed
 *    through untouched (no escaping of apostrophes inside words) so
 *    Meilisearch's typo engine can score `"raodmap"` → `"roadmap"`.
 *  - **Permission scoping** — all ACL filtering happens in
 *    {@link buildAccessScopeFilter}; an unsatisfiable scope yields
 *    `hasAccess: false` and the searcher refuses to issue the request.
 */

import type { BlockType } from '@votion/types';

import {
  emptyQuickFindResult,
  type QuickFindAccessScope,
  type QuickFindQuery,
  type QuickFindSearchInput,
} from '../types.js';
import { buildAccessScopeFilter } from './AccessScopeFilter.js';
import {
  DEFAULT_HIGHLIGHT_POST_TAG,
  DEFAULT_HIGHLIGHT_PRE_TAG,
} from '../highlight.js';
import {
  allOf,
  anyOf,
  booleanFilter,
  inFilter,
  rangeFilter,
  InvalidFilterValueError,
} from './FacetFilter.js';

/** Attributes returned to the client. */
export const QUICK_FIND_ATTRIBUTES_TO_RETRIEVE: readonly string[] = [
  'id',
  'space_id',
  'parent_id',
  'root_page_id',
  'type',
  'title',
  'plain_text',
  'created_by',
  'last_edited_time',
  'breadcrumb',
];

/** Attributes rendered as highlighted markup. */
export const QUICK_FIND_ATTRIBUTES_TO_HIGHLIGHT: readonly string[] = [
  'title',
  'plain_text',
];

/** Attributes cropped into a short snippet. */
export const QUICK_FIND_ATTRIBUTES_TO_CROP: readonly string[] = ['plain_text'];

/** Default page size of the modal. */
export const QUICK_FIND_DEFAULT_LIMIT = 20;

/** Hard upper bound accepted from the UI. */
export const QUICK_FIND_MAX_LIMIT = 100;

/** Characters trimmed of the snippet (Meilisearch counts words). */
export const QUICK_FIND_CROP_LENGTH = 24;

/** Ellipsis inserted where the snippet was cropped. */
export const QUICK_FIND_CROP_MARKER = '…';

/** Longest query accepted from the input field. */
export const QUICK_FIND_MAX_TERM_LENGTH = 200;

/**
 * Normalises user input for search:
 *  - strips control characters and collapses whitespace,
 *  - lower-cases for prefix consistency (`Cmd+K` is case-insensitive),
 *  - trims to {@link QUICK_FIND_MAX_TERM_LENGTH}.
 *
 * Punctuation is deliberately preserved so that code snippets like `useState(`
 * and hyphenated titles still match.
 */
export function normalizeQuickFindTerm(
  term: string | null | undefined,
): string {
  if (typeof term !== 'string') {
    return '';
  }
  const collapsed = term
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return collapsed.slice(0, QUICK_FIND_MAX_TERM_LENGTH).trim();
}

/** Converts a `Date` or epoch value into epoch milliseconds. */
function toEpoch(value: number | Date | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const epoch = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(epoch) || epoch < 0) {
    throw new InvalidFilterValueError(
      'Date bounds must be valid, non-negative timestamps',
    );
  }
  return Math.floor(epoch);
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return QUICK_FIND_DEFAULT_LIMIT;
  }
  return Math.min(QUICK_FIND_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function clampOffset(offset: number | undefined): number {
  if (offset === undefined || !Number.isFinite(offset) || offset < 0) {
    return 0;
  }
  return Math.floor(offset);
}

/**
 * Builds the user-controlled portion of the filter (page sub-tree, block type,
 * creator, edit-date window). Every clause is AND-ed and every value escaped.
 */
export function buildQuickFindFacetFilter(input: QuickFindSearchInput): string {
  const clauses: string[] = [booleanFilter('alive', true)];

  if (input.pageId !== undefined && input.pageId.trim().length > 0) {
    // "Search in page" includes the page itself and everything beneath it.
    const pageId = input.pageId.trim();
    clauses.push(
      anyOf([
        inFilter('root_page_id', [pageId]),
        inFilter('ancestor_ids', [pageId]),
      ]),
    );
  }

  if (input.types !== undefined) {
    const types = input.types.filter(
      (type): type is BlockType => typeof type === 'string',
    );
    if (types.length === 0) {
      // An explicit but empty type list can match nothing: make it explicit
      // instead of silently returning everything.
      clauses.push('type = "__none__"');
    } else {
      clauses.push(inFilter('type', types));
    }
  }

  if (input.createdBy !== undefined && input.createdBy.trim().length > 0) {
    clauses.push(inFilter('created_by', [input.createdBy]));
  }

  const gte = toEpoch(input.editedAfter);
  const lte = toEpoch(input.editedBefore);
  if (gte !== undefined || lte !== undefined) {
    clauses.push(rangeFilter('last_edited_time', { gte, lte }));
  }

  return allOf(clauses);
}

/** Builds the full filter: ACL scope AND user facets. */
export function buildQuickFindFilter(
  input: QuickFindSearchInput,
  scope: QuickFindAccessScope,
): { filter: string; hasAccess: boolean } {
  const access = buildAccessScopeFilter(scope);
  if (!access.hasAccess) {
    return { filter: '', hasAccess: false };
  }
  return {
    filter: allOf([access.filter, buildQuickFindFacetFilter(input)]),
    hasAccess: true,
  };
}

/**
 * Builds the complete Meilisearch request for a Quick Find keystroke.
 *
 * The returned object is a plain value (no client instance, no closures) so it
 * can be snapshot-tested, logged with the trace id, or forwarded to an edge
 * worker that holds the search-only API key.
 */
export function buildQuickFindQuery(
  input: QuickFindSearchInput,
  scope: QuickFindAccessScope,
): QuickFindQuery {
  const q = normalizeQuickFindTerm(input.term);
  const { filter, hasAccess } = buildQuickFindFilter(input, scope);

  const sort: string[] = [];
  if (input.sort === 'last_edited_time:desc') {
    sort.push('last_edited_time:desc');
  } else if (input.sort === 'last_edited_time:asc') {
    sort.push('last_edited_time:asc');
  }

  return {
    q,
    filter,
    sort,
    limit: clampLimit(input.limit),
    offset: clampOffset(input.offset),
    attributesToRetrieve: [...QUICK_FIND_ATTRIBUTES_TO_RETRIEVE],
    attributesToHighlight: [...QUICK_FIND_ATTRIBUTES_TO_HIGHLIGHT],
    attributesToCrop: [...QUICK_FIND_ATTRIBUTES_TO_CROP],
    cropLength: QUICK_FIND_CROP_LENGTH,
    cropMarker: QUICK_FIND_CROP_MARKER,
    highlightPreTag: DEFAULT_HIGHLIGHT_PRE_TAG,
    highlightPostTag: DEFAULT_HIGHLIGHT_POST_TAG,
    matchingStrategy: 'last',
    showRankingScore: true,
    facets: input.facets === true ? ['type'] : [],
    hasAccess,
  };
}

/* -------------------------------------------------------------------------- */
/* Meilisearch option mapping                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Structural subset of `SearchParams` from the `meilisearch` package.
 *
 * Declared locally so that the pure query layer builds and typechecks without
 * importing the SDK (and therefore without `DOM` lib).
 */
export interface MeiliSearchOptions {
  filter?: string;
  sort?: string[];
  limit?: number;
  offset?: number;
  attributesToRetrieve?: string[];
  attributesToHighlight?: string[];
  attributesToCrop?: string[];
  cropLength?: number;
  cropMarker?: string;
  highlightPreTag?: string;
  highlightPostTag?: string;
  matchingStrategy?: 'last' | 'all' | 'frequency';
  showRankingScore?: boolean;
  facets?: string[];
}

/** Projects a {@link QuickFindQuery} onto the Meilisearch wire options. */
export function toMeiliSearchOptions(
  query: QuickFindQuery,
): MeiliSearchOptions {
  const options: MeiliSearchOptions = {
    limit: query.limit,
    offset: query.offset,
    attributesToRetrieve: query.attributesToRetrieve,
    attributesToHighlight: query.attributesToHighlight,
    attributesToCrop: query.attributesToCrop,
    cropLength: query.cropLength,
    cropMarker: query.cropMarker,
    highlightPreTag: query.highlightPreTag,
    highlightPostTag: query.highlightPostTag,
    matchingStrategy: query.matchingStrategy,
    showRankingScore: query.showRankingScore,
  };
  if (query.filter.length > 0) {
    options.filter = query.filter;
  }
  if (query.sort.length > 0) {
    options.sort = query.sort;
  }
  if (query.facets.length > 0) {
    options.facets = query.facets;
  }
  return options;
}

/**
 * Convenience entry point: build, then short-circuit when the ACL scope grants
 * no access. `null` means "do not call Meilisearch".
 */
export function buildOrShortCircuit(
  input: QuickFindSearchInput,
  scope: QuickFindAccessScope,
): {
  query: QuickFindQuery | null;
  deniedResult?: ReturnType<typeof emptyQuickFindResult>;
} {
  const query = buildQuickFindQuery(input, scope);
  if (!query.hasAccess) {
    return {
      query: null,
      deniedResult: emptyQuickFindResult(normalizeQuickFindTerm(input.term), {
        denied: true,
      }),
    };
  }
  return { query };
}

/** Builds the query used for the modal's empty-state "recent pages" list. */
export function buildRecentPagesQuery(
  input: Omit<QuickFindSearchInput, 'term'>,
  scope: QuickFindAccessScope,
): QuickFindQuery {
  return buildQuickFindQuery(
    { ...input, term: '', sort: 'last_edited_time:desc', types: ['page'] },
    scope,
  );
}
