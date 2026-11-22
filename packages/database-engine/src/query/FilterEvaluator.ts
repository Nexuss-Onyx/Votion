/**
 * Recursive filter evaluator.
 *
 * Supports unbounded `AND` / `OR` nesting and type-specific comparators. The
 * evaluator is pure: it never reads the store, so the same filter tree can run
 * on the client, on the server, or inside a worker.
 */

import type {
  CollectionProperty,
  CollectionSchema,
  FilterClause,
  FilterComparator,
  FilterGroup,
  FilterNode,
  PropertyType,
  RichText,
} from '@votion/types';
import { isFilterGroup } from '@votion/types';
import { isPropertyValueEmpty, toTimestamp } from '../schema/PropertyRegistry.js';
import {
  readRecordProperty,
  resolvePropertyEntry,
  resolveRecordTitle,
  richTextToString,
} from '../types.js';
import type { FilterableRecord } from '../types.js';

/** Options accepted by the filter evaluator. */
export interface FilterEvaluateOptions {
  /** Reference "now" for relative-date comparators. */
  now?: Date;
}

/** Thrown for malformed filter trees or unknown comparators. */
export class FilterEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterEvaluationError';
  }
}

function propertyTypeForRef(
  schema: CollectionSchema,
  propertyRef: string,
): PropertyType | undefined {
  const entry = resolvePropertyEntry(schema, propertyRef);
  if (entry) {
    return entry[1].type;
  }
  switch (propertyRef.toLowerCase()) {
    case 'created_time':
      return 'created_time';
    case 'last_edited_time':
      return 'last_edited_time';
    case 'created_by':
      return 'created_by';
    case 'last_edited_by':
      return 'last_edited_by';
    case 'id':
    case 'title':
      return 'title';
    default:
      return undefined;
  }
}

function propertyForRef(
  schema: CollectionSchema,
  propertyRef: string,
): CollectionProperty | undefined {
  const entry = resolvePropertyEntry(schema, propertyRef);
  if (entry) {
    return entry[1];
  }
  switch (propertyRef.toLowerCase()) {
    case 'created_time':
      return { name: 'Created time', type: 'created_time' };
    case 'last_edited_time':
      return { name: 'Last edited time', type: 'last_edited_time' };
    case 'created_by':
      return { name: 'Created by', type: 'created_by' };
    case 'last_edited_by':
      return { name: 'Last edited by', type: 'last_edited_by' };
    case 'id':
      return { name: 'ID', type: 'unique_id' };
    case 'title':
      return { name: 'Title', type: 'title' };
    default:
      return undefined;
  }
}

function asString(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      return richTextToString(value as RichText);
    }
    return value.map((entry) => asString(entry)).join(', ');
  }
  if (typeof value === 'object' && 'start' in (value as Record<string, unknown>)) {
    return String((value as { start?: unknown }).start ?? '');
  }
  return '';
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveOptionId(property: CollectionProperty | undefined, value: unknown): unknown {
  if (typeof value !== 'string' || !property?.options?.length) {
    return value;
  }
  const byValue = property.options.find(
    (option) => option.value.toLowerCase() === value.toLowerCase(),
  );
  return byValue?.id ?? value;
}

