/**
 * `QuickFindController` — framework-free search-as-you-type state machine.
 *
 * Kept separate from React for three reasons:
 *  - it is the part with all the tricky behaviour (debounce, cancellation,
 *    stale responses, empty-state switch), so it must be directly testable;
 *  - the same controller can drive a non-React widget (mobile shell, CLI);
 *  - `useQuickFind` becomes a 20-line adapter around it.
 *
 * States:
 *
 * ```
 *   idle ──setQuery(raw)──▶ debouncing ──timer──▶ loading ──response──▶ ready
 *                              │                    │
 *                              │◀──setQuery(raw)────┘  (previous aborted)
 *                              └──reset()──▶ recent view
 * ```
 */

import type { QuickFindSearchService } from '../client/QuickFindSearchService.js';
import { isAbortError } from '../client/QuickFindSearchService.js';
import { normalizeQuickFindTerm } from '../query/QuickFindQueryBuilder.js';
import type { QuickFindAccessScope, QuickFindSearchResult } from '../types.js';

/** Debounce window for search-as-you-type, in milliseconds. */
export const QUICK_FIND_DEBOUNCE_MS = 150;

/** Minimum characters before a text search is issued. */
export const QUICK_FIND_MIN_TERM_LENGTH = 1;

/** Maximum number of rows requested by the modal. */
export const QUICK_FIND_RESULT_LIMIT = 20;

/** Immutable snapshot consumed by the UI. */
export interface QuickFindState {
  /** Raw input value, case preserved ("Q4 Road"). */
  query: string;
  /** Normalised term that produced `result`. */
  activeQuery: string;
  /** Latest result set (search hits or recent pages). */
  result: QuickFindSearchResult | null;
  /** `true` while debouncing or awaiting the transport. */
  loading: boolean;
  /** Last transport failure. */
  error: Error | null;
  /** `true` when the empty-query recent-pages view is showing. */
  isRecentView: boolean;
}

