/**
 * Shared test helpers: an isolated record store plus a provider wrapper.
 */
import { render, cleanup, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import {
  createRecordStore,
  setRecordStore,
  resetRecordStore,
  type RecordStoreApi,
} from '@votion/sync-client';
import { WorkspaceProvider } from '@/state/WorkspaceProvider';

/** Installs a fresh, empty record store as the process default. */
export function installFreshStore(): RecordStoreApi {
  const store = createRecordStore();
  setRecordStore(store);
  return store;
}

/** Restores the default store singleton (called after each test). */
export function restoreDefaultStore(): void {
  resetRecordStore();
}

export interface RenderShellOptions {
  /** Wrap the component in the WorkspaceProvider (default true). */
  provider?: boolean;
  /** Provider seed flag (default true). */
  seed?: boolean;
}

/** Renders `ui` inside (or without) the WorkspaceProvider. */
export function renderShell(ui: ReactElement, options: RenderShellOptions = {}): RenderResult & { store: RecordStoreApi } {
  const store = installFreshStore();
  const provider = options.provider ?? true;
  const seed = options.seed ?? true;

  const wrapper = ({ children }: { children: ReactNode }) =>
    provider ? <WorkspaceProvider seed={seed}>{children}</WorkspaceProvider> : <>{children}</>;

  const result = render(ui, { wrapper });
  return { ...result, store };
}

export { cleanup };
