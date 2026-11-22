/**
 * Table view: a virtualised spreadsheet grid with draggable/resizable column
 * headers, in-cell editing and a footer aggregation row.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CollectionProperty, CollectionSchema, RichText, UUID } from '@votion/types';
import { computeFooters } from '../../query/Aggregations.js';
import {
  formatPropertyValue,
  getPropertyTypeDefinition,
  toDate,
} from '../../schema/PropertyRegistry.js';
import { richTextToString } from '../../types.js';
import type { DatabaseRecord } from '../../types.js';
import type { DatabaseViewProps } from '../types.js';
import { useCellValue } from '../engineContext.js';
import { useViewRecords, viewVisibleProperties } from '../records.js';
import { OptionBadge } from '../shared.js';

const DEFAULT_COLUMN_WIDTH = 160;
const TITLE_COLUMN_WIDTH = 280;
const ROW_HEIGHT = 36;

interface ColumnState {
  propertyId: string;
  property: CollectionProperty;
  width: number;
}

/** Table projection. */
export function TableView({
  collection,
  view,
  records,
  onRecordClick,
  onChangeProperty,
  className,
}: DatabaseViewProps): JSX.Element {
  const schema = collection.schema;
  const rows = useViewRecords(records, view, schema);
  const visible = viewVisibleProperties(view, schema);
  const [order, setOrder] = useState<string[] | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<{ recordId: UUID; propertyId: string } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizeState = useRef<{
    propertyId: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  const columns: ColumnState[] = useMemo(() => {
    const base = order ?? visible;
    const merged = base.filter((propertyId) => propertyId in schema);
    for (const propertyId of visible) {
      if (!merged.includes(propertyId)) {
        merged.push(propertyId);
      }
    }
    return merged.map((propertyId) => {
      const property = schema[propertyId];
      if (!property) {
        throw new Error(`Unknown property ${propertyId}`);
      }
      return {
        propertyId,
        property,
        width: widths[propertyId] ?? (property.type === 'title' ? TITLE_COLUMN_WIDTH : DEFAULT_COLUMN_WIDTH),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, visible, widths, schema]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const measuredItems = virtualizer.getVirtualItems();
  // jsdom (and SSR) report a zero-height viewport; fall back to rendering every
  // row so the grid is still meaningful before the first measurement.
  const virtualItems =
    measuredItems.length > 0
      ? measuredItems
      : rows.map((record, index) => ({
          index,
          start: index * ROW_HEIGHT,
          size: ROW_HEIGHT,
          key: record.id,
        }));
  const bodyHeight = virtualizer.getTotalSize() || rows.length * ROW_HEIGHT;
  const totalWidth = columns.reduce((total, column) => total + column.width, 0);
  const footers = useMemo(
    () => computeFooters(rows, schema, columns.map((column) => column.propertyId)),
    [rows, schema, columns],
  );

  useEffect(() => {
    const handleMove = (event: MouseEvent): void => {
      const state = resizeState.current;
      if (!state) {
        return;
      }
      const next = Math.max(64, state.startWidth + event.clientX - state.startX);
      setWidths((current) => ({ ...current, [state.propertyId]: next }));
    };
    const handleUp = (): void => {
      resizeState.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const startResize = (event: React.MouseEvent, column: ColumnState): void => {
    event.preventDefault();
    resizeState.current = {
      propertyId: column.propertyId,
      startX: event.clientX,
      startWidth: column.width,
    };
  };

  const reorderColumn = (from: number, to: number): void => {
    if (from === to) {
      return;
    }
    const next = columns.map((column) => column.propertyId);
    const [moved] = next.splice(from, 1);
    if (moved == null) {
      return;
    }
    next.splice(to, 0, moved);
    setOrder(next);
  };

  return (
    <div
      className={`votion-table-view ${className ?? ''}`}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 320 }}
    >
      <div
        ref={scrollRef}
        className="votion-table-scroll"
        role="grid"
        aria-label={`${view.name} table`}
        style={{ overflow: 'auto', flex: 1, position: 'relative' }}
      >
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          <div
            role="row"
            className="votion-table-header"
            style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2 }}
          >
            {columns.map((column, index) => (
              <div
                key={column.propertyId}
                role="columnheader"
                aria-label={column.property.name}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropIndex(index);
                }}
                onDrop={() => {
                  if (dragIndex != null) {
                    reorderColumn(dragIndex, index);
                  }
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                className="votion-table-header-cell"
                style={{
                  width: column.width,
                  minWidth: column.width,
                  boxShadow: dropIndex === index && dragIndex !== index ? 'inset 2px 0 0 #337ea9' : undefined,
                }}
                title={column.property.name}
              >
                <span className="votion-table-header-name">{column.property.name}</span>
                <span
                  className="votion-table-resize-handle"
                  aria-hidden="true"
                  onMouseDown={(event) => startResize(event, column)}
                  style={{ cursor: 'col-resize' }}
                />
              </div>
            ))}
          </div>

          <div
            className="votion-table-body"
            style={{ height: bodyHeight, position: 'relative' }}
          >
            {virtualItems.map((virtualRow) => {
              const record = rows[virtualRow.index];
              if (!record) {
                return null;
              }
              return (
                <div
                  key={record.id}
                  role="row"
                  className="votion-table-row"
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: totalWidth,
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'flex',
                  }}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.propertyId}
                      record={record}
                      schema={schema}
                      propertyId={column.propertyId}
                      property={column.property}
                      width={column.width}
                      editing={
                        editing?.recordId === record.id &&
                        editing.propertyId === column.propertyId
                      }
                      onStartEdit={() =>
                        setEditing({ recordId: record.id, propertyId: column.propertyId })
                      }
                      onCommit={(value) => {
                        onChangeProperty?.(record.id, column.propertyId, value);
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                      onOpenRecord={() => onRecordClick?.(record.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          <div role="row" className="votion-table-footer" style={{ display: 'flex' }}>
            {columns.map((column) => (
              <div
                key={column.propertyId}
                role="cell"
                className="votion-table-footer-cell"
                style={{ width: column.width, minWidth: column.width }}
                title={footers[column.propertyId]?.label}
              >
                {footers[column.propertyId]?.value ?? ''}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="votion-table-status" style={{ padding: '4px 8px', fontSize: 12 }}>
        {rows.length} {rows.length === 1 ? 'row' : 'rows'}
      </div>
    </div>
  );
}

/** One editable table cell. */
function TableCell({
  record,
  schema,
  propertyId,
  property,
  width,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
  onOpenRecord,
}: {
  record: DatabaseRecord;
  schema: CollectionSchema;
  propertyId: string;
  property: CollectionProperty;
  width: number;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  onOpenRecord: () => void;
}): JSX.Element {
  const computed = useCellValue(record, schema, propertyId, property);
  const definition = getPropertyTypeDefinition(property.type);
  const isComputed = definition.computed;

  if (editing && !isComputed && definition.editor !== 'file') {
    return (
      <CellEditor
        record={record}
        propertyId={propertyId}
        property={property}
        width={width}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  const display = formatPropertyValue(computed, property);
  const isSelectLike = property.type === 'select' || property.type === 'status';

  return (
    <div
      role="cell"
      className="votion-table-cell"
      style={{ width, minWidth: width }}
      onDoubleClick={isComputed ? undefined : onStartEdit}
      onClick={property.type === 'title' ? onOpenRecord : undefined}
      title={display}
    >
      {isSelectLike ? (
        <OptionBadge property={property} value={computed} />
      ) : (
        <span>{display}</span>
      )}
    </div>
  );
}

/** Editor surface for one cell. */
function CellEditor({
  record,
  propertyId,
  property,
  width,
  onCommit,
  onCancel,
}: {
  record: DatabaseRecord;
  propertyId: string;
  property: CollectionProperty;
  width: number;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}): JSX.Element {
  const value = record.properties[propertyId];
  const [draft, setDraft] = useState<string>(() => initialDraft(value, property));

  const commit = (): void => {
    onCommit(convertDraft(draft, property));
  };

  const style = { width, minWidth: width };

  if (property.type === 'checkbox') {
    return (
      <div role="cell" className="votion-table-cell-editor" style={style}>
        <input
          type="checkbox"
          aria-label={property.name}
          checked={value === true}
          onChange={(event) => {
            onCommit(event.target.checked);
          }}
        />
      </div>
    );
  }

  if (property.type === 'select' || property.type === 'status') {
    return (
      <div role="cell" className="votion-table-cell-editor" style={style}>
        <select
          aria-label={property.name}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onCommit(event.target.value || null)}
        >
          <option value="">None</option>
          {(property.options ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.value}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (property.type === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div role="cell" className="votion-table-cell-editor" style={style}>
        {(property.options ?? []).map((option) => (
          <label key={option.id} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, option.id]
                  : selected.filter((id) => id !== option.id);
                onCommit(next);
              }}
            />
            {option.value}
          </label>
        ))}
      </div>
    );
  }

  if (property.type === 'date') {
    return (
      <div role="cell" className="votion-table-cell-editor" style={style}>
        <input
          type="date"
          aria-label={property.name}
          value={toDate(value)?.toISOString().slice(0, 10) ?? ''}
          onChange={(event) => onCommit(event.target.value || null)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
            }
            if (event.key === 'Escape') {
              onCancel();
            }
          }}
          autoFocus
        />
      </div>
    );
  }

  const inputType =
    property.type === 'number'
      ? 'number'
      : property.type === 'email'
        ? 'email'
        : property.type === 'url'
          ? 'url'
          : 'text';

  return (
    <div role="cell" className="votion-table-cell-editor" style={style}>
      <input
        type={inputType}
        aria-label={property.name}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          }
          if (event.key === 'Escape') {
            onCancel();
          }
        }}
        autoFocus
      />
    </div>
  );
}

function initialDraft(value: unknown, property: CollectionProperty): string {
  if (value == null) {
    return '';
  }
  if (property.type === 'number') {
    return typeof value === 'number' ? String(value) : '';
  }
  if (property.type === 'person') {
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (property.type === 'title' || property.type === 'text') {
    return richTextToString((value ?? []) as RichText);
  }
  return String(value);
}

function convertDraft(draft: string, property: CollectionProperty): unknown {
  switch (property.type) {
    case 'number':
      return draft.trim() === '' ? null : Number(draft);
    case 'title':
    case 'text':
      return draft === '' ? ([] as RichText) : ([[draft]] as RichText);
    case 'person':
      return draft
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    case 'date':
      return draft || null;
    case 'url':
    case 'email':
    case 'phone_number':
      return draft || null;
    default:
      return draft === '' ? null : draft;
  }
}