/** Options accepted by {@link QuickFindController}. */
export interface QuickFindControllerOptions {
  /** Service bound to the transport. */
  service: QuickFindSearchService;
  /** ACL scope; `null` disables searching (results become empty). */
  scope: QuickFindAccessScope | null;
  /** Debounce window in ms (default 150). */
  debounceMs?: number;
  /** Rows requested for a text search (default 20). */
  limit?: number;
  /** Rows requested for the recent-pages view (default 8). */
  recentLimit?: number;
  /** Clock injection (tests). */
  now?: () => number;
  /** Timer injection (tests). */
  setTimeoutFn?: (handler: () => void, timeout: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

type Listener = (state: QuickFindState) => void;

const INITIAL_STATE: QuickFindState = {
  query: '',
  activeQuery: '',
  result: null,
  loading: false,
  error: null,
  isRecentView: true,
};

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Observable controller. Every mutating method replaces the snapshot object, so
 * consumers can rely on identity comparison (`useSyncExternalStore`,
 * `React.memo`, Redux devtools).
 */
export class QuickFindController {
  private options: QuickFindControllerOptions;
  private state: QuickFindState = INITIAL_STATE;
  private readonly listeners = new Set<Listener>();
  private timer: unknown = null;
  private abort: AbortController | null = null;
  private requestId = 0;
  private disposed = false;

  constructor(options: QuickFindControllerOptions) {
    this.options = options;
  }

  /** Current immutable snapshot. */
  getState = (): QuickFindState => this.state;

  /** Subscribes to state changes; returns the unsubscribe function. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Replaces the ACL scope or service (e.g. workspace switch). */
  reconfigure(patch: Partial<QuickFindControllerOptions>): void {
    this.options = { ...this.options, ...patch };
    if (
      patch.debounceMs !== undefined ||
      patch.limit !== undefined ||
      patch.recentLimit !== undefined
    ) {
      // Options only; nothing to re-fetch until the next keystroke.
      return;
    }
  }

  /** Updates the raw query and schedules a debounced search. */
  setQuery(raw: string): void {
    const query = typeof raw === 'string' ? raw : '';
    const term = normalizeQuickFindTerm(query);
    this.cancelScheduled();
    this.setState({
      query,
      isRecentView: term.length < QUICK_FIND_MIN_TERM_LENGTH,
      error: null,
      // Loading starts immediately so the spinner reflects intent, not network.
      loading: true,
    });
    this.schedule(term);
  }

  /** Flushes the pending query immediately (Enter / submit button). */
  submit(): void {
    const term = normalizeQuickFindTerm(this.state.query);
    this.cancelScheduled();
    if (term.length >= QUICK_FIND_MIN_TERM_LENGTH) {
      void this.run(term);
    }
  }

  /** Clears the query and returns to the recent-pages view. */
  reset(): void {
    this.cancelScheduled();
    this.abort?.abort();
    this.abort = null;
    this.requestId += 1;
    this.setState({
      query: '',
      activeQuery: '',
      result: null,
      loading: false,
      error: null,
      isRecentView: true,
    });
  }

  /** Re-runs the current query (retry after a failure). */
  refresh(): void {
    this.cancelScheduled();
    const term = normalizeQuickFindTerm(this.state.query);
    void this.run(term);
  }

  /** Loads the recent-pages list without a query (modal opened on empty input). */
  loadRecent(): void {
    this.cancelScheduled();
    void this.run('');
  }

  /** Aborts timers/listeners; the controller is unusable afterwards. */
  dispose(): void {
    this.cancelScheduled();
    this.abort?.abort();
    this.abort = null;
    this.listeners.clear();
    this.disposed = true;
  }

  /* ---------------------------------------------------------------------- */

  private setState(patch: Partial<QuickFindState>): void {
    const next: QuickFindState = { ...this.state, ...patch };
    const unchanged = (Object.keys(patch) as (keyof QuickFindState)[]).every(
      (key) => next[key] === this.state[key],
    );
    if (unchanged) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  private cancelScheduled(): void {
    if (this.timer === null) {
      return;
    }
    const clear =
      this.options.clearTimeoutFn ??
      ((handle: unknown) => clearTimeout(handle as never));
    clear(this.timer);
    this.timer = null;
  }

  private schedule(term: string): void {
    const setTimer =
      this.options.setTimeoutFn ??
      ((handler: () => void, ms: number) => setTimeout(handler, ms));
    this.timer = setTimer(() => {
      this.timer = null;
      void this.run(term);
    }, this.options.debounceMs ?? QUICK_FIND_DEBOUNCE_MS);
  }

  private async run(term: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    const { service, scope } = this.options;
    const requestId = this.requestId + 1;
    this.requestId = requestId;

    if (!scope) {
      this.setState({
        activeQuery: term,
        result: null,
        loading: false,
        error: null,
      });
      return;
    }

    this.abort?.abort();
    const controller = new AbortController();
    this.abort = controller;

    this.setState({ loading: true, error: null });

    try {
      const result =
        term.length < QUICK_FIND_MIN_TERM_LENGTH
          ? await service.recentPages(scope, {
              limit: this.options.recentLimit ?? 8,
            })
          : await service.search(
              { term, limit: this.options.limit ?? QUICK_FIND_RESULT_LIMIT },
              scope,
              { signal: controller.signal },
            );

      if (this.disposed || requestId !== this.requestId) {
        return;
      }
      this.setState({
        activeQuery: term,
        result,
        loading: false,
        error: null,
        isRecentView: term.length < QUICK_FIND_MIN_TERM_LENGTH,
      });
    } catch (caught) {
      if (this.disposed || requestId !== this.requestId) {
        return;
      }
      if (isAbortError(caught)) {
        return;
      }
      this.setState({
        activeQuery: term,
        result: null,
        loading: false,
        error: toError(caught),
      });
    }
  }
}
