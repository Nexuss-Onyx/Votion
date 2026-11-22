/**
 * Sub-items: parent/child hierarchy inside a collection.
 *
 * A sub-item relationship is stored as a relation-like property on each row
 * pointing at its parent row. The engine builds a cycle-safe tree from that
 * flat link list.
 */

import type { UUID } from '@votion/types';
import type { FilterableRecord } from '../types.js';

/** A node in the sub-item tree. */
export interface SubItemNode<T> {
  record: T;
  children: SubItemNode<T>[];
  depth: number;
  parentId: UUID | null;
}

function readParentId(value: unknown): UUID | null {
  if (typeof value === 'string' && value) {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    return first ?? null;
  }
  return null;
}

/** Builds a sub-item tree from a flat record list. */
export function buildSubItemTree<T extends FilterableRecord>(
  records: T[],
  parentPropertyId: string | undefined,
): SubItemNode<T>[] {
  const byId = new Map<UUID, T>();
  for (const record of records) {
    byId.set(record.id, record);
  }

  const childrenOf = new Map<UUID | null, T[]>();
  const parentOf = new Map<UUID, UUID | null>();
  for (const record of records) {
    const parentId = parentPropertyId
      ? readParentId(record.properties[parentPropertyId])
      : null;
    const resolvedParent =
      parentId && byId.has(parentId) && parentId !== record.id ? parentId : null;
    parentOf.set(record.id, resolvedParent);
    const bucket = childrenOf.get(resolvedParent) ?? [];
    bucket.push(record);
    childrenOf.set(resolvedParent, bucket);
  }

  const build = (record: T, depth: number, ancestors: Set<UUID>): SubItemNode<T> => {
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(record.id);
    const children = (childrenOf.get(record.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => build(child, depth + 1, nextAncestors));
    return {
      record,
      children,
      depth,
      parentId: parentOf.get(record.id) ?? null,
    };
  };

  return (childrenOf.get(null) ?? []).map((record) => build(record, 0, new Set<UUID>()));
}

/** Returns the direct child ids of a record. */
export function getSubItemIds<T extends FilterableRecord>(
  records: T[],
  parentPropertyId: string | undefined,
  recordId: UUID,
): UUID[] {
  return records
    .filter((record) => {
      if (!parentPropertyId) {
        return false;
      }
      return readParentId(record.properties[parentPropertyId]) === recordId;
    })
    .map((record) => record.id);
}

/** Depth-first flattening of a sub-item tree. */
export function flattenSubItems<T>(nodes: SubItemNode<T>[]): T[] {
  const result: T[] = [];
  const walk = (node: SubItemNode<T>): void => {
    result.push(node.record);
    for (const child of node.children) {
      walk(child);
    }
  };
  for (const node of nodes) {
    walk(node);
  }
  return result;
}
