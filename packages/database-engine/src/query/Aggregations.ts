/**
 * Footer / rollup aggregation primitives shared by the table view and tests.
 */

import type {
  AggregationClause,
  CollectionProperty,
  CollectionSchema,
} from '@votion/types';
import { isPropertyValueEmpty, toTimestamp } from '../schema/PropertyRegistry.js';
import { readRecordProperty } from '../types.js';
import type { FilterableRecord } from '../types.js';

/** Aggregation names understood by {@link computeAggregation}. */
export type AggregationName = AggregationClause['aggregation'];

function numericValues(values: unknown[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      result.push(value);
    } else if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        result.push(parsed);
      }
    }
  }
  return result;
}

function distinctValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const value of values) {
    const key = Array.isArray(value) ? value.join(',') : String(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function median(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? 0;
}

/** Computes one aggregation over raw property values. */
export function computeAggregation(
  values: unknown[],
  aggregation: AggregationName,
): number {
  switch (aggregation) {
    case 'count':
      return values.length;
    case 'count_values':
      return values.filter((value) => !isPropertyValueEmpty(value)).length;
    case 'count_empty':
      return values.filter((value) => isPropertyValueEmpty(value)).length;
    case 'count_unique':
      return distinctValues(
        values.filter((value) => !isPropertyValueEmpty(value)),
      ).length;
    case 'sum': {
      const numbers = numericValues(values);
      return numbers.reduce((total, value) => total + value, 0);
    }
    case 'average': {
      const numbers = numericValues(values);
      return numbers.length === 0
        ? 0
        : numbers.reduce((total, value) => total + value, 0) / numbers.length;
    }
    case 'median':
      return median(numericValues(values));
    case 'min': {
      const numbers = numericValues(values);
      return numbers.length === 0 ? 0 : Math.min(...numbers);
    }
    case 'max': {
      const numbers = numericValues(values);
      return numbers.length === 0 ? 0 : Math.max(...numbers);
    }
    case 'range': {
      const numbers = numericValues(values);
      return numbers.length === 0 ? 0 : Math.max(...numbers) - Math.min(...numbers);
    }
    default:
      return 0;
  }
}

/** Computes an aggregation clause against a set of records. */
export function aggregateRecords(
  records: FilterableRecord[],
  clause: AggregationClause,
  schema: CollectionSchema,
): number {
  const values = records.map((record) =>
    readRecordProperty(record, schema, clause.property),
  );
  return computeAggregation(values, clause.aggregation);
}

/** A labelled footer cell. */
export interface FooterValue {
  label: string;
  value: string;
  /** Numeric value when the aggregation produces one. */
  numeric: number | null;
}

/**
 * Chooses the most useful footer aggregation for a property type and computes
 * it across a record set.
 */
export function computeFooterValue(
  records: FilterableRecord[],
  property: CollectionProperty,
  schema: CollectionSchema,
  propertyId: string,
): FooterValue {
  const values = records.map((record) => readRecordProperty(record, schema, propertyId));

  if (property.type === 'checkbox') {
    const total = values.length;
    const checked = values.filter((value) => value === true).length;
    const percent = total === 0 ? 0 : (checked / total) * 100;
    return {
      label: 'Percent checked',
      value: `${percent.toFixed(0)}%`,
      numeric: percent,
    };
  }
  if (property.type === 'number') {
    const sum = computeAggregation(values, 'sum');
    const average = computeAggregation(values, 'average');
    return {
      label: 'Sum / Average',
      value: `${formatNumber(sum)} / ${formatNumber(average)}`,
      numeric: sum,
    };
  }
  if (property.type === 'select' || property.type === 'status') {
    const unique = computeAggregation(values, 'count_unique');
    const total = computeAggregation(values, 'count_values');
    return {
      label: 'Unique / Values',
      value: `${unique} / ${total}`,
      numeric: unique,
    };
  }
  if (property.type === 'date') {
    const timestamps = values
      .map((value) => toTimestamp(value))
      .filter((value): value is number => value != null);
    const empty = values.length - timestamps.length;
    return {
      label: 'Dates / Empty',
      value: `${timestamps.length} / ${empty}`,
      numeric: timestamps.length,
    };
  }
  const nonEmpty = computeAggregation(values, 'count_values');
  return { label: 'Count', value: String(nonEmpty), numeric: nonEmpty };
}

/** Formats a footer number without locale-specific currency. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

/** Computes footer values for many properties at once. */
export function computeFooters(
  records: FilterableRecord[],
  schema: CollectionSchema,
  propertyIds: string[],
): Record<string, FooterValue> {
  const result: Record<string, FooterValue> = {};
  for (const propertyId of propertyIds) {
    const property = schema[propertyId];
    if (!property) {
      continue;
    }
    result[propertyId] = computeFooterValue(records, property, schema, propertyId);
  }
  return result;
}
