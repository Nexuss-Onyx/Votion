/**
 * Database engine record contracts.
 *
 * A database row is a standard `page` block parented to a `collection`. The
 * engine never invents a second storage format: it derives a read-friendly
 * {@link DatabaseRecord} projection from the canonical {@link Block} and the
 * collection's JSONB schema.
 */

import type {
  Block,
  Collection,
  CollectionProperty,
  CollectionSchema,
  ISODateString,
  PropertyType,
  RichText,
  Timestamp,
  UUID,
} from '@votion/types';

/** A file attachment stored in a `file` property. */
export interface FilePropertyValue {
  url: string;
  name?: string;
  size?: number;
  /** MIME type, used by the gallery view to detect image previews. */
  mime_type?: string;
}

/** A date value. Votion accepts a bare ISO string or the full range object. */
export interface DatePropertyValue {
  start: ISODateString;
  end?: ISODateString;
  time_zone?: string;
}

/**
 * Canonical value shapes stored in a row's `properties` map, keyed by property
 * id. The shapes intentionally mirror the collection property type so the
 * registry can format/validate them without guessing.
 */
export type PropertyValue =
  | RichText
  | string
  | number
  | boolean
  | string[]
  | FilePropertyValue[]
  | DatePropertyValue
  | null
  | undefined;

/** Read-friendly projection of a `page` block that belongs to a collection. */
export interface DatabaseRecord {
  id: UUID;
  /** Canonical backing block (`type: 'page'`, `parent_table: 'collection'`). */
  block: Block;
  collectionId: UUID;
  spaceId: UUID;
  /** Plain-text title resolved through the schema's `title` property. */
  title: string;
  /** Raw property map keyed by property id. */
  properties: Record<string, unknown>;
  createdAt: Timestamp;
  lastEditedAt: Timestamp;
  createdBy: UUID;
  lastEditedBy: UUID;
  /** Wire-name aliases so query engines can read audit fields directly. */
  created_time: Timestamp;
  last_edited_time: Timestamp;
  created_by_id: UUID;
  last_edited_by_id: UUID;
  icon?: string;
  cover?: string;
  alive: boolean;
}

/** Minimal shape required by the filter/sort/group engines. */
export interface FilterableRecord {
  id: UUID;
  properties: Record<string, unknown>;
  created_time: Timestamp;
  last_edited_time: Timestamp;
  created_by_id: UUID;
  last_edited_by_id: UUID;
}

/** Converts a canonical page block into a database row projection. */
export function blockToDatabaseRecord(
  collection: Collection,
  block: Block,
): DatabaseRecord {
  const base: DatabaseRecord = {
    id: block.id,
    block,
    collectionId: collection.id,
    spaceId: block.space_id,
    title: '',
    properties: { ...(block.properties as Record<string, unknown>) },
    createdAt: block.created_time,
    lastEditedAt: block.last_edited_time,
    createdBy: block.created_by_id,
    lastEditedBy: block.last_edited_by_id,
    created_time: block.created_time,
    last_edited_time: block.last_edited_time,
    created_by_id: block.created_by_id,
    last_edited_by_id: block.last_edited_by_id,
    icon: collection.icon,
    cover: block.format.page_cover,
    alive: block.alive,
  };
  return { ...base, title: resolveRecordTitle(base, collection.schema) };
}

/** Flattens a rich-text value into plain text. */
export function richTextToString(value: RichText | undefined): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value.map((segment) => (Array.isArray(segment) ? segment[0] ?? '' : '')).join(
    '',
  );
}

/** Returns the schema's title property entry, if any. */
export function findTitleProperty(
  schema: CollectionSchema,
): [string, CollectionProperty] | undefined {
  for (const [propertyId, property] of Object.entries(schema)) {
    if (property.type === 'title') {
      return [propertyId, property];
    }
  }
  return undefined;
}

/** Resolves the human-readable title of a record through its schema. */
export function resolveRecordTitle(
  record: Pick<DatabaseRecord, 'properties'>,
  schema: CollectionSchema,
): string {
  const titleEntry = findTitleProperty(schema);
  if (!titleEntry) {
    return '';
  }
  const [propertyId] = titleEntry;
  const value = record.properties[propertyId];
  if (Array.isArray(value)) {
    return richTextToString(value as RichText);
  }
  return value == null ? '' : String(value);
}

/** Resolves a property reference (id or display name) to a schema entry. */
export function resolvePropertyEntry(
  schema: CollectionSchema,
  propertyRef: string,
): [string, CollectionProperty] | undefined {
  const direct = schema[propertyRef];
  if (direct) {
    return [propertyRef, direct];
  }
  const needle = propertyRef.toLowerCase();
  for (const [propertyId, property] of Object.entries(schema)) {
    if (property.name.toLowerCase() === needle) {
      return [propertyId, property];
    }
  }
  return undefined;
}

/**
 * Reads a property value from a record.
 *
 * `propertyRef` may be a property id, a property display name, or one of the
 * audit pseudo-properties (`created_time`, `created_by`, `last_edited_time`,
 * `last_edited_by`, `id`, `title`).
 */
export function readRecordProperty(
  record: FilterableRecord | DatabaseRecord,
  schema: CollectionSchema,
  propertyRef: string,
): unknown {
  const entry = resolvePropertyEntry(schema, propertyRef);
  if (entry) {
    const [propertyId] = entry;
    if (Object.prototype.hasOwnProperty.call(record.properties, propertyId)) {
      return record.properties[propertyId];
    }
    return undefined;
  }
  switch (propertyRef.toLowerCase()) {
    case 'id':
      return record.id;
    case 'title':
      return resolveRecordTitle(record, schema);
    case 'created_time':
      return record.created_time;
    case 'last_edited_time':
      return record.last_edited_time;
    case 'created_by':
      return record.created_by_id;
    case 'last_edited_by':
      return record.last_edited_by_id;
    default:
      return undefined;
  }
}

/** Returns a cloned record with one property replaced. */
export function withRecordProperty(
  record: DatabaseRecord,
  propertyId: string,
  value: unknown,
): DatabaseRecord {
  const nextProperties = { ...record.properties, [propertyId]: value };
  return {
    ...record,
    properties: nextProperties,
    block: {
      ...record.block,
      properties: nextProperties as Block['properties'],
      last_edited_time: Date.now(),
    },
  };
}

/** Returns a property id for a new collection, stable and collision-resistant. */
export function createPropertyId(prefix = 'prop'): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${random.replace(/-/g, '').slice(0, 12)}`;
}

/** Property types whose values are read-only computed surfaces. */
export const COMPUTED_PROPERTY_TYPES: ReadonlySet<PropertyType> = new Set([
  'formula',
  'rollup',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'unique_id',
]);
