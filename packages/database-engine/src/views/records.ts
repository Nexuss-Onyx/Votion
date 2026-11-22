/**
 * Record selection and view query application.
 */

import { useMemo } from 'react';
import type { Collection, CollectionView, CollectionSchema, UUID } from '@votion/types';
import {
  useRecordStore,
  type RecordStoreApi,
  type SelectorState,
} from '@votion/sync-client';
import { evaluateFilter } from '../query/FilterEvaluator.js';
import { sortRecords } from '../query/SortEngine.js';
import { formatPropertyValue } from '../schema/PropertyRegistry.js';
import { blockToDatabaseRecord, resolveRecordTitle } from '../types.js';
import type { DatabaseRecord } from '../types.js';

/** Returns every live page row belonging to a collection. */
export function selectCollectionRecords(
  state: SelectorState,
  collectionId: UUID,
): DatabaseRecord[] {
  const collection = state.collections[collectionId];
  if (!collection) {
    return [];
  }
  const records: DatabaseRecord[] = [];
  for (const block of Object.values(state.blocks)) {
    if (
      block.alive &&
      block.type === 'page' &&
      block.parent_table === 'collection' &&
      block.parent_id === collectionId
    ) {
      records.push(blockToDatabaseRecord(collection, block));
    }
  }
  records.sort((a, b) => a.createdAt - b.createdAt);
  return records;
}

/** React hook returning the live rows of a collection. */
export function useCollectionRecords(
  collectionId: UUID,
  store?: RecordStoreApi,
): DatabaseRecord[] {
  return useRecordStore(
    (state) => selectCollectionRecords(state, collectionId),
    store,
  );
}

/** React hook returning a collection by id. */
export function useCollection(
  collectionId: UUID,
  store?: RecordStoreApi,
): Collection | undefined {
  return useRecordStore((state) => state.collections[collectionId], store);
}

/** React hook returning a view by id. */
export function useCollectionView(
  viewId: UUID,
  store?: RecordStoreApi,
): CollectionView | undefined {
  return useRecordStore((state) => state.collectionViews[viewId], store);
}

/** Returns the ordered visible properties for a view. */
export function viewVisibleProperties(
  view: CollectionView,
  schema: CollectionSchema,
): string[] {
  if (view.format.table_properties?.length) {
    const known = new Set(Object.keys(schema));
    const visible = view.format.table_properties
      .filter((entry) => entry.visible && known.has(entry.property))
      .map((entry) => entry.property);
    if (visible.length > 0) {
      return visible;
    }
  }
  return Object.entries(schema)
    .filter(([, property]) => !property.hidden)
    .map(([propertyId]) => propertyId);
}

/** Returns the property ids shown as tags in list/gallery cards. */
export function viewCardProperties(
  view: CollectionView,
  schema: CollectionSchema,
  limit = 3,
): string[] {
  const configured = view.format.list_properties;
  if (configured?.length) {
    return configured.filter((propertyId) => propertyId in schema).slice(0, limit);
  }
  return Object.entries(schema)
    .filter(([, property]) => property.type !== 'title' && !property.hidden)
    .slice(0, limit)
    .map(([propertyId]) => propertyId);
}

/** Applies a view query (filter, sort, search, limit) to a record set. */
export function applyViewQuery<T extends DatabaseRecord>(
  records: T[],
  view: CollectionView,
  schema: CollectionSchema,
): T[] {
  let result: T[] = view.query2.filter
    ? records.filter((record) => evaluateFilter(view.query2.filter, record, schema))
    : [...records];

  result = sortRecords(result, view.query2.sort, schema);

  const search = view.query2.search?.trim().toLowerCase();
  if (search) {
    result = result.filter((record) => {
      if (resolveRecordTitle(record, schema).toLowerCase().includes(search)) {
        return true;
      }
      return Object.entries(schema).some(([propertyId, property]) =>
        formatPropertyValue(record.properties[propertyId], property)
          .toLowerCase()
          .includes(search),
      );
    });
  }

  if (typeof view.query2.limit === 'number' && view.query2.limit > 0) {
    result = result.slice(0, view.query2.limit);
  }
  return result;
}

/** Applies the sort clauses of a view. */
export function applyViewSort<T extends DatabaseRecord>(
  records: T[],
  view: CollectionView,
  schema: CollectionSchema,
): T[] {
  return sortRecords(records, view.query2.sort, schema);
}

/** React hook applying a view query (filter + sort + search + limit). */
export function useViewRecords<T extends DatabaseRecord>(
  records: T[],
  view: CollectionView,
  schema: CollectionSchema,
): T[] {
  return useMemo(() => applyViewQuery(records, view, schema), [records, view, schema]);
}
