/**
 * Relation resolver.
 *
 * Resolves the record ids stored in a relation property into full records and
 * keeps two-way (mirrored) relation links in sync.
 */

import type {
  Block,
  Collection,
  CollectionProperty,
  CollectionSchema,
  Operation,
  UUID,
} from '@votion/types';
import { TransactionBuilder } from '@votion/sync-client';
import type { DatabaseRecord } from '../types.js';

/** A mirrored-relation patch produced by the two-way synchroniser. */
export interface RelationSyncPatch {
  recordId: UUID;
  propertyId: string;
  value: UUID[];
}

/** Constructor dependencies of {@link RelationResolver}. */
export interface RelationResolverOptions {
  getRecord: (id: UUID) => DatabaseRecord | undefined;
  getSchema?: (collectionId: UUID) => CollectionSchema | undefined;
  getCollection?: (id: UUID) => Collection | undefined;
}

/** Normalises any stored relation payload into a list of record ids. */
export function relationIds(value: unknown): UUID[] {
  if (value == null) {
    return [];
  }
  if (typeof value === 'string') {
    return value ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is UUID => typeof entry === 'string' && entry.length > 0);
  }
  return [];
}

/** Resolves relation values and keeps mirrored properties in sync. */
export class RelationResolver {
  constructor(private readonly options: RelationResolverOptions) {}

  /** Returns the ids stored in a relation value. */
  resolveIds(value: unknown): UUID[] {
    return relationIds(value);
  }

  /** Resolves the records targeted by a relation property. */
  resolveTargets(
    record: DatabaseRecord,
    propertyId: string,
    _property: CollectionProperty,
  ): DatabaseRecord[] {
    const ids = relationIds(record.properties[propertyId]);
    const targets: DatabaseRecord[] = [];
    for (const id of ids) {
      const target = this.options.getRecord(id);
      if (target && target.alive) {
        targets.push(target);
      }
    }
    return targets;
  }

  /** Returns the collection id a relation property points at. */
  targetCollectionId(property: CollectionProperty): UUID | undefined {
    return property.collection_id ?? property.relation?.collection_id;
  }

  /** Returns the target collection schema, when available. */
  targetSchema(property: CollectionProperty): CollectionSchema | undefined {
    const collectionId = this.targetCollectionId(property);
    return collectionId ? this.options.getSchema?.(collectionId) : undefined;
  }

  /** Returns the mirrored property id, if the relation is two-way. */
  mirroredPropertyId(property: CollectionProperty): string | undefined {
    return property.relation?.property_id ?? property.relation?.synced_property_id;
  }

  /**
   * Computes the minimal set of mirrored-property patches needed to make the
   * two-way relation consistent with `nextTargetIds`.
   *
   * Removed links are cleaned up on the old targets; added links are written
   * to the new targets. When no mirror is configured the result is empty.
   */
  syncTwoWay(
    record: DatabaseRecord,
    propertyId: string,
    property: CollectionProperty,
    nextTargetIds: UUID[],
  ): RelationSyncPatch[] {
    const mirrorId = this.mirroredPropertyId(property);
    if (!mirrorId) {
      return [];
    }
    const currentIds = relationIds(record.properties[propertyId]);
    const next = new Set(nextTargetIds);
    const patches: RelationSyncPatch[] = [];

    for (const removedId of currentIds) {
      if (next.has(removedId)) {
        continue;
      }
      const target = this.options.getRecord(removedId);
      if (!target) {
        continue;
      }
      const mirrorValue = relationIds(target.properties[mirrorId]).filter(
        (id) => id !== record.id,
      );
      patches.push({ recordId: removedId, propertyId: mirrorId, value: mirrorValue });
    }

    for (const addedId of nextTargetIds) {
      if (currentIds.includes(addedId)) {
        continue;
      }
      const target = this.options.getRecord(addedId);
      if (!target) {
        continue;
      }
      const mirrorValue = relationIds(target.properties[mirrorId]);
      if (!mirrorValue.includes(record.id)) {
        mirrorValue.push(record.id);
      }
      patches.push({ recordId: addedId, propertyId: mirrorId, value: mirrorValue });
    }

    return patches;
  }

  /** Builds a transaction writing a relation property on a row. */
  buildSetRelationTransaction(
    record: DatabaseRecord,
    propertyId: string,
    targetIds: UUID[],
  ): ReturnType<TransactionBuilder['build']> {
    return new TransactionBuilder({
      spaceId: record.spaceId,
      table: 'block',
      id: record.id,
    })
      .set(['properties', propertyId], targetIds)
      .build();
  }

  /** Builds the two-way mirror operations as block `set` operations. */
  buildMirrorOperations(
    record: DatabaseRecord,
    propertyId: string,
    property: CollectionProperty,
    nextTargetIds: UUID[],
  ): Operation[] {
    const builder = new TransactionBuilder({
      spaceId: record.spaceId,
      table: 'block',
      id: record.id,
    });
    for (const patch of this.syncTwoWay(record, propertyId, property, nextTargetIds)) {
      builder.set(['properties', patch.propertyId], patch.value, {
        table: 'block',
        id: patch.recordId,
      });
    }
    return builder.toOperations();
  }
}

/** Convenience helper: resolves relation ids from a raw value. */
export function resolveRelationIds(value: unknown): UUID[] {
  return relationIds(value);
}

/** Returns the record ids referenced by a relation property. */
export function relationRecordIds(
  record: DatabaseRecord,
  propertyId: string,
): UUID[] {
  return relationIds(record.properties[propertyId]);
}

/** Narrows a block into a relation record check used by workers. */
export function isRelationBlock(block: Block): boolean {
  return block.parent_table === 'collection';
}
