/**
 * `useQuickFind` — React adapter around {@link QuickFindController}.
 *
 * All behaviour (150 ms debounce, request cancellation, stale-response guard,
 * empty-state switch, error containment) lives in the controller so it can be
 * tested without a DOM. This hook only wires it to React's subscription model.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';

import {
  QUICK_FIND_DEBOUNCE_MS,
  QUICK_FIND_MIN_TERM_LENGTH,
  QUICK_FIND_RESULT_LIMIT,
  QuickFindController,
  type QuickFindState,
} from './QuickFindController.js';
import type { QuickFindSearchService } from '../client/QuickFindSearchService.js';
import type { QuickFindAccessScope, QuickFindHit } from '../types.js';

export { QUICK_FIND_DEBOUNCE_MS, QUICK_FIND_MIN_TERM_LENGTH };

/** Options accepted by {@link useQuickFind}. */
export interface UseQuickFindOptions {
  /** Service bound to the transport (server-proxied or direct Meilisearch). */
  service: QuickFindSearchService;
  /** ACL scope of the current user, resolved by the app shell. */
  scope: QuickFindAccessScope | null;
  /** Debounce override (tests). */
  debounceMs?: number;
  /** Whether the modal is currently open (no work while closed). */
  enabled?: boolean;
  /** Recent pages count in the empty state. */
  recentLimit?: number;
  /** Rows requested per text search. */
  limit?: number;
}

/** State returned by {@link useQuickFind}. */
export interface UseQuickFindState extends QuickFindState {
  /** Convenience accessor for `result.hits`. */
  hits: QuickFindHit[];
  /** Sets the query and schedules a search. */
  setQuery(next: string): void;
  /** Flushes the pending term immediately (Enter key). */
  submit(): void;
  /** Clears the query and returns to the recent view. */
  reset(): void;
  /** Re-runs the current query (retry after an error). */
  refresh(): void;
}

const SERVER_STATE: QuickFindState = {
  query: '',
  activeQuery: '',
  result: null,
  loading: false,
  error: null,
  isRecentView: true,
};

export function useQuickFind(options: UseQuickFindOptions): UseQuickFindState {
  const {
    service,
    scope,
    enabled = true,
    debounceMs = QUICK_FIND_DEBOUNCE_MS,
    recentLimit = 8,
    limit = QUICK_FIND_RESULT_LIMIT,
  } = options;

  const controllerRef = useRef<QuickFindController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new QuickFindController({
      service,
      scope,
      debounceMs,
      recentLimit,
      limit,
    });
  }
  const controller = controllerRef.current;

  // Keep the controller in sync with props (workspace switch, new service).
  useEffect(() => {
    controller.reconfigure({ service, scope, debounceMs, recentLimit, limit });
  }, [controller, service, scope, debounceMs, recentLimit, limit]);

  useEffect(() => () => controller.dispose(), [controller]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    () => SERVER_STATE,
  );

  // Opening the modal on an empty input loads the recent-pages list.
  useEffect(() => {
    if (enabled && controller.getState().query.length === 0) {
      controller.loadRecent();
    }
  }, [enabled, controller]);

  const setQuery = useCallback(
    (next: string) => controller.setQuery(next),
    [controller],
  );
  const submit = useCallback(() => controller.submit(), [controller]);
  const reset = useCallback(() => controller.reset(), [controller]);
  const refresh = useCallback(() => controller.refresh(), [controller]);

  const hits = useMemo(() => state.result?.hits ?? [], [state.result]);

  return {
    ...state,
    hits,
    setQuery,
    submit,
    reset,
    refresh,
  };
}
