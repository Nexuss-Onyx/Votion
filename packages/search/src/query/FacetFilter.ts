/**
 * Meilisearch filter-expression primitives.
 *
 * Filters are strings, which makes them an injection surface: a page title or
 * a user id must never be interpolated raw. Every value produced here goes
 * through {@link escapeFilterValue}, which escapes `\` and `"` and rejects
 * control characters. Numeric bounds are validated as finite numbers.
 */

import type { Timestamp } from '@votion/types';

/** Attribute names usable inside a filter (see the index schema). */
export type FilterAttribute =
  | 'space_id'
  | 'parent_id'
  | 'root_page_id'
  | 'ancestor_ids'
  | 'access_principals'
  | 'created_by'
  | 'last_edited_time'
  | 'type'
  | 'alive';

/** Raised when a filter value cannot be represented safely. */
export class InvalidFilterValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFilterValueError';
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

/**
 * Quotes and escapes a string for use on the right-hand side of a Meilisearch
 * filter comparison.
 *
 * ```
 * escapeFilterValue('a" OR space_id != "b') // => "\"a\\\" OR space_id != \\\"b\""
 * ```
 */
export function escapeFilterValue(value: string): string {
  if (typeof value !== 'string') {
    throw new InvalidFilterValueError('Filter values must be strings');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidFilterValueError('Filter values must not be empty');
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    throw new InvalidFilterValueError(
      'Filter values must not contain control characters',
    );
  }
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** `attribute = value` for a single string value. */
export function equalsFilter(
  attribute: FilterAttribute,
  value: string,
): string {
  return `${attribute} = ${escapeFilterValue(value)}`;
}

/** `attribute = true|false` for boolean attributes. */
export function booleanFilter(
  attribute: FilterAttribute,
  value: boolean,
): string {
  return `${attribute} = ${value ? 'true' : 'false'}`;
}

/**
 * `attribute IN ["a", "b"]` for array-valued attributes.
 *
 * A single-element list degrades to `attribute = "a"` because Meilisearch's
 * equality operator already matches any member of an array.
 */
export function inFilter(
  attribute: FilterAttribute,
  values: readonly string[],
): string {
  const unique = dedupeNonEmpty(values);
  if (unique.length === 0) {
    throw new InvalidFilterValueError(
      `inFilter(${attribute}) requires at least one value`,
    );
  }
  if (unique.length === 1) {
    return equalsFilter(attribute, unique[0] as string);
  }
  const list = unique.map((value) => escapeFilterValue(value)).join(', ');
  return `${attribute} IN [${list}]`;
}

/** `attribute >= lower AND attribute <= upper` (inclusive numeric range). */
export function rangeFilter(
  attribute: FilterAttribute,
  bounds: { gte?: Timestamp; lte?: Timestamp },
): string {
  const clauses: string[] = [];
  if (bounds.gte !== undefined) {
    clauses.push(`${attribute} >= ${assertTimestamp(bounds.gte, 'gte')}`);
  }
  if (bounds.lte !== undefined) {
    clauses.push(`${attribute} <= ${assertTimestamp(bounds.lte, 'lte')}`);
  }
  return clauses.join(' AND ');
}

/**
 * Joins clauses with `OR`, parenthesising the result so it can be embedded in
 * an `AND` chain.
 */
export function anyOf(
  clauses: readonly (string | undefined | null | false)[],
): string {
  const present = clauses.filter(isPresentClause);
  if (present.length === 0) {
    return '';
  }
  if (present.length === 1) {
    return present[0] as string;
  }
  return `(${present.join(' OR ')})`;
}

/** Joins clauses with `AND`, dropping empty ones. */
export function allOf(
  clauses: readonly (string | undefined | null | false)[],
): string {
  const present = clauses.filter(isPresentClause);
  return present.join(' AND ');
}

/** Smallest subset of Meilisearch operators used by the builder. */
export function isPresentClause(
  clause: string | undefined | null | false,
): clause is string {
  return typeof clause === 'string' && clause.length > 0;
}

function dedupeNonEmpty(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function assertTimestamp(value: Timestamp, label: string): Timestamp {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InvalidFilterValueError(
      `rangeFilter bound "${label}" must be a non-negative epoch timestamp`,
    );
  }
  return Math.floor(value);
}
