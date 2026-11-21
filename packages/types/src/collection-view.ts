/**
 * Collection view contracts (the six projection modes of a Votion database).
 *
 * A view owns *how* rows are projected (filters, sorts, groupings, aggregations)
 * and *how* they look (column widths, card covers). The underlying row records
 * never change when a view changes.
 */

import type { AuditedRecord, Timestamp, UUID } from './common.js';
import type { PropertyOption } from './collection.js';

/** The six database projection modes. */
export type ViewType = 'table' | 'board' | 'calendar' | 'timeline' | 'gallery' | 'list';

/** Boolean composition of filter clauses. */
export type FilterOperator = 'and' | 'or';

/** Type-specific filter comparators. */
export type FilterComparator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'does_not_contain'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'before'
  | 'after'
  | 'on_or_before'
  | 'on_or_after'
  | 'is_checked'
  | 'is_not_checked'
  | 'is_within'
  | 'is_relative_to_today';

/** Sort direction. */
export type SortDirection = 'ascending' | 'descending';

/** A single leaf filter clause. */
export interface FilterClause {
  property: string;
  comparator: FilterComparator;
  value: unknown;
}

/** A nested compound filter group (unbounded `AND`/`OR` depth). */
export interface FilterGroup {
  operator: FilterOperator;
  clauses: FilterNode[];
}

/** Node of the recursive filter tree. */
export type FilterNode = FilterClause | FilterGroup;

/** Multi-level sort instruction. */
export interface SortClause {
  property: string;
  direction: SortDirection;
}

/** Group-by instruction (board columns, table sections, swimlanes). */
export interface GroupClause {
  property: string;
  direction: SortDirection;
  /** Contiguous groups can hide the empty bucket. */
  hide_empty_groups?: boolean;
}

/** Footer aggregation attached to a numeric property. */
export interface AggregationClause {
  property: string;
  aggregation:
    | 'count'
    | 'count_values'
    | 'count_unique'
    | 'count_empty'
    | 'sum'
    | 'average'
    | 'median'
    | 'min'
    | 'max'
    | 'range';
}

/** Query payload of a view (`collection_views.query2` JSONB column). */
export interface CollectionViewQuery {
  filter?: FilterGroup;
  sort?: SortClause[];
  group_by?: GroupClause;
  aggregations?: AggregationClause[];
  /** Free-text search restricted to the view's visible properties. */
  search?: string;
  /** Maximum number of rows rendered (virtualised paging hint). */
  limit?: number;
}

/** Table column presentation state. */
export interface TablePropertyFormat {
  property: string;
  visible: boolean;
  width: number;
  /** Pinned column offset for sticky headers (px). */
  frozen?: boolean;
}

/** Card cover source for gallery / board / list views. */
export type CardCoverSource = 'cover' | 'content' | 'none';

/** Card preview size for gallery / board views. */
export type CardSize = 'small' | 'medium' | 'large';

/** Timeline zoom scale. */
export type TimelineScale = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

/** Presentation payload of a view (`collection_views.format` JSONB column). */
export interface CollectionViewFormat {
  /** Column state for `table` views. */
  table_properties?: TablePropertyFormat[];
  /** Property whose options become board columns. */
  board_columns_by?: string;
  /** Property used to group board swimlanes. */
  board_groups_by?: string;
  board_show_empty_columns?: boolean;
  /** Card cover source for gallery / board / list views. */
  gallery_cover?: CardCoverSource;
  gallery_cover_size?: CardSize;
  gallery_card_size?: CardSize;
  /** Date property driving a calendar projection. */
  calendar_by?: string;
  /** Date property driving the timeline start edge. */
  timeline_by?: string;
  /** Date property driving the timeline end edge. */
  timeline_by_end?: string;
  timeline_scale?: TimelineScale;
  timeline_show_table?: boolean;
  /** Properties visible in `list` views. */
  list_properties?: string[];
  /** Wrapping behaviour for long cell values. */
  wrap_cells?: boolean;
  [key: string]: unknown;
}

/** Canonical persisted collection view record. */
export interface CollectionView extends Partial<AuditedRecord> {
  id: UUID;
  space_id: UUID;
  collection_id: UUID;
  type: ViewType;
  name: string;
  format: CollectionViewFormat;
  query2: CollectionViewQuery;
  alive: boolean;
  version: number;
}

/** Payload accepted when creating a new collection view. */
export type NewCollectionView = Pick<
  CollectionView,
  'space_id' | 'collection_id' | 'type' | 'name'
> &
  Partial<Omit<CollectionView, 'space_id' | 'collection_id' | 'type' | 'name'>>;

/** Board column projection produced by the grouping engine from view options. */
export interface BoardColumn {
  /** Option id, or `no_value` for the empty bucket. */
  optionId: string;
  option?: PropertyOption;
  /** Row (page block) ids assigned to this column. */
  recordIds: UUID[];
  collapsed?: boolean;
  hidden?: boolean;
}

/** Narrow helper result used by calendar/timeline projections. */
export interface ViewDateRange {
  start: Timestamp;
  end?: Timestamp;
}

/** Narrows an unknown value to a persisted {@link CollectionView} record. */
export function isCollectionView(value: unknown): value is CollectionView {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CollectionView, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.collection_id === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.query2 === 'object' &&
    candidate.query2 !== null
  );
}

/** Returns `true` for a compound filter group node. */
export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return (
    typeof node === 'object' &&
    node !== null &&
    'operator' in node &&
    Array.isArray((node as FilterGroup).clauses)
  );
}
