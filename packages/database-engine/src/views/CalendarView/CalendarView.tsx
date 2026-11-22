/**
 * Calendar view: month and week projections of rows across date cells, with
 * drag-and-drop rescheduling.
 */

import { useMemo, useState, type DragEvent, type JSX } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { CollectionSchema, UUID } from '@votion/types';
import { toDate } from '../../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../../types.js';
import type { DatabaseViewProps } from '../types.js';
import { useViewRecords } from '../records.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Finds the default date property for a calendar. */
export function defaultCalendarProperty(schema: CollectionSchema): string | undefined {
  const date = Object.entries(schema).find(([, property]) => property.type === 'date');
  return date?.[0];
}

/** Calendar projection. */
export function CalendarView({
  collection,
  view,
  records,
  onRecordClick,
  onChangeProperty,
  className,
}: DatabaseViewProps): JSX.Element {
  const schema = collection.schema;
  const rows = useViewRecords(records, view, schema);
  const datePropertyId =
    view.format.calendar_by ??
    view.query2.group_by?.property ??
    defaultCalendarProperty(schema);
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [draggedId, setDraggedId] = useState<UUID | null>(null);

  const dateProperty = datePropertyId ? schema[datePropertyId] : undefined;

  const weeks = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(cursor, { weekStartsOn: 1 });
      return [Array.from({ length: 7 }, (_, index) => addDays(start, index))];
    }
    const monthStart = startOfMonth(cursor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    const result: Date[][] = [];
    let cursorDay = gridStart;
    while (cursorDay <= gridEnd) {
      const week: Date[] = [];
      for (let index = 0; index < 7; index += 1) {
        week.push(cursorDay);
        cursorDay = addDays(cursorDay, 1);
      }
      result.push(week);
    }
    return result;
  }, [mode, cursor]);

  const byDay = useMemo(() => {
    const map = new Map<string, DatabaseRecord[]>();
    for (const record of rows) {
      if (!datePropertyId) {
        continue;
      }
      const date = toDate(record.properties[datePropertyId]);
      if (!date) {
        continue;
      }
      const key = format(date, 'yyyy-MM-dd');
      const bucket = map.get(key) ?? [];
      bucket.push(record);
      map.set(key, bucket);
    }
    return map;
  }, [rows, datePropertyId]);

  const navigate = (direction: -1 | 1): void => {
    setCursor((current) =>
      mode === 'month' ? addMonths(current, direction) : addWeeks(current, direction),
    );
  };

  const handleDrop = (event: DragEvent, day: Date): void => {
    event.preventDefault();
    const recordId = (event.dataTransfer.getData('text/plain') || draggedId) as UUID | null;
    setDraggedId(null);
    if (!recordId || !datePropertyId) {
      return;
    }
    onChangeProperty?.(recordId, datePropertyId, format(day, 'yyyy-MM-dd'));
  };

  return (
    <div
      className={`votion-calendar-view ${className ?? ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      aria-label={`${view.name} calendar`}
    >
      <div
        className="votion-calendar-toolbar"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}
      >
        <button type="button" onClick={() => navigate(-1)} aria-label="Previous">
          ‹
        </button>
        <strong>
          {mode === 'month'
            ? format(cursor, 'MMMM yyyy')
            : `Week of ${format(startOfWeek(cursor, { weekStartsOn: 1 }), 'MMM d, yyyy')}`}
        </strong>
        <button type="button" onClick={() => navigate(1)} aria-label="Next">
          ›
        </button>
        <button type="button" onClick={() => setCursor(new Date())}>
          Today
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            type="button"
            aria-pressed={mode === 'month'}
            onClick={() => setMode('month')}
          >
            Month
          </button>
          <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>
            Week
          </button>
        </div>
      </div>

      <div className="votion-calendar-grid" style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(110px, 1fr))' }}>
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="votion-calendar-weekday"
              style={{ padding: 6, fontWeight: 600, borderBottom: '1px solid #e3e3e3' }}
            >
              {day}
            </div>
          ))}
          {weeks.flatMap((week) =>
            week.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayRecords = byDay.get(key) ?? [];
              return (
                <div
                  key={key}
                  className="votion-calendar-cell"
                  data-date={key}
                  style={{
                    minHeight: 110,
                    borderBottom: '1px solid #f0f0f0',
                    borderRight: '1px solid #f0f0f0',
                    padding: 4,
                    backgroundColor: isToday(day) ? '#f7f7f5' : undefined,
                    opacity: mode === 'month' && !isSameMonth(day, cursor) ? 0.5 : 1,
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(event, day)}
                >
                  <div
                    className="votion-calendar-date-number"
                    style={{ fontSize: 12, color: isToday(day) ? '#337ea9' : '#6b6b6b' }}
                  >
                    {format(day, 'd')}
                  </div>
                  {dayRecords.map((record) => (
                    <div
                      key={record.id}
                      className="votion-calendar-card"
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', record.id);
                        setDraggedId(record.id);
                      }}
                      onDragEnd={() => setDraggedId(null)}
                      onClick={() => onRecordClick?.(record.id)}
                      title={
                        dateProperty && datePropertyId
                          ? String(record.properties[datePropertyId] ?? '')
                          : ''
                      }
                      style={{
                        fontSize: 12,
                        padding: '2px 4px',
                        marginBottom: 2,
                        borderRadius: 3,
                        backgroundColor: '#e7f0f7',
                        borderLeft: '2px solid #337ea9',
                        cursor: 'grab',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {record.title || 'Untitled'}
                    </div>
                  ))}
                </div>
              );
            }),
          )}
        </div>
      </div>
      <div className="votion-calendar-status" style={{ padding: '4px 0', fontSize: 12 }}>
        {rows.length} {rows.length === 1 ? 'record' : 'records'}
        {dateProperty ? ` by ${dateProperty.name}` : ''}
      </div>
    </div>
  );
}