function truthy(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.trim() !== '' && value.toLowerCase() !== 'false';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function isEmpty(recordValue: unknown, property: CollectionProperty | undefined): boolean {
  if (recordValue == null) {
    return true;
  }
  if (property?.type === 'checkbox') {
    return false;
  }
  if (property?.type === 'multi_select' || property?.type === 'relation') {
    return !Array.isArray(recordValue) || recordValue.length === 0;
  }
  return isPropertyValueEmpty(recordValue);
}

function compareNumbers(
  recordValue: unknown,
  target: unknown,
  comparator: FilterComparator,
): boolean {
  const left = numericValue(recordValue);
  const right = numericValue(target);
  if (left == null || right == null) {
    return false;
  }
  switch (comparator) {
    case 'greater_than':
      return left > right;
    case 'greater_than_or_equal':
      return left >= right;
    case 'less_than':
      return left < right;
    case 'less_than_or_equal':
      return left <= right;
    default:
      return false;
  }
}

function compareDates(
  recordValue: unknown,
  target: unknown,
  comparator: FilterComparator,
): boolean {
  const left = toTimestamp(recordValue);
  const right = toTimestamp(target);
  if (left == null || right == null) {
    return false;
  }
  switch (comparator) {
    case 'before':
      return left < right;
    case 'after':
      return left > right;
    case 'on_or_before':
      return left <= right;
    case 'on_or_after':
      return left >= right;
    default:
      return false;
  }
}

function compareStrings(
  recordValue: unknown,
  target: unknown,
  comparator: FilterComparator,
): boolean {
  const left = asString(recordValue).toLowerCase();
  const right = asString(target).toLowerCase();
  switch (comparator) {
    case 'greater_than':
      return left > right;
    case 'greater_than_or_equal':
      return left >= right;
    case 'less_than':
      return left < right;
    case 'less_than_or_equal':
      return left <= right;
    default:
      return false;
  }
}

function relativeWindow(
  target: unknown,
  now: Date,
): { start: number; end: number } | null {
  const day = 24 * 60 * 60 * 1000;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  switch (String(target ?? '').toLowerCase()) {
    case 'today':
      return { start: today, end: today + day };
    case 'tomorrow':
      return { start: today + day, end: today + 2 * day };
    case 'yesterday':
      return { start: today - day, end: today };
    case 'past_week':
      return { start: today - 7 * day, end: today + day };
    case 'next_week':
      return { start: today, end: today + 7 * day };
    case 'past_month':
      return { start: today - 30 * day, end: today + day };
    case 'next_month':
      return { start: today, end: today + 30 * day };
    case 'past_year':
      return { start: today - 365 * day, end: today + day };
    case 'next_year':
      return { start: today, end: today + 365 * day };
    default:
      return null;
  }
}

function evaluateClause(
  clause: FilterClause,
  record: FilterableRecord,
  schema: CollectionSchema,
  options: FilterEvaluateOptions,
): boolean {
  const property = propertyForRef(schema, clause.property);
  const type = propertyTypeForRef(schema, clause.property);
  const raw = readRecordProperty(record, schema, clause.property);
  const comparator = clause.comparator;
  const target = clause.value;

  switch (comparator) {
    case 'is_empty':
      return isEmpty(raw, property);
    case 'is_not_empty':
      return !isEmpty(raw, property);
    case 'is_checked':
      return raw === true;
    case 'is_not_checked':
      return raw !== true;
    case 'equals':
    case 'not_equals': {
      let equal: boolean;
      if (type === 'checkbox') {
        equal = truthy(raw) === truthy(target);
      } else if (type === 'multi_select' || type === 'relation') {
        const values = asArray(raw).map((entry) => asString(entry).toLowerCase());
        equal = values.includes(asString(resolveOptionId(property, target)).toLowerCase());
      } else if (type === 'select' || type === 'status') {
        const leftId = resolveOptionId(property, raw);
        const rightId = resolveOptionId(property, target);
        equal = leftId != null && rightId != null && leftId === rightId;
      } else if (type === 'number') {
        const left = numericValue(raw);
        const right = numericValue(target);
        equal = left != null && right != null && left === right;
      } else if (type === 'date') {
        equal = toTimestamp(raw) === toTimestamp(target);
      } else {
        equal = asString(raw).toLowerCase() === asString(target).toLowerCase();
      }
      return comparator === 'equals' ? equal : !equal;
    }
    case 'contains':
    case 'does_not_contain': {
      let contains: boolean;
      if (type === 'multi_select' || type === 'relation' || Array.isArray(raw)) {
        contains = asArray(raw)
          .map((entry) => asString(entry).toLowerCase())
          .includes(asString(resolveOptionId(property, target)).toLowerCase());
      } else if (type === 'file') {
        contains = asArray(raw).some((entry) => {
          if (typeof entry === 'object' && entry != null) {
            return asString((entry as { name?: unknown }).name)
              .toLowerCase()
              .includes(asString(target).toLowerCase());
          }
          return false;
        });
      } else {
        contains = asString(raw)
          .toLowerCase()
          .includes(asString(target).toLowerCase());
      }
      return comparator === 'contains' ? contains : !contains;
    }
    case 'starts_with':
      return asString(raw).toLowerCase().startsWith(asString(target).toLowerCase());
    case 'ends_with':
      return asString(raw).toLowerCase().endsWith(asString(target).toLowerCase());
    case 'greater_than':
    case 'greater_than_or_equal':
    case 'less_than':
    case 'less_than_or_equal':
      if (type === 'number') {
        return compareNumbers(raw, target, comparator);
      }
      if (type === 'date' || toTimestamp(raw) != null) {
        return compareDates(raw, target, comparator);
      }
      return compareStrings(raw, target, comparator);
    case 'before':
    case 'after':
    case 'on_or_before':
    case 'on_or_after':
      return compareDates(raw, target, comparator);
    case 'is_within': {
      const start =
        target != null && typeof target === 'object' && 'start' in (target as object)
          ? toTimestamp((target as { start?: unknown }).start)
          : Array.isArray(target)
            ? toTimestamp(target[0])
            : null;
      const end =
        target != null && typeof target === 'object' && 'end' in (target as object)
          ? toTimestamp((target as { end?: unknown }).end)
          : Array.isArray(target)
            ? toTimestamp(target[1])
            : null;
      const value = toTimestamp(raw);
      if (value == null || start == null || end == null) {
        return false;
      }
      return value >= start && value <= end;
    }
    case 'is_relative_to_today': {
      const window = relativeWindow(target, options.now ?? new Date());
      const value = toTimestamp(raw);
      if (!window || value == null) {
        return false;
      }
      return value >= window.start && value < window.end;
    }
    default:
      throw new FilterEvaluationError(
        `Unsupported filter comparator: ${String(comparator)}`,
      );
  }
}

/** Recursively evaluates a filter node against one record. */
export function evaluateFilterNode(
  node: FilterNode | undefined,
  record: FilterableRecord,
  schema: CollectionSchema,
  options: FilterEvaluateOptions = {},
): boolean {
  if (!node) {
    return true;
  }
  if (isFilterGroup(node)) {
    return evaluateGroup(node, record, schema, options);
  }
  return evaluateClause(node, record, schema, options);
}

/** Evaluates a compound group, short-circuiting where possible. */
export function evaluateGroup(
  group: FilterGroup,
  record: FilterableRecord,
  schema: CollectionSchema,
  options: FilterEvaluateOptions = {},
): boolean {
  if (group.operator === 'and') {
    for (const clause of group.clauses) {
      if (!evaluateFilterNode(clause, record, schema, options)) {
        return false;
      }
    }
    return true;
  }
  if (group.operator === 'or') {
    for (const clause of group.clauses) {
      if (evaluateFilterNode(clause, record, schema, options)) {
        return true;
      }
    }
    return false;
  }
  throw new FilterEvaluationError(
    `Unsupported filter operator: ${String(group.operator)}`,
  );
}

/** Convenience wrapper for a whole `query2.filter` tree. */
export function evaluateFilter(
  filter: FilterGroup | FilterClause | undefined,
  record: FilterableRecord,
  schema: CollectionSchema,
  options: FilterEvaluateOptions = {},
): boolean {
  return evaluateFilterNode(filter, record, schema, options);
}

/** Returns the ids of records matching a filter tree. */
export function filterRecords<T extends FilterableRecord>(
  records: T[],
  filter: FilterGroup | FilterClause | undefined,
  schema: CollectionSchema,
  options: FilterEvaluateOptions = {},
): T[] {
  return records.filter((record) => evaluateFilter(filter, record, schema, options));
}

/** Resolves a record title for filters addressed by the `title` property. */
export function filterableTitle(
  record: FilterableRecord,
  schema: CollectionSchema,
): string {
  return resolveRecordTitle(record, schema);
}
