/**
 * Shared view contracts.
 */

import type { Collection, CollectionView, UUID } from '@votion/types';
import type { DatabaseRecord } from '../types.js';

/** Props shared by every database projection. */
export interface DatabaseViewProps {
  collection: Collection;
  view: CollectionView;
  records: DatabaseRecord[];
  /** Opens a record (double click / click on title). */
  onRecordClick?: (recordId: UUID) => void;
  /** Writes a property value, usually through a transaction. */
  onChangeProperty?: (recordId: UUID, propertyId: string, value: unknown) => void;
  /** Optional className for the projection root. */
  className?: string;
}

/** Result of applying a view's filter/sort/search query. */
export interface ViewQueryResult<T> {
  records: T[];
  total: number;
}
