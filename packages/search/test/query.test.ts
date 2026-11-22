/**
 * V-03 — QuickFindQueryBuilder / facet filter verification.
 *
 * Asserts that the builder produces *valid Meilisearch facet syntax* (balanced
 * quoting and parentheses, `IN [..]` lists, escaped literals), that permission
 * scoping is fail-closed, and that prefix/typo-search options are set.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { BlockType } from '@votion/types';

import {
  InvalidFilterValueError,
  allOf,
  anyOf,
  booleanFilter,
  equalsFilter,
  escapeFilterValue,
  inFilter,
  rangeFilter,
} from '../src/query/FacetFilter.js';
import {
  ACL_FILTER_ATTRIBUTES,
  buildAccessScopeFilter,
} from '../src/query/AccessScopeFilter.js';
import {
  QUICK_FIND_CROP_LENGTH,
  QUICK_FIND_DEFAULT_LIMIT,
  QUICK_FIND_MAX_LIMIT,
  QUICK_FIND_MAX_TERM_LENGTH,
  buildOrShortCircuit,
  buildQuickFindFacetFilter,
  buildQuickFindFilter,
  buildQuickFindQuery,
  buildRecentPagesQuery,
  normalizeQuickFindTerm,
  toMeiliSearchOptions,
} from '../src/query/QuickFindQueryBuilder.js';
import {
  BLOCKS_INDEX_PRIMARY_KEY,
  BLOCKS_INDEX_SETTINGS,
  BLOCKS_INDEX_UID,
  buildSynonyms,
  blocksIndexUid,
  diffIndexSettings,
} from '../src/client/indexSchema.js';
import {
  FILTERABLE_ATTRIBUTES,
  RANKING_RULES,
  SEARCHABLE_ATTRIBUTES,
  SEARCH_PRIMARY_KEY,
  type QuickFindAccessScope,
  type QuickFindQuery,
  type QuickFindSearchInput,
} from '../src/types.js';
import {
  PROJECTS_PAGE_ID,
  ROADMAP_PAGE_ID,
  SPACE_ID,
  USER_ID,
} from './fixtures/blocks.js';

const OTHER_SPACE_ID = '88888888-8888-4888-8888-888888888888';
const SHARED_PAGE_ID = '77777777-7777-4777-8777-777777777777';

const scope: QuickFindAccessScope = {
  userId: USER_ID,
  spaceIds: [SPACE_ID],
  readableRootPageIds: [PROJECTS_PAGE_ID, ROADMAP_PAGE_ID],
  readableSubtreeIds: [SHARED_PAGE_ID],
  principals: [`user:${USER_ID}`],
};

/* -------------------------------------------------------------------------- */
/* Filter syntax helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Counts occurrences of a character that are not backslash-escaped. */
function countUnescaped(input: string, character: string): number {
  let count = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '\\') {
      index += 1; // skip the escaped character
      continue;
    }
    if (input[index] === character) {
      count += 1;
    }
  }
  return count;
}

/** Counts occurrences of a character outside any quoted string. */
function countOutsideQuotes(input: string, character: string): number {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    if (current === '\\') {
      index += 1;
      continue;
    }
    if (current === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && current === character) {
      count += 1;
    }
  }
  return count;
}

/** Structural validation of a Meilisearch filter expression. */
function expectValidFilterSyntax(filter: string): void {
  expect(filter.length).toBeGreaterThan(0);
  // No dangling operator, no empty clause, no empty IN element.
  expect(filter).not.toMatch(/(^|\s)(AND|OR|NOT)(\s+(AND|OR|NOT)|\s*$)/);
  expect(filter).not.toMatch(/\(\s*\)/);
  expect(filter).not.toMatch(/(\[\s*,|,\s*\])/);
  // Quotes are balanced…
  expect(countUnescaped(filter, '"') % 2).toBe(0);
  // …and it ends inside no open quote.
  let inQuotes = false;
  for (let index = 0; index < filter.length; index += 1) {
    const current = filter[index];
    if (current === '\\') {
      index += 1;
      continue;
    }
    if (current === '"') {
      inQuotes = !inQuotes;
    }
  }
  expect(inQuotes).toBe(false);
  // Brackets are balanced outside quotes.
  expect(countOutsideQuotes(filter, '(')).toBe(countOutsideQuotes(filter, ')'));
  expect(countOutsideQuotes(filter, '[')).toBe(countOutsideQuotes(filter, ']'));
}

