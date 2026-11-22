/**
 * Board view: Kanban columns grouped by select/status/date/checkbox, with
 * drag-and-drop card movement, collapsible columns and swimlanes.
 */

import { useMemo, useState, type DragEvent, type JSX } from 'react';
import type { CollectionProperty, CollectionSchema, UUID } from '@votion/types';
import {
  groupKeyToDate,
  groupRecords,
  type GroupClauseOptions,
  type RecordGroup,
} from '../../query/GroupingEngine.js';
import { formatPropertyValue } from '../../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../../types.js';
import type { DatabaseViewProps } from '../types.js';
import { useCellValue } from '../engineContext.js';
import { useViewRecords } from '../records.js';
import { OptionBadge, OPTION_COLOR_HEX } from '../shared.js';

/** Finds the default grouping property for a board. */
export function defaultBoardProperty(schema: CollectionSchema): string | undefined {
  const preferred = Object.entries(schema).find(([, property]) =>
    ['select', 'status'].includes(property.type),
  );
  if (preferred) {
    return preferred[0];
  }
  const date = Object.entries(schema).find(([, property]) => property.type === 'date');
  if (date) {
    return date[0];
  }
  const checkbox = Object.entries(schema).find(([, property]) => property.type === 'checkbox');
  return checkbox?.[0];
}

