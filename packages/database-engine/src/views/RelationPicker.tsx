/**
 * Linked record picker modal used by relation properties.
 */

import { useMemo, useState, type JSX } from 'react';
import type { Collection, CollectionSchema, UUID } from '@votion/types';
import type { DatabaseRecord } from '../types.js';

/** Props for {@link RelationPicker}. */
export interface RelationPickerProps {
  /** Target collection the relation points at. */
  collection: Collection;
  schema: CollectionSchema;
  /** Selectable records from the target collection. */
  records: DatabaseRecord[];
  /** Currently linked record ids. */
  selectedIds: UUID[];
  /** Called with the next id list when the user confirms. */
  onConfirm: (ids: UUID[]) => void;
  /** Dismisses the modal without changing the selection. */
  onClose: () => void;
}

/** Modal picker for relation properties. */
export function RelationPicker({
  collection,
  records,
  selectedIds,
  onConfirm,
  onClose,
}: RelationPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<UUID>>(new Set(selectedIds));

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return records;
    }
    return records.filter((record) => record.title.toLowerCase().includes(needle));
  }, [records, query]);

  const toggle = (id: UUID): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div
      className="votion-relation-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Link records in ${collection.name.map((segment) => segment[0]).join('')}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        className="votion-relation-picker"
        style={{
          width: 420,
          maxWidth: '90vw',
          maxHeight: '80vh',
          backgroundColor: '#ffffff',
          borderRadius: 8,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 600 }}>Link records</div>
        <input
          type="text"
          aria-label="Search records"
          placeholder="Search records"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.length === 0 ? (
            <div style={{ color: '#9b9b9b', padding: '8px 0' }}>No records found</div>
          ) : (
            filtered.map((record) => (
              <label
                key={record.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 4px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  aria-label={record.title || 'Untitled'}
                  checked={selected.has(record.id)}
                  onChange={() => toggle(record.id)}
                />
                <span>{record.title || 'Untitled'}</span>
              </label>
            ))
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm([...selected])}
          >
            Done ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
