/**
 * Store-bound view renderer: pulls the collection, view and rows from the
 * sync-client record store and renders the selected projection.
 */

import type { JSX } from 'react';
import type { UUID } from '@votion/types';
import type { RecordStoreApi } from '@votion/sync-client';
import { DatabaseEngineProvider } from './engineContext.js';
import type { DatabaseEngineContextValue } from './engineContext.js';
import { useCollection, useCollectionRecords, useCollectionView } from './records.js';
import { ViewRenderer } from './ViewRenderer.js';

/** Props for the store-bound renderer. */
export interface CollectionViewRendererProps {
  collectionId: UUID;
  viewId: UUID;
  store?: RecordStoreApi;
  engine?: DatabaseEngineContextValue;
  onRecordClick?: (recordId: UUID) => void;
  onChangeProperty?: (recordId: UUID, propertyId: string, value: unknown) => void;
}

/** Renders a collection view from the normalized record store. */
export function CollectionViewRenderer({
  collectionId,
  viewId,
  store,
  engine,
  onRecordClick,
  onChangeProperty,
}: CollectionViewRendererProps): JSX.Element {
  const collection = useCollection(collectionId, store);
  const view = useCollectionView(viewId, store);
  const records = useCollectionRecords(collectionId, store);

  if (!collection || !view) {
    return <div className="votion-view-missing">Collection view not found</div>;
  }

  const rendered = (
    <ViewRenderer
      collection={collection}
      view={view}
      records={records}
      onRecordClick={onRecordClick}
      onChangeProperty={onChangeProperty}
    />
  );

  return engine ? <DatabaseEngineProvider value={engine}>{rendered}</DatabaseEngineProvider> : rendered;
}
