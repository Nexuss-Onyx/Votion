/**
 * Timeline view (Gantt): duration bars from a start date to an end date with
 * zoom levels and relation dependency lines.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInDays,
  differenceInMinutes,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { CollectionSchema, TimelineScale, UUID } from '@votion/types';
import { toDate } from '../../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../../types.js';
import type { DatabaseViewProps } from '../types.js';
import { useViewRecords } from '../records.js';

const LABEL_WIDTH = 220;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 32;

const SCALE_PX_PER_DAY: Record<TimelineScale, number> = {
  hour: 960,
  day: 48,
  week: 16,
  month: 6,
  quarter: 3,
  year: 2,
};

const SCALES: TimelineScale[] = ['hour', 'day', 'week', 'month'];

/** Finds the default start/end date properties. */
export function defaultTimelineProperties(schema: CollectionSchema): {
  start?: string;
  end?: string;
} {
  const dates = Object.entries(schema).filter(([, property]) => property.type === 'date');
  return { start: dates[0]?.[0], end: dates[1]?.[0] };
}

interface BarGeometry {
  record: DatabaseRecord;
  left: number;
  width: number;
  top: number;
}

/** Timeline projection. */
export function TimelineView({
  collection,
  view,
  records,
  onRecordClick,
  className,
}: DatabaseViewProps): JSX.Element {
  const schema = collection.schema;
  const rows = useViewRecords(records, view, schema);
  const defaults = defaultTimelineProperties(schema);
  const startPropertyId = view.format.timeline_by ?? defaults.start;
  const endPropertyId = view.format.timeline_by_end ?? defaults.end;
  const [scale, setScale] = useState<TimelineScale>(view.format.timeline_scale ?? 'day');
  const [hovered, setHovered] = useState<UUID | null>(null);

  const pxPerDay = SCALE_PX_PER_DAY[scale] ?? 48;

  const range = useMemo(() => {
    let min: number | null = null;
    let max: number | null = null;
    for (const record of rows) {
      const start = startPropertyId ? toDate(record.properties[startPropertyId]) : null;
      const end = endPropertyId ? toDate(record.properties[endPropertyId]) : null;
      if (start) {
        min = min == null ? start.getTime() : Math.min(min, start.getTime());
        max = max == null ? start.getTime() : Math.max(max, start.getTime());
      }
      if (end) {
        max = max == null ? end.getTime() : Math.max(max, end.getTime());
      }
    }
    const today = startOfDay(new Date()).getTime();
    const rangeStart = min == null ? today : startOfDay(new Date(min)).getTime();
    const rangeEnd = max == null ? rangeStart + 7 * 86_400_000 : startOfDay(new Date(max)).getTime();
    return {
      start: rangeStart,
      end: rangeEnd >= rangeStart ? rangeEnd : rangeStart + 7 * 86_400_000,
    };
  }, [rows, startPropertyId, endPropertyId]);

  const totalDays = Math.max(1, differenceInDays(new Date(range.end), new Date(range.start)) + 1);
  const timelineWidth = totalDays * pxPerDay;

  const bars = useMemo<BarGeometry[]>(() => {
    return rows.map((record, index) => {
      const start = startPropertyId ? toDate(record.properties[startPropertyId]) : null;
      const end = endPropertyId ? toDate(record.properties[endPropertyId]) : null;
      const startMs = start ? start.getTime() : range.start;
      const endMs = end ? end.getTime() : startMs + 86_400_000;
      const days = Math.max(
        1,
        differenceInMinutes(new Date(endMs), new Date(startMs)) / (24 * 60),
      );
      const offsetDays = Math.max(
        0,
        differenceInDays(new Date(startOfDay(new Date(startMs))), new Date(range.start)),
      );
      return {
        record,
        left: offsetDays * pxPerDay,
        width: Math.max(pxPerDay, Math.round(days * pxPerDay)),
        top: index * ROW_HEIGHT + ROW_HEIGHT / 2,
      };
    });
  }, [rows, startPropertyId, endPropertyId, pxPerDay, range.start]);

  const ticks = useMemo(() => {
    const result: { label: string; left: number }[] = [];
    const cursor = new Date(range.start);
    if (scale === 'month') {
      let current = startOfMonth(cursor);
      while (current.getTime() <= range.end) {
        const left =
          differenceInDays(current, new Date(range.start)) * pxPerDay;
        result.push({ label: format(current, 'MMM yyyy'), left });
        current = addMonths(current, 1);
      }
    } else if (scale === 'week') {
      let current = startOfWeek(cursor, { weekStartsOn: 1 });
      while (current.getTime() <= range.end) {
        const left =
          differenceInDays(current, new Date(range.start)) * pxPerDay;
        result.push({ label: format(current, 'MMM d'), left });
        current = addWeeks(current, 1);
      }
    } else {
      let current = new Date(range.start);
      while (current.getTime() <= range.end) {
        const left =
          differenceInDays(current, new Date(range.start)) * pxPerDay;
        result.push({
          label: format(current, scale === 'hour' ? 'MMM d' : 'd'),
          left,
        });
        current = addDays(current, 1);
      }
    }
    return result;
  }, [range.start, range.end, scale, pxPerDay]);

  const relationPropertyId = Object.entries(schema).find(
    ([, property]) => property.type === 'relation',
  )?.[0];
  const dependencies = useMemo(() => {
    if (!relationPropertyId || !view.format.timeline_show_dependencies) {
      return [];
    }
    const indexById = new Map(rows.map((record, index) => [record.id, index]));
    const lines: { from: BarGeometry; to: BarGeometry }[] = [];
    rows.forEach((record, index) => {
      const targets = (record.properties[relationPropertyId] as UUID[] | undefined) ?? [];
      for (const targetId of targets) {
        const targetIndex = indexById.get(targetId);
        if (targetIndex == null || targetIndex === index) {
          continue;
        }
        const from = bars[targetIndex];
        const to = bars[index];
        if (from && to) {
          lines.push({ from, to });
        }
      }
    });
    return lines;
  }, [relationPropertyId, view.format.timeline_show_dependencies, rows, bars]);

  return (
    <div
      className={`votion-timeline-view ${className ?? ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      aria-label={`${view.name} timeline`}
    >
      <div
        className="votion-timeline-toolbar"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}
      >
        <span style={{ fontWeight: 600 }}>Zoom</span>
        {SCALES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={scale === candidate}
            aria-label={`Zoom ${candidate}`}
            onClick={() => setScale(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>

      <div className="votion-timeline-header" style={{ display: 'flex' }}>
        <div style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH, fontSize: 12, color: '#6b6b6b' }}>
          {rows.length} {rows.length === 1 ? 'record' : 'records'}
        </div>
        <div style={{ position: 'relative', width: timelineWidth, height: HEADER_HEIGHT }}>
          {ticks.map((tick, index) => (
            <div
              key={`${tick.label}-${index}`}
              className="votion-timeline-tick"
              style={{
                position: 'absolute',
                left: tick.left,
                top: 0,
                height: '100%',
                borderLeft: '1px solid #e3e3e3',
                paddingLeft: 4,
                fontSize: 11,
                color: '#6b6b6b',
                whiteSpace: 'nowrap',
              }}
            >
              {tick.label}
            </div>
          ))}
        </div>
      </div>

      <div className="votion-timeline-body" style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ width: LABEL_WIDTH + timelineWidth, position: 'relative' }}>
          <div style={{ position: 'absolute', left: LABEL_WIDTH, top: 0, width: timelineWidth }}>
            {dependencies.map((line, index) => (
              <svg
                key={`${line.from.record.id}-${line.to.record.id}-${index}`}
                style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
                width={timelineWidth}
                height={rows.length * ROW_HEIGHT}
                aria-hidden="true"
              >
                <line
                  x1={line.from.left + line.from.width}
                  y1={line.from.top}
                  x2={line.to.left}
                  y2={line.to.top}
                  stroke="#9b9b9b"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                />
              </svg>
            ))}
          </div>

          {rows.map((record, index) => {
            const bar = bars[index];
            const startText = startPropertyId
              ? format(new Date(toDate(record.properties[startPropertyId]) ?? new Date()), 'MMM d')
              : '';
            const endText = endPropertyId
              ? format(new Date(toDate(record.properties[endPropertyId]) ?? new Date()), 'MMM d')
              : '';
            return (
              <div
                key={record.id}
                className="votion-timeline-row"
                role="row"
                style={{ display: 'flex', height: ROW_HEIGHT }}
                onMouseEnter={() => setHovered(record.id)}
                onMouseLeave={() => setHovered(null)}
              >
                <div
                  className="votion-timeline-label"
                  role="cell"
                  style={{
                    width: LABEL_WIDTH,
                    minWidth: LABEL_WIDTH,
                    display: 'flex',
                    alignItems: 'center',
                    paddingRight: 8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                  }}
                  onClick={() => onRecordClick?.(record.id)}
                >
                  {record.title || 'Untitled'}
                </div>
                <div
                  className="votion-timeline-track"
                  style={{ position: 'relative', width: timelineWidth, height: '100%' }}
                >
                  <div
                    className="votion-timeline-bar"
                    role="button"
                    tabIndex={0}
                    aria-label={`${record.title || 'Untitled'} ${startText}–${endText}`}
                    title={`${startText} → ${endText}`}
                    onClick={() => onRecordClick?.(record.id)}
                    style={{
                      position: 'absolute',
                      left: bar?.left ?? 0,
                      top: ROW_HEIGHT / 2 - 10,
                      width: bar?.width ?? pxPerDay,
                      height: 20,
                      borderRadius: 4,
                      backgroundColor: hovered === record.id ? '#2f6f99' : '#337ea9',
                      cursor: 'pointer',
                      opacity: 0.9,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Computes a bar's pixel geometry for a record (exported for tests). */
export function timelineBarGeometry(
  record: DatabaseRecord,
  startPropertyId: string | undefined,
  endPropertyId: string | undefined,
  rangeStart: number,
  pxPerDay: number,
): { left: number; width: number } {
  const start = startPropertyId ? toDate(record.properties[startPropertyId]) : null;
  const end = endPropertyId ? toDate(record.properties[endPropertyId]) : null;
  const startMs = start ? start.getTime() : rangeStart;
  const endMs = end ? end.getTime() : startMs + 86_400_000;
  const offsetDays = Math.max(
    0,
    differenceInDays(new Date(startOfDay(new Date(startMs))), new Date(rangeStart)),
  );
  const days = Math.max(1, differenceInMinutes(new Date(endMs), new Date(startMs)) / (24 * 60));
  return { left: offsetDays * pxPerDay, width: Math.max(pxPerDay, Math.round(days * pxPerDay)) };
}

/** Reads a relation property's raw ids (used by dependency overlays). */
export function relationIdsForRecord(record: DatabaseRecord, propertyId: string): UUID[] {
  const value = record.properties[propertyId];
  return Array.isArray(value) ? (value as UUID[]) : [];
}
