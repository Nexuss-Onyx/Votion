/**
 * Gallery view: responsive card grid with cover images and property tags.
 */

import type { JSX } from 'react';
import type { CardSize, CollectionSchema } from '@votion/types';
import { formatPropertyValue } from '../../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../../types.js';
import type { DatabaseViewProps } from '../types.js';
import { useCellValue } from '../engineContext.js';
import { useViewRecords, viewCardProperties } from '../records.js';
import { OptionBadge } from '../shared.js';

/** Resolves a card cover URL from the page cover, file properties, or icon. */
export function recordCoverUrl(
  record: DatabaseRecord,
  schema: CollectionSchema,
  source: 'cover' | 'content' | 'none',
): string | null {
  if (source === 'none') {
    return null;
  }
  if (source === 'cover' && record.cover) {
    return record.cover;
  }
  for (const [propertyId, property] of Object.entries(schema)) {
    if (property.type !== 'file') {
      continue;
    }
    const files = record.properties[propertyId];
    if (!Array.isArray(files)) {
      continue;
    }
    for (const file of files) {
      if (typeof file === 'object' && file != null && 'url' in file) {
        const url = String((file as { url?: unknown }).url ?? '');
        const name = String((file as { name?: unknown }).name ?? '').toLowerCase();
        const mime = String((file as { mime_type?: unknown }).mime_type ?? '').toLowerCase();
        if (url && (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name) || source === 'content')) {
          return url;
        }
      }
    }
  }
  if (source === 'content') {
    return record.cover ?? null;
  }
  return null;
}

const CARD_WIDTH: Record<CardSize, number> = {
  small: 180,
  medium: 240,
  large: 320,
};

/** Gallery projection. */
export function GalleryView({
  collection,
  view,
  records,
  onRecordClick,
  className,
}: DatabaseViewProps): JSX.Element {
  const schema = collection.schema;
  const rows = useViewRecords(records, view, schema);
  const coverSource = view.format.gallery_cover ?? 'cover';
  const cardSize = view.format.gallery_card_size ?? view.format.gallery_cover_size ?? 'medium';
  const cardWidth = CARD_WIDTH[cardSize] ?? CARD_WIDTH.medium;
  const tagPropertyIds = viewCardProperties(view, schema, 3);

  return (
    <div
      className={`votion-gallery-view ${className ?? ''}`}
      aria-label={`${view.name} gallery`}
      style={{ padding: 8, overflowY: 'auto', height: '100%' }}
    >
      <div
        className="votion-gallery-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardWidth}px, 1fr))`,
          gap: 16,
        }}
      >
        {rows.map((record) => {
          const cover = recordCoverUrl(record, schema, coverSource);
          return (
            <div
              key={record.id}
              className="votion-gallery-card"
              role="button"
              tabIndex={0}
              onClick={() => onRecordClick?.(record.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onRecordClick?.(record.id);
                }
              }}
              style={{
                border: '1px solid #e3e3e3',
                borderRadius: 8,
                overflow: 'hidden',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
              }}
            >
              <div
                className="votion-gallery-cover"
                style={{
                  height: cardWidth * 0.66,
                  backgroundColor: '#f1f1ef',
                  backgroundImage: cover ? `url(${cover})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                  color: '#9b9b9b',
                  fontSize: 28,
                }}
              >
                {!cover && (record.icon ?? '📄')}
              </div>
              <div style={{ padding: 10 }}>
                <div
                  className="votion-gallery-title"
                  style={{ fontWeight: 600, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {record.title || 'Untitled'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tagPropertyIds.map((propertyId) => {
                    const property = schema[propertyId];
                    if (!property) {
                      return null;
                    }
                    if (property.type === 'select' || property.type === 'status') {
                      return (
                        <OptionBadge
                          key={propertyId}
                          property={property}
                          value={record.properties[propertyId]}
                        />
                      );
                    }
                    return (
                      <GalleryProperty
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
            </div>
          );
        })}
      </div>
      <div className="votion-gallery-status" style={{ padding: '4px 0', fontSize: 12 }}>
        {rows.length} {rows.length === 1 ? 'record' : 'records'}
      </div>
    </div>
  );
}

/** Renders one gallery tag (hook-safe). */
function GalleryProperty({
  record,
  schema,
  propertyId,
  property,
}: {
  record: DatabaseRecord;
  schema: CollectionSchema;
  propertyId: string;
  property: Parameters<typeof formatPropertyValue>[1];
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
