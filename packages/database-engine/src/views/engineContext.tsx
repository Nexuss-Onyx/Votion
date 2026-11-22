/**
 * React context exposing the relation/rollup engine to every projection cell.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CollectionSchema, UUID } from '@votion/types';
import { computeRecordCellValue } from '../relation/computed.js';
import { RollupEngine } from '../relation/RollupEngine.js';
import type { RelationResolver } from '../relation/RelationResolver.js';
import type { CollectionProperty } from '@votion/types';
import type { DatabaseRecord } from '../types.js';

/** Engine dependencies available to view components. */
export interface DatabaseEngineContextValue {
  resolver?: RelationResolver;
  getSchema?: (collectionId: UUID) => CollectionSchema | undefined;
}

/** React context holding the engine dependencies. */
export const DatabaseEngineContext = createContext<DatabaseEngineContextValue>({});

/** Provider for the database engine context. */
export function DatabaseEngineProvider({
  value,
  children,
}: {
  value: DatabaseEngineContextValue;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <DatabaseEngineContext.Provider value={value}>{children}</DatabaseEngineContext.Provider>
  );
}

/** Reads the engine context. */
export function useDatabaseEngine(): DatabaseEngineContextValue {
  return useContext(DatabaseEngineContext);
}

/** Computes a cell value using the context's relation/rollup engine. */
export function useCellValue(
  record: DatabaseRecord,
  schema: CollectionSchema,
  propertyId: string,
  property: CollectionProperty,
): unknown {
  const context = useDatabaseEngine();
  const { resolver, getSchema } = context;
  const rollupEngine = useMemo(
    () =>
      resolver && getSchema
        ? new RollupEngine({ resolver, getSchema })
        : undefined,
    [resolver, getSchema],
  );
  return useMemo(
    () =>
      computeRecordCellValue(record, schema, propertyId, property, {
        resolver,
        getSchema,
        rollupEngine,
      }),
    [record, schema, propertyId, property, resolver, getSchema, rollupEngine],
  );
}
