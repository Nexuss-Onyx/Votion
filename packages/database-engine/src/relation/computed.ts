/**
 * Computed cell values: formula and rollup properties resolved on demand.
 */

import type { CollectionProperty, CollectionSchema, UUID } from '@votion/types';
import { evaluateRecordFormula, formulaResultToStored } from '../formula/Evaluator.js';
import { formatPropertyValue } from '../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../types.js';
import { RollupEngine } from './RollupEngine.js';
import type { RelationResolver } from './RelationResolver.js';

/** Dependencies for computed values. */
export interface ComputedValueOptions {
  resolver?: RelationResolver;
  getSchema?: (collectionId: UUID) => CollectionSchema | undefined;
  rollupEngine?: RollupEngine;
}

/** Resolves the effective value of a property cell. */
export function computeRecordCellValue(
  record: DatabaseRecord,
  schema: CollectionSchema,
  propertyId: string,
  property: CollectionProperty,
  options: ComputedValueOptions = {},
): unknown {
  switch (property.type) {
    case 'formula':
      return formulaResultToStored(
        evaluateRecordFormula(record, schema, property.formula ?? ''),
      );
    case 'rollup': {
      if (!options.rollupEngine) {
        return null;
      }
      return options.rollupEngine.compute(record, schema, propertyId, property).value;
    }
    case 'relation': {
      if (!options.resolver) {
        return record.properties[propertyId] ?? [];
      }
      return options.resolver
        .resolveTargets(record, propertyId, property)
        .map((target) => target.title);
    }
    default:
      return record.properties[propertyId] ?? null;
  }
}

/** Renders a property cell as a display string. */
export function computeRecordDisplayValue(
  record: DatabaseRecord,
  schema: CollectionSchema,
  propertyId: string,
  property: CollectionProperty,
  options: ComputedValueOptions = {},
): string {
  const value = computeRecordCellValue(record, schema, propertyId, property, options);
  return formatPropertyValue(value, property);
}

/** Creates a reusable cell-value computer bound to a schema. */
export function createCellValueComputer(
  schema: CollectionSchema,
  options: ComputedValueOptions = {},
): (record: DatabaseRecord, propertyId: string) => unknown {
  return (record, propertyId) => {
    const property = schema[propertyId];
    if (!property) {
      return null;
    }
    return computeRecordCellValue(record, schema, propertyId, property, options);
  };
}
