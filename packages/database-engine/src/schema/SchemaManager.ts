/**
 * Schema manager: pure schema transforms plus transaction factories.
 *
 * The transforms are pure so they can be applied optimistically on the client
 * and unit-tested without a store. The transaction factories produce
 * path-addressed operations for `POST /api/v3/saveTransactions`, so a schema
 * edit is replayed atomically on the server.
 */

import type { CollectionProperty, CollectionSchema, Transaction, UUID } from '@votion/types';
import { TransactionBuilder } from '@votion/sync-client';
import { createPropertyId } from '../types.js';
import { createProperty } from './PropertyRegistry.js';

/** Record pointer for schema operations. */
export interface SchemaManagerTarget {
  spaceId: UUID;
  collectionId: UUID;
}

/** Adds (or replaces) a property in a schema map, preserving key order. */
export function addPropertyToSchema(
  schema: CollectionSchema,
  propertyId: string,
  property: CollectionProperty,
): CollectionSchema {
  return { ...schema, [propertyId]: property };
}

/** Renames a property, leaving its position and options untouched. */
export function renamePropertyInSchema(
  schema: CollectionSchema,
  propertyId: string,
  name: string,
): CollectionSchema {
  const property = schema[propertyId];
  if (!property) {
    return schema;
  }
  return { ...schema, [propertyId]: { ...property, name } };
}