describe('escapeFilterValue', () => {
  it('quotes plain values', () => {
    expect(escapeFilterValue('space-1')).toBe('"space-1"');
  });

  it('escapes embedded quotes and backslashes', () => {
    expect(escapeFilterValue('a"b')).toBe('"a\\"b"');
    expect(escapeFilterValue('a\\b')).toBe('"a\\\\b"');
  });

  it('neutralises filter injection attempts', () => {
    const hostile = 'x" OR space_id != "y';
    const escaped = escapeFilterValue(hostile);
    expect(escaped).toBe('"x\\" OR space_id != \\"y"');
    // Exactly one logical value: two delimiting quotes.
    expect(countUnescaped(escaped, '"')).toBe(2);
  });

  it('rejects empty, whitespace-only and control-character values', () => {
    expect(() => escapeFilterValue('')).toThrow(InvalidFilterValueError);
    expect(() => escapeFilterValue('   ')).toThrow(InvalidFilterValueError);
    expect(() => escapeFilterValue('a\u0000b')).toThrow(
      InvalidFilterValueError,
    );
  });

  it('rejects non-string values at runtime', () => {
    expect(() => escapeFilterValue(42 as unknown as string)).toThrow(
      InvalidFilterValueError,
    );
  });
});

describe('filter primitives', () => {
  it('builds equality and boolean clauses', () => {
    expect(equalsFilter('space_id', 'abc')).toBe('space_id = "abc"');
    expect(booleanFilter('alive', true)).toBe('alive = true');
    expect(booleanFilter('alive', false)).toBe('alive = false');
  });

  it('builds IN lists, deduplicating and degrading singletons', () => {
    expect(inFilter('root_page_id', ['a'])).toBe('root_page_id = "a"');
    expect(inFilter('root_page_id', ['a', 'b'])).toBe(
      'root_page_id IN ["a", "b"]',
    );
    expect(inFilter('root_page_id', ['a', 'a', 'b'])).toBe(
      'root_page_id IN ["a", "b"]',
    );
    expect(inFilter('root_page_id', ['a', ' ', ''])).toBe('root_page_id = "a"');
  });

  it('rejects empty IN lists', () => {
    expect(() => inFilter('root_page_id', [])).toThrow(InvalidFilterValueError);
  });

  it('builds numeric ranges', () => {
    expect(rangeFilter('last_edited_time', { gte: 1, lte: 2 })).toBe(
      'last_edited_time >= 1 AND last_edited_time <= 2',
    );
    expect(rangeFilter('last_edited_time', { gte: 5 })).toBe(
      'last_edited_time >= 5',
    );
    expect(rangeFilter('last_edited_time', { lte: 5 })).toBe(
      'last_edited_time <= 5',
    );
  });

  it('validates range bounds', () => {
    expect(() => rangeFilter('last_edited_time', { gte: Number.NaN })).toThrow(
      InvalidFilterValueError,
    );
    expect(() => rangeFilter('last_edited_time', { lte: -1 })).toThrow(
      InvalidFilterValueError,
    );
  });

  it('joins clauses with the right precedence', () => {
    expect(allOf(['a = "1"', 'b = "2"'])).toBe('a = "1" AND b = "2"');
    expect(allOf(['a = "1"', undefined, ''])).toBe('a = "1"');
    expect(anyOf(['a = "1"', 'b = "2"'])).toBe('(a = "1" OR b = "2")');
    expect(anyOf(['a = "1"'])).toBe('a = "1"');
    expect(anyOf([undefined, false, null, ''])).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* ACL scoping                                                                */
/* -------------------------------------------------------------------------- */

describe('buildAccessScopeFilter', () => {
  it('always scopes by workspace, tree and liveness', () => {
    const { filter, hasAccess } = buildAccessScopeFilter(scope);
    expect(hasAccess).toBe(true);
    expect(filter).toContain('alive = true');
    expect(filter).toContain(`space_id = "${SPACE_ID}"`);
    expect(filter).toContain(
      `root_page_id IN ["${PROJECTS_PAGE_ID}", "${ROADMAP_PAGE_ID}"]`,
    );
    expect(filter).toContain(`ancestor_ids = "${SHARED_PAGE_ID}"`);
    expect(filter).toContain(`access_principals = "user:${USER_ID}"`);
    expectValidFilterSyntax(filter);
  });

  it('is fail-closed without a user', () => {
    expect(buildAccessScopeFilter({ ...scope, userId: '' }).hasAccess).toBe(
      false,
    );
    expect(buildAccessScopeFilter({ ...scope, spaceIds: [] }).hasAccess).toBe(
      false,
    );
  });

  it('is fail-closed when the readable page list is explicitly empty', () => {
    const result = buildAccessScopeFilter({
      ...scope,
      readableRootPageIds: [],
      readableSubtreeIds: [],
    });
    expect(result.hasAccess).toBe(false);
    expect(result.filter).toBe('');
    expect(result.reason).toBeDefined();
  });

  it('omits the tree clause when no page restriction was supplied', () => {
    const { filter, hasAccess } = buildAccessScopeFilter({
      userId: USER_ID,
      spaceIds: [SPACE_ID],
    });
    expect(hasAccess).toBe(true);
    expect(filter).toBe(`alive = true AND space_id = "${SPACE_ID}"`);
  });

  it('deduplicates ids and ignores blank workspace entries', () => {
    const { filter } = buildAccessScopeFilter({
      userId: USER_ID,
      spaceIds: [SPACE_ID, ` ${SPACE_ID} `, '', OTHER_SPACE_ID],
    });
    expect(filter).toContain(
      `space_id IN ["${SPACE_ID}", "${OTHER_SPACE_ID}"]`,
    );
    expect(countUnescaped(filter, '"')).toBe(4);
  });

  it('does not apply a principal clause unless one was supplied', () => {
    const { filter } = buildAccessScopeFilter({
      userId: USER_ID,
      spaceIds: [SPACE_ID],
    });
    expect(filter).not.toContain('access_principals');
  });

  it('filters on every ACL attribute declared in the index schema', () => {
    for (const attribute of ACL_FILTER_ATTRIBUTES) {
      expect(BLOCKS_INDEX_SETTINGS.filterableAttributes).toContain(attribute);
    }
  });

  it('cannot be escaped by hostile ids', () => {
    const hostile = buildAccessScopeFilter({
      userId: USER_ID,
      spaceIds: ['x" OR space_id != "y'],
    });
    // A single hostile workspace yields one equality clause, not a new OR term.
    expect(hostile.filter).toBe(
      'alive = true AND space_id = "x\\" OR space_id != \\"y"',
    );
    expectValidFilterSyntax(hostile.filter.replace(/\\"/g, ''));
  });
});

/* -------------------------------------------------------------------------- */
/* Term normalisation                                                         */
/* -------------------------------------------------------------------------- */

describe('normalizeQuickFindTerm', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeQuickFindTerm('  Q4   RoadMap ')).toBe('q4 roadmap');
  });

  it('strips control characters but keeps punctuation', () => {
    expect(normalizeQuickFindTerm('useState(\u0000 \n "x"')).toBe(
      'usestate( "x"',
    );
    expect(normalizeQuickFindTerm("o'brien")).toBe("o'brien");
    expect(normalizeQuickFindTerm('kebab-case')).toBe('kebab-case');
  });

  it('truncates pathological input', () => {
    expect(normalizeQuickFindTerm('a'.repeat(500)).length).toBe(
      QUICK_FIND_MAX_TERM_LENGTH,
    );
  });

  it('handles non-strings', () => {
    expect(normalizeQuickFindTerm(undefined)).toBe('');
    expect(normalizeQuickFindTerm(null)).toBe('');
    expect(normalizeQuickFindTerm(42 as unknown as string)).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* Facet filters                                                              */
/* -------------------------------------------------------------------------- */

describe('buildQuickFindFacetFilter', () => {
  it('always excludes deleted records', () => {
    expect(buildQuickFindFacetFilter({ term: 'x' })).toBe('alive = true');
  });

  it('scopes to a page sub-tree ("search in page")', () => {
    const filter = buildQuickFindFacetFilter({
      term: 'x',
      pageId: ROADMAP_PAGE_ID,
    });
    expect(filter).toContain(
      `(root_page_id = "${ROADMAP_PAGE_ID}" OR ancestor_ids = "${ROADMAP_PAGE_ID}")`,
    );
    expectValidFilterSyntax(filter);
  });

  it('filters by block type', () => {
    const types: BlockType[] = ['page', 'heading_1'];
    const filter = buildQuickFindFacetFilter({ term: 'x', types });
    expect(filter).toContain('type IN ["page", "heading_1"]');
  });

  it('produces an unsatisfiable clause for an empty type list', () => {
    const filter = buildQuickFindFacetFilter({ term: 'x', types: [] });
    expect(filter).toContain('type = "__none__"');
  });

  it('filters by creator and edit window', () => {
    const filter = buildQuickFindFacetFilter({
      term: 'x',
      createdBy: USER_ID,
      editedAfter: new Date('2026-01-01T00:00:00Z'),
      editedBefore: Date.UTC(2026, 11, 1),
    });
    expect(filter).toContain(`created_by = "${USER_ID}"`);
    expect(filter).toContain(
      `last_edited_time >= ${Date.UTC(2026, 0, 1)} AND last_edited_time <= ${Date.UTC(2026, 11, 1)}`,
    );
    expectValidFilterSyntax(filter);
  });

  it('rejects invalid date bounds', () => {
    expect(() =>
      buildQuickFindFacetFilter({ term: 'x', editedAfter: -5 }),
    ).toThrow(InvalidFilterValueError);
    expect(() =>
      buildQuickFindFacetFilter({
        term: 'x',
        editedBefore: new Date('nonsense'),
      }),
    ).toThrow(InvalidFilterValueError);
  });

  it('composes ACL and facet clauses without nesting errors', () => {
    const filter = buildQuickFindFilter(
      {
        term: 'x',
        pageId: ROADMAP_PAGE_ID,
        types: ['page'],
        createdBy: USER_ID,
      },
      scope,
    );
    expect(filter.hasAccess).toBe(true);
    expectValidFilterSyntax(filter.filter);
    expect(filter.filter.split(' AND ').length).toBeGreaterThan(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Full query                                                                 */
/* -------------------------------------------------------------------------- */

describe('buildQuickFindQuery', () => {
  it('produces the harness-contract query object', () => {
    const query = buildQuickFindQuery({ term: '  Q4   Roa ' }, scope);

    expectTypeOf(query).toEqualTypeOf<QuickFindQuery>();
    expect(query.q).toBe('q4 roa');
    expect(query.hasAccess).toBe(true);
    expect(query.limit).toBe(QUICK_FIND_DEFAULT_LIMIT);
    expect(query.offset).toBe(0);
    expect(query.attributesToHighlight).toEqual(['title', 'plain_text']);
    expect(query.attributesToCrop).toEqual(['plain_text']);
    expect(query.cropLength).toBe(QUICK_FIND_CROP_LENGTH);
    expect(query.highlightPreTag).toBe('<mark>');
    expect(query.highlightPostTag).toBe('</mark>');
    expect(query.sort).toEqual([]);
    expect(query.facets).toEqual([]);
    expectValidFilterSyntax(query.filter);
  });

  it('keeps the last term as a prefix match (prefix search belongs to the index)', () => {
    // The SDK/index does the prefix expansion; the builder must not append a
    // wildcard (Meilisearch rejects `*` inside `q`).
    const query = buildQuickFindQuery({ term: 'quarterly roa' }, scope);
    expect(query.q).toBe('quarterly roa');
    expect(query.q).not.toContain('*');
    expect(BLOCKS_INDEX_SETTINGS.prefixSearch).toBe('indexingTime');
  });

  it('passes typos through untouched so the typo engine can score them', () => {
    const query = buildQuickFindQuery({ term: 'raodmap' }, scope);
    expect(query.q).toBe('raodmap');
    expect(BLOCKS_INDEX_SETTINGS.typoTolerance.enabled).toBe(true);
    expect(BLOCKS_INDEX_SETTINGS.typoTolerance.minWordSizeForTypos).toEqual({
      oneTypo: 4,
      twoTypos: 8,
    });
  });

  it('uses the documented ranking rules order', () => {
    expect(BLOCKS_INDEX_SETTINGS.rankingRules).toEqual([
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
    ]);
  });

  it('declares the required filterable attributes', () => {
    for (const attribute of [
      'space_id',
      'parent_id',
      'root_page_id',
      'created_by',
      'last_edited_time',
      'type',
    ]) {
      expect(BLOCKS_INDEX_SETTINGS.filterableAttributes).toContain(attribute);
    }
    expect(BLOCKS_INDEX_SETTINGS.searchableAttributes).toEqual([
      'title',
      'plain_text',
    ]);
  });

  it('clamps limit and offset', () => {
    expect(buildQuickFindQuery({ term: 'x', limit: 0 }, scope).limit).toBe(1);
    expect(buildQuickFindQuery({ term: 'x', limit: 10_000 }, scope).limit).toBe(
      QUICK_FIND_MAX_LIMIT,
    );
    expect(buildQuickFindQuery({ term: 'x', limit: 12.7 }, scope).limit).toBe(
      12,
    );
    expect(buildQuickFindQuery({ term: 'x', offset: -3 }, scope).offset).toBe(
      0,
    );
    expect(buildQuickFindQuery({ term: 'x', offset: 20 }, scope).offset).toBe(
      20,
    );
  });

  it('maps sort options', () => {
    expect(
      buildQuickFindQuery({ term: 'x', sort: 'last_edited_time:desc' }, scope)
        .sort,
    ).toEqual(['last_edited_time:desc']);
    expect(
      buildQuickFindQuery({ term: 'x', sort: 'relevance' }, scope).sort,
    ).toEqual([]);
  });

  it('requests facets only when asked', () => {
    expect(
      buildQuickFindQuery({ term: 'x', facets: true }, scope).facets,
    ).toEqual(['type']);
  });

  it('returns an unusable query when access is denied', () => {
    const query = buildQuickFindQuery(
      { term: 'secret' },
      { ...scope, spaceIds: [] },
    );
    expect(query.hasAccess).toBe(false);
    expect(query.filter).toBe('');
  });

  it('is deterministic and JSON-serialisable (cacheable)', () => {
    const input: QuickFindSearchInput = { term: 'Q4', limit: 5 };
    const first = buildQuickFindQuery(input, scope);
    const second = buildQuickFindQuery(input, scope);
    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('buildOrShortCircuit refuses to build a request when denied', () => {
    const allowed = buildOrShortCircuit({ term: 'x' }, scope);
    expect(allowed.query).not.toBeNull();

    const denied = buildOrShortCircuit(
      { term: '  ' },
      { ...scope, readableRootPageIds: [], readableSubtreeIds: [] },
    );
    expect(denied.query).toBeNull();
    expect(denied.deniedResult?.denied).toBe(true);
    expect(denied.deniedResult?.hits).toEqual([]);
  });
});

describe('toMeiliSearchOptions', () => {
  it('projects the query onto wire options without leaking internals', () => {
    const options = toMeiliSearchOptions(
      buildQuickFindQuery({ term: 'x' }, scope),
    );
    expect(options).not.toHaveProperty('q');
    expect(options).not.toHaveProperty('hasAccess');
    expect(options).not.toHaveProperty('facets');
    expect(options.filter).toContain('alive = true');
    expect(options.matchingStrategy).toBe('last');
    expect(options.showRankingScore).toBe(true);
    expect(options.highlightPreTag).toBe('<mark>');
  });

  it('omits empty sort/facet arrays (Meilisearch rejects empty arrays)', () => {
    const options = toMeiliSearchOptions(
      buildQuickFindQuery({ term: 'x' }, scope),
    );
    expect(options.sort).toBeUndefined();
    expect(options.facets).toBeUndefined();
  });

  it('includes sort and facets when requested', () => {
    const options = toMeiliSearchOptions(
      buildQuickFindQuery(
        { term: 'x', sort: 'last_edited_time:desc', facets: true },
        scope,
      ),
    );
    expect(options.sort).toEqual(['last_edited_time:desc']);
    expect(options.facets).toEqual(['type']);
  });
});

describe('buildRecentPagesQuery', () => {
  it('lists pages newest-first with no term', () => {
    const query = buildRecentPagesQuery({ limit: 8 }, scope);
    expect(query.q).toBe('');
    expect(query.sort).toEqual(['last_edited_time:desc']);
    expect(query.limit).toBe(8);
    expect(query.filter).toContain('type = "page"');
    expect(query.hasAccess).toBe(true);
    expectValidFilterSyntax(query.filter);
  });
});

/* -------------------------------------------------------------------------- */
/* Index schema helpers                                                       */
/* -------------------------------------------------------------------------- */

describe('index schema helpers', () => {
  it('diffs settings against a live index', () => {
    expect(Object.keys(diffIndexSettings(null)).length).toBeGreaterThan(5);
    expect(diffIndexSettings({ ...BLOCKS_INDEX_SETTINGS })).toEqual({});
    const drift = diffIndexSettings({
      ...BLOCKS_INDEX_SETTINGS,
      rankingRules: ['words', 'typo'],
    });
    expect(Object.keys(drift)).toEqual(['rankingRules']);
  });

  it('expands synonym groups symmetrically', () => {
    const synonyms = buildSynonyms([['a', 'b', 'c']]);
    expect([...(synonyms.a ?? [])].sort()).toEqual(['b', 'c']);
    expect([...(synonyms.b ?? [])].sort()).toEqual(['a', 'c']);
    expect([...(synonyms.c ?? [])].sort()).toEqual(['a', 'b']);
  });

  it('namespaces tenant index uids safely', () => {
    expect(blocksIndexUid()).toBe('votion_blocks');
    expect(blocksIndexUid('EU West')).toBe('votion_blocks_eu-west');
    expect(blocksIndexUid('  ')).toBe('votion_blocks');
  });

  it('sets a search cutoff that bounds the 50 ms budget under load', () => {
    expect(BLOCKS_INDEX_SETTINGS.searchCutoffMs).toBeGreaterThanOrEqual(50);
    expect(BLOCKS_INDEX_SETTINGS.searchCutoffMs).toBeLessThan(500);
  });
});

describe('public contract parity', () => {
  it('keeps the documented schema constants in sync', () => {
    expect(BLOCKS_INDEX_SETTINGS.searchableAttributes).toEqual([
      ...SEARCHABLE_ATTRIBUTES,
    ]);
    expect(BLOCKS_INDEX_SETTINGS.filterableAttributes).toEqual([
      ...FILTERABLE_ATTRIBUTES,
    ]);
    expect(BLOCKS_INDEX_SETTINGS.rankingRules).toEqual([...RANKING_RULES]);
    expect(BLOCKS_INDEX_PRIMARY_KEY).toBe(SEARCH_PRIMARY_KEY);
    expect(BLOCKS_INDEX_UID).toBe('votion_blocks');
  });
});
