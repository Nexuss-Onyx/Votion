/**
 * Grouping engine: partitions database rows into buckets.
 *
 * Used by board columns, table sections and calendar/timeline projections.
 * Buckets keep their declared option order for select/status properties so the
 * UI matches the schema's mental model.
 */

import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import type {
  CollectionProperty,
  CollectionSchema,
  GroupClause,
  OptionColor,
  UUID,
} from '@votion/types';
import { toTimestamp } from '../schema/PropertyRegistry.js';
import { readRecordProperty, resolvePropertyEntry } from '../types.js';
import type { FilterableRecord } from '../types.js';

/** Date bucketing intervals supported by the grouping engine. */
export type GroupInterval = 'day' | 'week' | 'month' | 'year';

/** Group clause extended with the date interval used by calendar/board views. */
export interface GroupClauseOptions extends GroupClause {
  interval?: GroupInterval;
}

/** One bucket produced by the grouping engine. */
export interface RecordGroup<T = UUID> {
  key: string;
  label: string;
  color?: OptionColor;
  optionId?: string;
  recordIds: T[];
  /** Inclusive start timestamp for date buckets. */
  startTimestamp?: number;
  /** Exclusive end timestamp for date buckets. */
  endTimestamp?: number;
}

/** Resolves the property a group clause points at. */
export function resolveGroupProperty(
  schema: CollectionSchema,
  clause: GroupClause,
): [string, CollectionProperty] | undefined {
  return resolvePropertyEntry(schema, clause.property);
}

function labelForDate(timestamp: number, interval: GroupInterval): string {
  const date = new Date(timestamp);
  switch (interval) {
    case 'day':
      return format(date, 'MMM d, yyyy');
    case 'week':
      return `Week of ${format(date, 'MMM d, yyyy')}`;
    case 'month':
      return format(date, 'MMMM yyyy');
    case 'year':
      return format(date, 'yyyy');
    default:
      return format(date, 'MMM d, yyyy');
  }
}

/** Returns the canonical bucket start for a date and interval. */
export function dateBucketStart(date: Date, interval: GroupInterval): Date {
  switch (interval) {
    case 'day':
      return startOfDay(date);
    case 'week':
      return startOfWeek(date, { weekStartsOn: 1 });
    case 'month':
      return startOfMonth(date);
    case 'year':
      return startOfYear(date);
    default:
      return startOfDay(date);
  }
}

/** Returns the exclusive end of a bucket. */
export function dateBucketEnd(date: Date, interval: GroupInterval): Date {
  switch (interval) {
    case 'day':
      return addDays(date, 1);
    case 'week':
      return addWeeks(date, 1);
    case 'month':
      return addMonths(date, 1);
    case 'year':
      return addYears(date, 1);
    default:
      return addDays(date, 1);
  }
}

