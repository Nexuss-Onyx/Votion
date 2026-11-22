/**
 * List view: minimal, high-density document list with toggleable properties.
 */

import { useEffect, useState, type JSX } from 'react';
import type { CollectionProperty, CollectionSchema, CollectionView } from '@votion/types';
import { formatPropertyValue } from '../../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../../types.js';
import type { DatabaseViewProps } from '../types.js';
import { useCellValue } from '../engineContext.js';
import { useViewRecords } from '../records.js';
import { OptionBadge } from '../shared.js';

/** Returns the initial visible property ids for a list view. */
export function initialListProperties(
  view: CollectionView,
  schema: CollectionSchema,
): string[] {
  const configured = view.format?.list_properties;
  if (configured?.length) {
    const known = new Set(Object.keys(schema));
    const filtered = configured.filter((propertyId) => known.has(propertyId));
    if (filtered.length > 0) {
      return filtered;
    }
  }
  return Object.entries(schema)
    .filter(([, property]) => !property.hidden)
    .map(([propertyId]) => propertyId);
}

/** List projection. */
export function ListView({
  collection,
  view,
  records,
  onRecordClick,
  className,
}: DatabaseViewProps): JSX.Element {
  const schema = collection.schema;
  const rows = useViewRecords(records, view, schema);
  const [visible, setVisible] = useState<string[]>(() => initialListProperties(view, schema));
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    setVisible(initialListProperties(view, schema));
  }, [view, schema]);

  const toggleProperty = (propertyId: string): void => {
    setVisible((current) =>
      current.includes(propertyId)
        ? current.filter((id) => id !== propertyId)
        : [...current, propertyId],
    );
  };

  return (
    <div
      className={`votion-list-view ${className ?? ''}`}
      aria-label={`${view.name} list`}
      style={{ height: '100%', overflowY: 'auto' }}
    >
      <div
        className="votion-list-toolbar"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}
      >
        <button
          type="button"
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((open) => !open)}
        >
          Properties
        </button>
        <span style={{ fontSize: 12, color: '#6b6b6b' }}>
          {rows.length} {rows.length === 1 ? 'record' : 'records'}
        </span>
      </div>

      {panelOpen ? (
        <div
          className="votion-list-property-panel"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            padding: 8,
            border: '1px solid #e3e3e3',
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {Object.entries(schema).map(([propertyId, property]) => (
            <label key={propertyId} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={visible.includes(propertyId)}
                onChange={() => toggleProperty(propertyId)}
              />
              {property.name}
            </label>
          ))}
        </div>
      ) : null}

      <div className="votion-list-header" style={{ display: 'flex', padding: '4px 0', borderBottom: '1px solid #e3e3e3' }}>
        {visible.map((propertyId) => {
          const property = schema[propertyId];
          if (!property) {
            return null;
          }
          return (
            <div
              key={propertyId}
              className="votion-list-header-cell"
              style={{ flex: property.type === 'title' ? 2 : 1, fontWeight: 600, fontSize: 12 }}
            >
              {property.name}
            </div>
          );
        })}
      </div>

      {rows.map((record) => (
        <div
          key={record.id}
          className="votion-list-row"
          role="row"
          tabIndex={0}
          onClick={() => onRecordClick?.(record.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onRecordClick?.(record.id);
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 0',
            borderBottom: '1px solid #f0f0f0',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          {visible.map((propertyId) => {
            const property = schema[propertyId];
            if (!property) {
              return null;
            }
            return (
              <div
                key={propertyId}
                className="votion-list-cell"
                role="cell"
                style={{
                  flex: property.type === 'title' ? 2 : 1,
                  paddingRight: 8,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {property.type === 'select' || property.type === 'status' ? (
                  <OptionBadge property={property} value={record.properties[propertyId]} />
                ) : (
                  <ListProperty
                    record={record}
                    schema={schema}
                    propertyId={propertyId}
                    property={property}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Renders one list cell (hook-safe). */
function ListProperty({
  record,
  schema,
  propertyId,
  property,
}: {
  record: DatabaseRecord;
  schema: CollectionSchema;
  propertyId: string;
  property: CollectionProperty;
}): JSX.Element {
  const value = useCellValue(record, schema, propertyId, property);
  const text = formatPropertyValue(value, property);
  return <span>{text}</span>;
}
