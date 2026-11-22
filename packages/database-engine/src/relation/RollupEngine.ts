/**
 * Rollup engine: traverse a relation, read a target property on each related
 * record, and aggregate the values.
 */

import type {
  CollectionProperty,
  CollectionSchema,
  RollupAggregation,
  UUID,
} from '@votion/types';
import { formatPropertyValue, isPropertyValueEmpty, toTimestamp } from '../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../types.js';
import type { RelationResolver } from './RelationResolver.js';

/** Constructor dependencies of {@link RollupEngine}. */
export interface RollupEngineOptions {
  resolver: RelationResolver;
  getSchema: (collectionId: UUID) => CollectionSchema | undefined;
}

/** Result of a rollup calculation. */
export interface RollupResult {
  value: unknown;
  isEmpty: boolean;
  display: string;
  /** Numeric result when the aggregation produces one. */
  numeric: number | null;
}

function numericList(values: unknown[]): number[] {
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

function distinct(values: unknown[]): unknown[] {
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
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function emptyResult(): RollupResult {
  return { value: null, isEmpty: true, display: '', numeric: null };
}

/** Executes rollup aggregations over related records. */
export class RollupEngine {
  constructor(private readonly options: RollupEngineOptions) {}

  /** Computes a rollup property for a record. */
  compute(
    record: DatabaseRecord,
    schema: CollectionSchema,
    propertyId: string,
    property: CollectionProperty,
  ): RollupResult {
    const config = property.rollup;
    const relationPropertyId = config?.relation_property_id ?? property.relation_property_id;
    const targetPropertyId = config?.target_property_id ?? property.target_property_id;
    if (!relationPropertyId || !targetPropertyId) {
      return emptyResult();
    }

    const relationProperty = schema[relationPropertyId];
    if (!relationProperty) {
      return emptyResult();
    }

    const related = this.options.resolver.resolveTargets(
      record,
      relationPropertyId,
      relationProperty,
    );
    const targetCollectionId = this.options.resolver.targetCollectionId(relationProperty);
    const targetSchema = targetCollectionId
      ? this.options.getSchema(targetCollectionId)
      : undefined;
    const targetProperty = targetSchema?.[targetPropertyId];
    const values = related.map((entry) => entry.properties[targetPropertyId]);
    const aggregation: RollupAggregation = config?.aggregation ?? 'count_all';

    const displayValue = (value: unknown): string =>
      targetProperty
        ? formatPropertyValue(value, targetProperty)
        : value == null
          ? ''
          : String(value);

    switch (aggregation) {
      case 'count_all':
        return {
          value: related.length,
          isEmpty: related.length === 0,
          display: String(related.length),
          numeric: related.length,
        };
      case 'count':
      case 'count_not_empty': {
        const count = values.filter((value) => !isPropertyValueEmpty(value)).length;
        return { value: count, isEmpty: count === 0, display: String(count), numeric: count };
      }
      case 'count_empty': {
        const count = values.filter((value) => isPropertyValueEmpty(value)).length;
        return { value: count, isEmpty: count === 0, display: String(count), numeric: count };
      }
      case 'count_unique': {
        const unique = distinct(values.filter((value) => !isPropertyValueEmpty(value)));
        return {
          value: unique.length,
          isEmpty: unique.length === 0,
          display: String(unique.length),
          numeric: unique.length,
        };
      }
      case 'show_original':
        return {
          value: values,
          isEmpty: values.length === 0,
          display: values.map(displayValue).join(', '),
          numeric: null,
        };
      case 'show_unique': {
        const unique = distinct(values.filter((value) => !isPropertyValueEmpty(value)));
        return {
          value: unique,
          isEmpty: unique.length === 0,
          display: unique.map(displayValue).join(', '),
          numeric: null,
        };
      }
      case 'sum': {
        const numbers = numericList(values);
        const sum = numbers.reduce((total, value) => total + value, 0);
        return {
          value: sum,
          isEmpty: numbers.length === 0,
          display: targetProperty?.type === 'number' ? displayValue(sum) : String(sum),
          numeric: sum,
        };
      }
      case 'average': {
        const numbers = numericList(values);
        const average = numbers.length === 0 ? 0 : numbers.reduce((t, v) => t + v, 0) / numbers.length;
        return {
          value: average,
          isEmpty: numbers.length === 0,
          display: targetProperty?.type === 'number' ? displayValue(average) : String(average),
          numeric: average,
        };
      }
      case 'median': {
        const result = median(numericList(values));
        return {
          value: result,
          isEmpty: numericList(values).length === 0,
          display: targetProperty?.type === 'number' ? displayValue(result) : String(result),
          numeric: result,
        };
      }
      case 'min': {
        const numbers = numericList(values);
        const result = numbers.length === 0 ? 0 : Math.min(...numbers);
        return {
          value: result,
          isEmpty: numbers.length === 0,
          display: targetProperty?.type === 'number' ? displayValue(result) : String(result),
          numeric: result,
        };
      }
      case 'max': {
        const numbers = numericList(values);
        const result = numbers.length === 0 ? 0 : Math.max(...numbers);
        return {
          value: result,
          isEmpty: numbers.length === 0,
          display: targetProperty?.type === 'number' ? displayValue(result) : String(result),
          numeric: result,
        };
      }
      case 'range': {
        const numbers = numericList(values);
        const result = numbers.length === 0 ? 0 : Math.max(...numbers) - Math.min(...numbers);
        return { value: result, isEmpty: numbers.length === 0, display: String(result), numeric: result };
      }
      case 'percent_empty':
      case 'percent_not_empty': {
        const empty = values.filter((value) => isPropertyValueEmpty(value)).length;
        const percent =
          values.length === 0
            ? 0
            : aggregation === 'percent_empty'
              ? (empty / values.length) * 100
              : ((values.length - empty) / values.length) * 100;
        return {
          value: percent,
          isEmpty: values.length === 0,
          display: `${percent.toFixed(0)}%`,
          numeric: percent,
        };
      }
      case 'earliest_date':
      case 'latest_date': {
        const timestamps = values
          .map((value) => toTimestamp(value))
          .filter((value): value is number => value != null);
        if (timestamps.length === 0) {
          return emptyResult();
        }
        const timestamp =
          aggregation === 'earliest_date' ? Math.min(...timestamps) : Math.max(...timestamps);
        const iso = new Date(timestamp).toISOString();
        return {
          value: iso,
          isEmpty: false,
          display: targetProperty ? displayValue(iso) : iso,
          numeric: timestamp,
        };
      }
      case 'date_range': {
        const timestamps = values
          .map((value) => toTimestamp(value))
          .filter((value): value is number => value != null);
        if (timestamps.length < 2) {
          return { value: 0, isEmpty: timestamps.length === 0, display: '0 days', numeric: 0 };
        }
        const days = Math.round(
          (Math.max(...timestamps) - Math.min(...timestamps)) / (24 * 60 * 60 * 1000),
        );
        return { value: days, isEmpty: false, display: `${days} days`, numeric: days };
      }
      default:
        return emptyResult();
    }
  }
}

/** Returns the aggregation configured on a rollup property. */
export function rollupAggregation(property: CollectionProperty): RollupAggregation {
  return property.rollup?.aggregation ?? 'count_all';
}
