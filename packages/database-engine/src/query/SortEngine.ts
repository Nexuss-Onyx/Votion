/**
 * Multi-level sort engine.
 *
 * Sorting is type-aware (numbers numerically, dates chronologically, select
 * options by their declared order) and empty values always sink to the end,
 * regardless of direction — matching Notion's database behaviour.
 */

import type {
  CollectionProperty,
  CollectionSchema,
  PropertyType,
  SortClause,
  SortDirection,
} from '@votion/types';
import { propertyValueToComparable, toTimestamp } from '../schema/PropertyRegistry.js';
import { readRecordProperty } from '../types.js';
import type { FilterableRecord } from '../types.js';

function propertyTypeForRef(
  schema: CollectionSchema,
  propertyRef: string,
): PropertyType | undefined {
  for (const [propertyId, property] of Object.entries(schema)) {
    if (propertyId === propertyRef || property.name.toLowerCase() === propertyRef.toLowerCase()) {
      return property.type;
    }
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
      return 'unique_id';
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
  const direct = schema[propertyRef];
  if (direct) {
    return direct;
  }
  for (const property of Object.values(schema)) {
    if (property.name.toLowerCase() === propertyRef.toLowerCase()) {
      return property;
    }
  }
  return undefined;
}

/** Extracts a comparable primitive from a record property. */
export function comparableValue(
  record: FilterableRecord,
  schema: CollectionSchema,
  propertyRef: string,
): { empty: boolean; value: string | number } {
  const type = propertyTypeForRef(schema, propertyRef);
  const raw = readRecordProperty(record, schema, propertyRef);

  if (raw == null || raw === '') {
    return { empty: true, value: 0 };
  }
  if (type === 'checkbox') {
    return { empty: false, value: raw === true ? 1 : 0 };
  }
  if (type === 'date' || type === 'created_time' || type === 'last_edited_time') {
    const timestamp = toTimestamp(raw);
    return timestamp == null
      ? { empty: true, value: 0 }
      : { empty: false, value: timestamp };
  }
  if (type === 'relation' || type === 'person' || type === 'file') {
    const length = Array.isArray(raw) ? raw.length : typeof raw === 'string' ? 1 : 0;
    return { empty: length === 0, value: length };
  }
  if (type === 'multi_select') {
    const values = Array.isArray(raw) ? raw : [];
    return { empty: values.length === 0, value: values.length };
  }

  const property = propertyForRef(schema, propertyRef);
  const comparable = propertyValueToComparable(raw, property ?? { name: '', type: type ?? 'text' });
  if (comparable == null) {
    return { empty: true, value: 0 };
  }
  return { empty: false, value: comparable };
}

/** Compares two records for a single sort clause. */
export function compareRecords(
  left: FilterableRecord,
  right: FilterableRecord,
  sort: SortClause,
  schema: CollectionSchema,
): number {
  const a = comparableValue(left, schema, sort.property);
  const b = comparableValue(right, schema, sort.property);

  // Empty values always sort last, independent of direction.
  if (a.empty !== b.empty) {
    return a.empty ? 1 : -1;
  }
  if (a.empty && b.empty) {
    return 0;
  }

  let result: number;
  if (typeof a.value === 'number' && typeof b.value === 'number') {
    result = a.value - b.value;
  } else {
    result = String(a.value).localeCompare(String(b.value));
  }
  return sort.direction === 'descending' ? -result : result;
}

/** Applies a multi-level sort, returning a new array. */
export function sortRecords<T extends FilterableRecord>(
  records: T[],
  sorts: SortClause[] | undefined,
  schema: CollectionSchema,
): T[] {
  if (!sorts || sorts.length === 0) {
    return [...records];
  }
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      for (const sort of sorts) {
        const result = compareRecords(left.record, right.record, sort, schema);
        if (result !== 0) {
          return result;
        }
      }
      return left.index - right.index;
    })
    .map((entry) => entry.record);
}

/** Reverses a sort direction. */
export function toggleSortDirection(direction: SortDirection): SortDirection {
  return direction === 'ascending' ? 'descending' : 'ascending';
}

/** Returns the schema property type for a sort reference. */
export function sortPropertyType(
  schema: CollectionSchema,
  propertyRef: string,
): PropertyType | undefined {
  return propertyTypeForRef(schema, propertyRef);
}
