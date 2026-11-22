/**
 * Server-side collection query engine.
 *
 * Executes view queries (filters, sorts, pagination) against collection rows
 * (page blocks). Pure and deterministic so it can be unit-tested without a
 * database; the PostgreSQL store returns the same row set and this module
 * applies the same projection semantics.
 */

import type {
  FilterClause,
  FilterGroup,
  FilterNode,
  SortClause,
} from '@votion/types';

import type { BlockRecord } from '../store/types.js';

/** Extracts a comparable scalar from a block property value. */
export function propertyScalar(block: BlockRecord, property: string): unknown {
  const value = block.properties[property];
  if (value === undefined || value === null) {
    return undefined;
  }
  // Rich text: [["Hello"]] -> "Hello"
  if (Array.isArray(value)) {
    const segments = value as unknown[];
    const texts: string[] = [];
    for (const segment of segments) {
      if (Array.isArray(segment) && typeof segment[0] === 'string') {
        texts.push(segment[0]);
      }
    }
    if (texts.length > 0) {
      return texts.join('');
    }
    // Select/status: [["option-id"]] -> "option-id"
    if (segments.length === 1 && Array.isArray(segments[0]) && typeof segments[0][0] === 'string') {
      return segments[0][0];
    }
    return value;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj['start_date'] === 'string') {
      return obj['start_date'];
    }
    if (typeof obj['number'] === 'number') {
      return obj['number'];
    }
    if (typeof obj['checked'] === 'boolean') {
      return obj['checked'];
    }
  }
  return value;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return String(a).localeCompare(String(b));
}

function matchesClause(block: BlockRecord, clause: FilterClause): boolean {
  const value = propertyScalar(block, clause.property);
  const expected = clause.value;
  switch (clause.comparator) {
    case 'equals':
      return compareValues(value, expected) === 0;
    case 'not_equals':
      return compareValues(value, expected) !== 0;
    case 'contains':
      return String(value ?? '').includes(String(expected ?? ''));
    case 'does_not_contain':
      return !String(value ?? '').includes(String(expected ?? ''));
    case 'starts_with':
      return String(value ?? '').startsWith(String(expected ?? ''));
    case 'ends_with':
      return String(value ?? '').endsWith(String(expected ?? ''));
    case 'is_empty':
      return isEmptyValue(value);
    case 'is_not_empty':
      return !isEmptyValue(value);
    case 'greater_than':
      return compareValues(value, expected) > 0;
    case 'greater_than_or_equal':
      return compareValues(value, expected) >= 0;
    case 'less_than':
      return compareValues(value, expected) < 0;
    case 'less_than_or_equal':
      return compareValues(value, expected) <= 0;
    case 'before':
    case 'on_or_before':
    case 'after':
    case 'on_or_after':
    case 'is_within':
    case 'is_relative_to_today':
    case 'is_checked':
    case 'is_not_checked':
      return compareValues(value, expected) === 0;
    default:
      return false;
  }
}

function matchesNode(block: BlockRecord, node: FilterNode): boolean {
  if ('operator' in node && 'clauses' in node) {
    const group = node as FilterGroup;
    if (group.clauses.length === 0) {
      return true;
    }
    return group.operator === 'and'
      ? group.clauses.every((clause) => matchesNode(block, clause))
      : group.clauses.some((clause) => matchesNode(block, clause));
  }
  return matchesClause(block, node as FilterClause);
}

/** Applies a filter tree to rows. */
export function applyFilter(rows: BlockRecord[], filter: FilterGroup | undefined): BlockRecord[] {
  if (!filter || filter.clauses.length === 0) {
    return [...rows];
  }
  return rows.filter((row) => matchesNode(row, filter));
}

/** Applies multi-column sorts to rows (stable). */
export function applySort(rows: BlockRecord[], sort: SortClause[] | undefined): BlockRecord[] {
  if (!sort || sort.length === 0) {
    return [...rows];
  }
  return [...rows].sort((a, b) => {
    for (const clause of sort) {
      const result = compareValues(
        propertyScalar(a, clause.property),
        propertyScalar(b, clause.property),
      );
      if (result !== 0) {
        return clause.direction === 'descending' ? -result : result;
      }
    }
    return 0;
  });
}

/** Query input for `POST /api/v3/queryCollection`. */
export interface CollectionQueryInput {
  filter?: FilterGroup;
  sort?: SortClause[];
  limit?: number;
  offset?: number;
  search?: string;
}

/** Query result with the pre-pagination total. */
export interface CollectionQueryResult {
  results: BlockRecord[];
  total: number;
}

/** Executes a collection query: search -> filter -> sort -> paginate. */
export function executeCollectionQuery(
  rows: BlockRecord[],
  query: CollectionQueryInput,
): CollectionQueryResult {
  let working = [...rows];
  if (query.search && query.search.trim().length > 0) {
    const needle = query.search.toLowerCase();
    working = working.filter((row) => {
      const title = propertyScalar(row, 'title');
      return typeof title === 'string' && title.toLowerCase().includes(needle);
    });
  }
  working = applyFilter(working, query.filter);
  working = applySort(working, query.sort);
  const total = working.length;
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit === undefined ? working.length : Math.max(0, query.limit);
  return { results: working.slice(offset, offset + limit), total };
}