/** Board projection. */
export function BoardView({
  collection,
  view,
  records,
  onRecordClick,
  onChangeProperty,
  className,
}: DatabaseViewProps): JSX.Element {
  const schema = collection.schema;
  const rows = useViewRecords(records, view, schema);
  const groupPropertyId =
    view.format.board_columns_by ??
    view.query2.group_by?.property ??
    defaultBoardProperty(schema);
  const swimlanePropertyId = view.format.board_groups_by;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [draggedId, setDraggedId] = useState<UUID | null>(null);

  const groupClause: GroupClauseOptions | undefined = groupPropertyId
    ? {
        property: groupPropertyId,
        direction: 'ascending',
        hide_empty_groups: !view.format.board_show_empty_columns,
      }
    : undefined;

  const byId = useMemo(() => new Map(rows.map((record) => [record.id, record])), [rows]);

  const swimlanes = useMemo(() => {
    if (!swimlanePropertyId) {
      return [
        {
          key: 'all',
          label: view.name,
          recordIds: rows.map((record) => record.id),
        },
      ];
    }
    return groupRecords(rows, { property: swimlanePropertyId, direction: 'ascending' }, schema);
  }, [swimlanePropertyId, rows, schema, view.name]);

  const toggleCollapsed = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDrop = (event: DragEvent, group: RecordGroup<UUID>): void => {
    event.preventDefault();
    const recordId = (event.dataTransfer.getData('text/plain') || draggedId) as UUID | null;
    setDraggedId(null);
    if (!recordId || !groupPropertyId) {
      return;
    }
    const property = schema[groupPropertyId];
    if (!property) {
      return;
    }
    const value = valueForGroup(group, property);
    if (value !== undefined) {
      onChangeProperty?.(recordId, groupPropertyId, value);
    }
  };

  return (
    <div
      className={`votion-board-view ${className ?? ''}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowX: 'auto' }}
      aria-label={`${view.name} board`}
    >
      {swimlanes.map((swimlane) => {
        const swimlaneRows = swimlane.recordIds
          .map((id) => byId.get(id))
          .filter((record): record is DatabaseRecord => Boolean(record));
        const columns = groupPropertyId
          ? groupRecords(swimlaneRows, groupClause, schema)
          : [];
        return (
          <div key={swimlane.key} className="votion-board-swimlane" style={{ minWidth: 640 }}>
            {swimlanes.length > 1 ? (
              <div className="votion-board-swimlane-header" style={{ fontWeight: 600, padding: '4px 0' }}>
                {swimlane.label}
                <span style={{ color: '#9b9b9b', marginLeft: 8 }}>
                  {swimlaneRows.length}
                </span>
              </div>
            ) : null}
            <div className="votion-board-columns" style={{ display: 'flex', gap: 12 }}>
              {columns.map((group) => {
                const isCollapsed = collapsed.has(group.key);
                const groupProperty = groupPropertyId ? schema[groupPropertyId] : undefined;
                return (
                  <div
                    key={group.key}
                    className="votion-board-column"
                    style={{ width: 260, minWidth: 260, display: 'flex', flexDirection: 'column' }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleDrop(event, group)}
                  >
                    <div
                      className="votion-board-column-header"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px' }}
                    >
                      <button
                        type="button"
                        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                        onClick={() => toggleCollapsed(group.key)}
                        style={{ cursor: 'pointer', border: 'none', background: 'none' }}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                      {group.optionId && groupProperty ? (
                        <OptionBadge property={groupProperty} value={group.optionId} />
                      ) : (
                        <>
                          <span
                            className="votion-board-column-dot"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: group.color
                                ? OPTION_COLOR_HEX[group.color]
                                : '#9b9b9b',
                            }}
                          />
                          <span className="votion-board-column-label" style={{ flex: 1 }}>
                            {group.label}
                          </span>
                        </>
                      )}
                      <span className="votion-board-column-count" style={{ color: '#9b9b9b' }}>
                        {group.recordIds.length}
                      </span>
                    </div>
                    {!isCollapsed ? (
                      <div
                        className="votion-board-column-body"
                        style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80 }}
                      >
                        {group.recordIds.map((recordId) => {
                          const record = byId.get(recordId);
                          if (!record) {
                            return null;
                          }
                          return (
                            <BoardCard
                              key={recordId}
                              record={record}
                              schema={schema}
                              dragged={draggedId === recordId}
                              onDragStart={() => setDraggedId(recordId)}
                              onDragEnd={() => setDraggedId(null)}
                              onClick={() => onRecordClick?.(recordId)}
                            />
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Maps a board bucket to the property value written on drop. */
export function valueForGroup(
  group: RecordGroup<UUID>,
  property: CollectionProperty,
): unknown {
  if (property.type === 'checkbox') {
    if (group.key === 'checked') {
      return true;
    }
    if (group.key === 'unchecked') {
      return false;
    }
    return undefined;
  }
  if (property.type === 'date') {
    if (group.startTimestamp == null) {
      return null;
    }
    return groupKeyToDate(String(group.startTimestamp), 'day') ?? null;
  }
  if (group.key === 'no_value') {
    return null;
  }
  if (group.optionId) {
    return group.optionId;
  }
  return group.key;
}

/** One Kanban card. */
function BoardCard({
  record,
  schema,
  dragged,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  record: DatabaseRecord;
  schema: CollectionSchema;
  dragged: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}): JSX.Element {
  const tagPropertyIds = Object.entries(schema)
    .filter(([, property]) => property.type !== 'title' && !property.hidden)
    .slice(0, 3)
    .map(([propertyId]) => propertyId);

  return (
    <div
      className="votion-board-card"
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', record.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onClick();
        }
      }}
      style={{
        padding: 10,
        borderRadius: 6,
        border: dragged ? '1px solid #337ea9' : '1px solid #e3e3e3',
        backgroundColor: '#ffffff',
        cursor: 'grab',
        opacity: dragged ? 0.6 : 1,
      }}
    >
      <div className="votion-board-card-title" style={{ fontWeight: 600, marginBottom: 6 }}>
        {record.title || 'Untitled'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tagPropertyIds.map((propertyId) => {
          const property = schema[propertyId];
          if (!property) {
            return null;
          }
          if (property.type === 'select' || property.type === 'status') {
            return <OptionBadge key={propertyId} property={property} value={record.properties[propertyId]} />;
          }
          return (
            <CardProperty
              key={propertyId}
              record={record}
              schema={schema}
              propertyId={propertyId}
              property={property}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Renders one card property line (hook-safe). */
function CardProperty({
  record,
  schema,
  propertyId,
  property,
}: {
  record: DatabaseRecord;
  schema: CollectionSchema;
  propertyId: string;
  property: CollectionProperty;
}): JSX.Element | null {
  const value = useCellValue(record, schema, propertyId, property);
  const text = formatPropertyValue(value, property);
  if (!text) {
    return null;
  }
  return (
    <span style={{ fontSize: 12, color: '#6b6b6b' }}>
      {property.name}: {text}
    </span>
  );
}