/** Deletes a property from a schema map. */
export function deletePropertyFromSchema(
  schema: CollectionSchema,
  propertyId: string,
): CollectionSchema {
  if (!Object.prototype.hasOwnProperty.call(schema, propertyId)) {
    return schema;
  }
  const next: CollectionSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key !== propertyId) {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Reorders a property to sit immediately after `targetPropertyId`.
 *
 * `targetPropertyId === null` moves the property to the front of the schema.
 */
export function reorderPropertyInSchema(
  schema: CollectionSchema,
  propertyId: string,
  targetPropertyId: string | null,
): CollectionSchema {
  const entries = Object.entries(schema);
  const index = entries.findIndex(([key]) => key === propertyId);
  if (index < 0) {
    return schema;
  }
  const [entry] = entries.splice(index, 1);
  if (!entry) {
    return schema;
  }
  const insertAt =
    targetPropertyId === null
      ? 0
      : entries.findIndex(([key]) => key === targetPropertyId) + 1;
  if (insertAt < 0) {
    entries.push(entry);
  } else {
    entries.splice(insertAt, 0, entry);
  }
  return Object.fromEntries(entries);
}

/** Merges a patch into a single property definition. */
export function updatePropertyInSchema(
  schema: CollectionSchema,
  propertyId: string,
  patch: Partial<CollectionProperty>,
): CollectionSchema {
  const property = schema[propertyId];
  if (!property) {
    return schema;
  }
  return { ...schema, [propertyId]: { ...property, ...patch } };
}

/** Toggles the `hidden` flag used by the table view. */
export function setPropertyHiddenInSchema(
  schema: CollectionSchema,
  propertyId: string,
  hidden: boolean,
): CollectionSchema {
  return updatePropertyInSchema(schema, propertyId, { hidden });
}

/** Duplicates a property with a fresh id and a ` (copy)` suffix. */
export function duplicatePropertyInSchema(
  schema: CollectionSchema,
  propertyId: string,
  newPropertyId: string = createPropertyId('prop'),
): { schema: CollectionSchema; propertyId: string } {
  const property = schema[propertyId];
  if (!property) {
    return { schema, propertyId };
  }
  const clone: CollectionProperty = {
    ...property,
    name: `${property.name} (copy)`,
    options: property.options?.map((option) => ({ ...option })),
    groups: property.groups?.map((group) => ({ ...group })),
  };
  return {
    schema: { ...schema, [newPropertyId]: clone },
    propertyId: newPropertyId,
  };
}

/** Returns the ordered property entries, optionally excluding hidden ones. */
export function orderedProperties(
  schema: CollectionSchema,
  options: { includeHidden?: boolean } = {},
): [string, CollectionProperty][] {
  return Object.entries(schema).filter(
    ([, property]) => options.includeHidden === true || !property.hidden,
  );
}

/** Creates a transaction adding one property. */
export function buildAddPropertyTransaction(
  target: SchemaManagerTarget,
  propertyId: string,
  property: CollectionProperty,
): Transaction {
  return new TransactionBuilder({
    spaceId: target.spaceId,
    table: 'collection',
    id: target.collectionId,
  })
    .keyedObjectSet(['schema'], propertyId, property)
    .build();
}

/** Creates a transaction renaming one property. */
export function buildRenamePropertyTransaction(
  target: SchemaManagerTarget,
  propertyId: string,
  name: string,
): Transaction {
  return new TransactionBuilder({
    spaceId: target.spaceId,
    table: 'collection',
    id: target.collectionId,
  })
    .keyedObjectSet(['schema', propertyId], 'name', name)
    .build();
}

/** Creates a transaction patching one property. */
export function buildUpdatePropertyTransaction(
  target: SchemaManagerTarget,
  propertyId: string,
  patch: Partial<CollectionProperty>,
): Transaction {
  const builder = new TransactionBuilder({
    spaceId: target.spaceId,
    table: 'collection',
    id: target.collectionId,
  });
  for (const [key, value] of Object.entries(patch)) {
    builder.keyedObjectSet(['schema', propertyId], key, value);
  }
  return builder.build();
}

/** Creates a transaction hiding/showing one property. */
export function buildSetPropertyHiddenTransaction(
  target: SchemaManagerTarget,
  propertyId: string,
  hidden: boolean,
): Transaction {
  return buildUpdatePropertyTransaction(target, propertyId, { hidden });
}

/** Creates a transaction deleting one property (replaces the schema map). */
export function buildDeletePropertyTransaction(
  target: SchemaManagerTarget,
  schema: CollectionSchema,
  propertyId: string,
): Transaction {
  const next = deletePropertyFromSchema(schema, propertyId);
  return new TransactionBuilder({
    spaceId: target.spaceId,
    table: 'collection',
    id: target.collectionId,
  })
    .set(['schema'], next)
    .build();
}

/** Creates a transaction reordering one property. */
export function buildReorderPropertyTransaction(
  target: SchemaManagerTarget,
  schema: CollectionSchema,
  propertyId: string,
  targetPropertyId: string | null,
): Transaction {
  const next = reorderPropertyInSchema(schema, propertyId, targetPropertyId);
  return new TransactionBuilder({
    spaceId: target.spaceId,
    table: 'collection',
    id: target.collectionId,
  })
    .set(['schema'], next)
    .build();
}

/** Creates a transaction duplicating one property. */
export function buildDuplicatePropertyTransaction(
  target: SchemaManagerTarget,
  schema: CollectionSchema,
  propertyId: string,
  newPropertyId: string = createPropertyId('prop'),
): { transaction: Transaction; propertyId: string } {
  const result = duplicatePropertyInSchema(schema, propertyId, newPropertyId);
  const transaction = new TransactionBuilder({
    spaceId: target.spaceId,
    table: 'collection',
    id: target.collectionId,
  })
    .keyedObjectSet(['schema'], result.propertyId, result.schema[result.propertyId])
    .build();
  return { transaction, propertyId: result.propertyId };
}

/** Creates a full collection schema with a title property and one property. */
export function createDefaultSchema(
  titlePropertyName = 'Name',
  extra: CollectionProperty[] = [],
): { schema: CollectionSchema; titlePropertyId: string } {
  const titlePropertyId = createPropertyId('title');
  let schema: CollectionSchema = {
    [titlePropertyId]: createProperty('title', titlePropertyName),
  };
  for (const property of extra) {
    schema = addPropertyToSchema(schema, createPropertyId('prop'), property);
  }
  return { schema, titlePropertyId };
}