/** Groups records into buckets. */
export function groupRecords<T extends FilterableRecord>(
  records: T[],
  clause: GroupClauseOptions | undefined,
  schema: CollectionSchema,
): RecordGroup<T['id']>[] {
  if (!clause) {
    return [{ key: 'all', label: 'All', recordIds: records.map((record) => record.id) }];
  }
  const entry = resolveGroupProperty(schema, clause);
  const property = entry?.[1];
  const type = property?.type;
  const hideEmpty = clause.hide_empty_groups === true;

  if (type === 'select' || type === 'status') {
    const options = property?.options ?? [];
    const groups: RecordGroup<T['id']>[] = options.map((option) => ({
      key: option.id,
      label: option.value,
      color: option.color,
      optionId: option.id,
      recordIds: [],
    }));
    const valueKeyed = new Map<string, T['id'][]>();
    const empty: T['id'][] = [];
    for (const record of records) {
      const raw = readRecordProperty(record, schema, clause.property);
      const value = typeof raw === 'string' ? raw : null;
      if (!value) {
        empty.push(record.id);
        continue;
      }
      const matched = options.find(
        (option) => option.id === value || option.value.toLowerCase() === value.toLowerCase(),
      );
      if (matched) {
        const bucket = groups.find((group) => group.optionId === matched.id);
        bucket?.recordIds.push(record.id);
      } else {
        const bucket = valueKeyed.get(value) ?? [];
        bucket.push(record.id);
        valueKeyed.set(value, bucket);
      }
    }
    for (const [value, recordIds] of valueKeyed) {
      groups.push({ key: value, label: value, recordIds });
    }
    groups.push({ key: 'no_value', label: 'No value', recordIds: empty });
    return hideEmpty ? groups.filter((group) => group.recordIds.length > 0) : groups;
  }

  if (type === 'checkbox') {
    const trueIds = records.filter((record) => readRecordProperty(record, schema, clause.property) === true)
      .map((record) => record.id);
    const falseIds = records
      .filter((record) => readRecordProperty(record, schema, clause.property) !== true)
      .map((record) => record.id);
    const groups: RecordGroup<T['id']>[] = [
      { key: 'checked', label: 'Checked', recordIds: trueIds },
      { key: 'unchecked', label: 'Unchecked', recordIds: falseIds },
    ];
    return hideEmpty ? groups.filter((group) => group.recordIds.length > 0) : groups;
  }

  if (type === 'date' || type === 'created_time' || type === 'last_edited_time') {
    const interval = clause.interval ?? 'day';
    const buckets = new Map<
      number,
      { label: string; recordIds: T['id'][]; end: number }
    >();
    const empty: T['id'][] = [];
    for (const record of records) {
      const timestamp = toTimestamp(readRecordProperty(record, schema, clause.property));
      if (timestamp == null) {
        empty.push(record.id);
        continue;
      }
      const start = dateBucketStart(new Date(timestamp), interval);
      const startMs = start.getTime();
      const end = dateBucketEnd(start, interval).getTime();
      const bucket = buckets.get(startMs);
      if (bucket) {
        bucket.recordIds.push(record.id);
      } else {
        buckets.set(startMs, {
          label: labelForDate(startMs, interval),
          recordIds: [record.id],
          end,
        });
      }
    }
    const groups: RecordGroup<T['id']>[] = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([startMs, bucket]) => ({
        key: String(startMs),
        label: bucket.label,
        recordIds: bucket.recordIds,
        startTimestamp: startMs,
        endTimestamp: bucket.end,
      }));
    if (!hideEmpty || empty.length > 0) {
      groups.push({ key: 'no_value', label: 'No date', recordIds: empty });
    }
    return groups;
  }

  // Generic grouping: one bucket per distinct primitive value.
  const buckets = new Map<string, { label: string; recordIds: T['id'][] }>();
  const empty: T['id'][] = [];
  for (const record of records) {
    const raw = readRecordProperty(record, schema, clause.property);
    if (raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
      empty.push(record.id);
      continue;
    }
    const key = Array.isArray(raw) ? raw.join(',') : String(raw);
    const bucket = buckets.get(key) ?? { label: key, recordIds: [] };
    bucket.recordIds.push(record.id);
    buckets.set(key, bucket);
  }
  const groups = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    recordIds: bucket.recordIds,
  }));
  if (!hideEmpty || empty.length > 0) {
    groups.push({ key: 'no_value', label: 'No value', recordIds: empty });
  }
  return groups;
}

/** Returns the group bucket key for a raw date value. */
export function dateGroupKey(
  value: unknown,
  interval: GroupInterval,
): string | null {
  const timestamp = toTimestamp(value);
  if (timestamp == null) {
    return null;
  }
  return String(dateBucketStart(new Date(timestamp), interval).getTime());
}

/** Resolves a drop target key back to a concrete date string. */
export function groupKeyToDate(
  key: string,
  interval: GroupInterval,
): string | null {
  const timestamp = Number(key);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return dateBucketStart(new Date(timestamp), interval).toISOString();
}

/** Counts records per group for headers and footers. */
export function groupCounts<T>(groups: RecordGroup<T>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[group.key] = group.recordIds.length;
  }
  return counts;
}
