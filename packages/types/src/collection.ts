/**
 * Collection (database) schema contracts.
 *
 * A Votion database is *not* a runtime SQL table. It is a `collection` holding a
 * JSONB schema map of property ids -> property definitions. The rows are plain
 * `page` blocks whose `parent_table` is `collection` and whose `properties`
 * object is keyed by the same property ids.
 */

import type { AuditedRecord, IconString, UUID } from './common.js';
import type { RichText } from './rich-text.js';

/** Every property type a collection schema may declare. */
export type PropertyType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'file'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by'
  | 'unique_id';

/** Read-only properties derived from record audit metadata. */
export type AuditPropertyType = Extract<
  PropertyType,
  'created_time' | 'created_by' | 'last_edited_time' | 'last_edited_by' | 'unique_id'
>;

/** Property types backed by a fixed set of colored options. */
export type OptionPropertyType = Extract<
  PropertyType,
  'select' | 'multi_select' | 'status'
>;

/** Canonical option colors. */
export type OptionColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

/** Numerical rendering formats for `number` properties. */
export type NumberFormat =
  | 'number'
  | 'number_with_commas'
  | 'percent'
  | 'dollar'
  | 'euro'
  | 'pound'
  | 'yen'
  | 'rupee'
  | 'bitcoin'
  | 'progress';

/** Date rendering formats for `date` properties. */
export type DateFormat =
  | 'full'
  | 'short'
  | 'month_day_year'
  | 'day_month_year'
  | 'year_month_day'
  | 'relative';

/** A select / multi-select / status option. */
export interface PropertyOption {
  id: string;
  value: string;
  color: OptionColor;
  /** Optional grouping bucket for `status` properties. */
  group_id?: string;
}

/** A status property group (To-do / In progress / Complete). */
export interface StatusGroup {
  id: string;
  name: string;
  color: OptionColor;
  option_ids: string[];
}

/** Two-way relation pointer metadata. */
export interface RelationConfig {
  /** Target collection id. */
  collection_id: UUID;
  /** Property id on the target collection that mirrors this relation. */
  property_id?: string;
  /** Property id on this collection owning the forward pointer. */
  synced_property_id?: string;
  /** Name of the mirrored property shown in the UI. */
  synced_property_name?: string;
}

/** Aggregation functions supported by rollups. */
export type RollupAggregation =
  | 'count'
  | 'count_all'
  | 'count_empty'
  | 'count_not_empty'
  | 'count_unique'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'show_original'
  | 'show_unique'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'earliest_date'
  | 'latest_date'
  | 'date_range';

/** Rollup definition: traverse a relation, then aggregate a target property. */
export interface RollupConfig {
  /** Relation property used to traverse to the target records. */
  relation_property_id: string;
  /** Property id on the related collection being aggregated. */
  target_property_id: string;
  /** Aggregation function. */
  aggregation: RollupAggregation;
}

/** Single property definition inside a collection schema map. */
export interface CollectionProperty {
  /** Human readable property name (`Task Name`). */
  name: string;
  type: PropertyType;
  /** Option map for select / multi_select / status properties. */
  options?: PropertyOption[];
  /** Status groups for `status` properties. */
  groups?: StatusGroup[];
  /** Target collection for `relation` properties. */
  collection_id?: UUID;
  /** Structured relation metadata (two-way relations). */
  relation?: RelationConfig;
  /** Relation property targeted by a rollup. */
  relation_property_id?: string;
  /** Target property aggregated by a rollup. */
  target_property_id?: string;
  /** Aggregation function of a rollup. */
  rollup?: RollupConfig;
  /** Formula 2.0 expression for `formula` properties. */
  formula?: string;
  /** Rendering format for `number` properties. */
  number_format?: NumberFormat;
  /** Rendering format for `date` properties. */
  date_format?: DateFormat;
  /** Whether the property is hidden in the table view. */
  hidden?: boolean;
  /** Optional helper text shown below the property name. */
  description?: RichText;
}

/** Map of property id -> property definition (the `collections.schema` JSONB). */
export type CollectionSchema = Record<string, CollectionProperty>;

/** Canonical persisted collection record. */
export interface Collection extends Partial<AuditedRecord> {
  id: UUID;
  space_id: UUID;
  /** Parent block id (the `collection_view` block that owns this schema). */
  parent_id: UUID;
  name: RichText;
  description?: RichText;
  schema: CollectionSchema;
  icon?: IconString;
  cover?: string;
  alive: boolean;
  version: number;
}

/** Payload accepted when creating a new collection. */
export type NewCollection = Pick<Collection, 'space_id' | 'parent_id' | 'name'> &
  Partial<Omit<Collection, 'space_id' | 'parent_id' | 'name'>>;

/** Returns the schema entry with the `title` type, if any. */
export function findTitleProperty(
  schema: CollectionSchema,
): [propertyId: string, property: CollectionProperty] | undefined {
  for (const [propertyId, property] of Object.entries(schema)) {
    if (property.type === 'title') {
      return [propertyId, property];
    }
  }
  return undefined;
}

/** Returns every schema entry of the requested type. */
export function getPropertiesOfType(
  schema: CollectionSchema,
  type: PropertyType,
): [propertyId: string, property: CollectionProperty][] {
  return Object.entries(schema).filter(([, property]) => property.type === type);
}

/** Resolves a select/status option by its display value. */
export function findOptionByValue(
  property: CollectionProperty,
  value: string,
): PropertyOption | undefined {
  return property.options?.find((option) => option.value === value);
}

/** Narrows an unknown value to a persisted {@link Collection} record. */
export function isCollection(value: unknown): value is Collection {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Collection, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.space_id === 'string' &&
    typeof candidate.version === 'number' &&
    typeof candidate.schema === 'object' &&
    candidate.schema !== null &&
    Array.isArray(candidate.name)
  );
}
