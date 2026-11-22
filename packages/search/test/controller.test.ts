/**
 * Search-as-you-type contract: debouncing, cancellation, stale responses,
 * error containment and the recent-pages empty state.
 *
 * `QuickFindController` is the framework-free state machine that `useQuickFind`
 * wraps, so these tests exercise the exact code the modal runs.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  QUICK_FIND_DEBOUNCE_MS,
  QuickFindController,
  type QuickFindState,
} from '../src/components/QuickFindController.js';
import { QuickFindSearchService } from '../src/client/QuickFindSearchService.js';
import type {
  RawSearchResponse,
  SearchExecutor,
} from '../src/client/SearchTransport.js';
import { BLOCKS_INDEX_UID } from '../src/client/indexSchema.js';
import type { QuickFindAccessScope } from '../src/types.js';
import {
  PROJECTS_PAGE_ID,
  ROADMAP_PAGE_ID,
  SPACE_ID,
  USER_ID,
} from './fixtures/blocks.js';
import { deferred } from './support/render.js';

const scope: QuickFindAccessScope = {
  userId: USER_ID,
  spaceIds: [SPACE_ID],
  readableRootPageIds: [ROADMAP_PAGE_ID],
};

function response(
  title: string,
  overrides: Partial<RawSearchResponse> = {},
): RawSearchResponse {
  return {
    hits: [
      {
        id: `${title}-id`,
        space_id: SPACE_ID,
        root_page_id: ROADMAP_PAGE_ID,
        type: 'page',
        title,
        plain_text: title,
        _formatted: { title },
      },
    ],
    processingTimeMs: 2,
    estimatedTotalHits: 1,
    ...overrides,
  };
}

/** Executor that answers immediately with the query echoed in the title. */
class EchoExecutor implements SearchExecutor {
  readonly indexUid = BLOCKS_INDEX_UID;
  readonly queries: string[] = [];

  async execute(query: string): Promise<RawSearchResponse> {
    this.queries.push(query);
    return response(query.length === 0 ? 'Recent page' : `Result for ${query}`);
  }
}

/** Executor whose responses are released manually (ordering tests). */
class DeferredExecutor implements SearchExecutor {
  readonly indexUid = BLOCKS_INDEX_UID;
  readonly pending: {
    query: string;
    resolve: (value: RawSearchResponse) => void;
  }[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];

  async execute(
    query: string,
    _options: unknown,
    requestInit?: { signal?: AbortSignal },
  ): Promise<RawSearchResponse> {
    this.signals.push(requestInit?.signal);
    const { promise, resolve } = deferred<RawSearchResponse>();
    this.pending.push({ query, resolve });
    return promise;
  }
}

interface Harness {
  controller: QuickFindController;
  states: QuickFindState[];
  tick: (ms?: number) => Promise<void>;
}

function harness(
  executor: SearchExecutor,
  options: { debounceMs?: number } = {},
): Harness {
  const states: QuickFindState[] = [];
  const controller = new QuickFindController({
    service: new QuickFindSearchService(executor),
    scope,
    debounceMs: options.debounceMs ?? QUICK_FIND_DEBOUNCE_MS,
  });
  controller.subscribe((state) => states.push(state));
  return {
    controller,
    states,
    tick: (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

describe('QuickFindController — debouncing', () => {
  it('coalesces a burst of keystrokes into one search', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 20 });

    controller.setQuery('r');
    controller.setQuery('ro');
    controller.setQuery('roa');
    controller.setQuery('road');

    // Nothing has been sent yet: the debounce is pending.
    expect(executor.queries).toEqual([]);
    expect(controller.getState().loading).toBe(true);

    await tick(40);
    expect(executor.queries).toEqual(['road']);
    expect(controller.getState().loading).toBe(false);
    expect(controller.getState().activeQuery).toBe('road');
  });

  it('normalises the term before searching', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });
    controller.setQuery('  Q4   RoadMAP ');
    await tick(20);
    expect(executor.queries).toEqual(['q4 roadmap']);
    // The input keeps the user's casing; the query does not.
    expect(controller.getState().query).toBe('  Q4   RoadMAP ');
  });

  it('defaults to a 150 ms debounce', () => {
    expect(QUICK_FIND_DEBOUNCE_MS).toBe(150);
  });

  it('submit() flushes immediately without waiting for the debounce', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 120 });
    controller.setQuery('instant');
    controller.submit();
    await tick();
    expect(executor.queries).toEqual(['instant']);
  });

  it('reset() cancels the pending search and returns to the recent view', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 20 });
    controller.setQuery('roadmap');
    controller.reset();
    await tick(40);
    expect(executor.queries).toEqual([]);
    expect(controller.getState()).toMatchObject({
      query: '',
      result: null,
      isRecentView: true,
      loading: false,
    });
  });
});

describe('QuickFindController — empty state', () => {
  it('loads recent pages on demand', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor);
    controller.loadRecent();
    await tick();
    expect(executor.queries).toEqual(['']);
    expect(controller.getState().isRecentView).toBe(true);
    expect(controller.getState().result?.hits[0]?.plainTitle).toBe(
      'Recent page',
    );
  });

  it('switches back to the recent view when the query is cleared', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });
    controller.setQuery('road');
    await tick(20);
    expect(controller.getState().isRecentView).toBe(false);

    controller.setQuery('');
    await tick(20);
    expect(controller.getState().isRecentView).toBe(true);
    expect(executor.queries).toEqual(['road', '']);
  });
});

describe('QuickFindController — cancellation & ordering', () => {
  it('aborts the in-flight request when a new one starts', async () => {
    const executor = new DeferredExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });

    controller.setQuery('ro');
    await tick(15);
    expect(executor.pending).toHaveLength(1);

    controller.setQuery('roadmap');
    await tick(15);
    expect(executor.pending).toHaveLength(2);
    expect(executor.signals[0]?.aborted).toBe(true);
    expect(executor.signals[1]?.aborted).toBe(false);

    executor.pending[1]?.resolve(response('roadmap'));
    await tick(5);
    expect(controller.getState().result?.hits[0]?.plainTitle).toBe('roadmap');
  });

  it('ignores a stale response that resolves after a newer one', async () => {
    const executor = new DeferredExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });

    controller.setQuery('slow');
    await tick(15);
    controller.setQuery('fast');
    await tick(15);

    // Newest resolves first, then the stale one lands late.
    executor.pending[1]?.resolve(response('fast'));
    await tick(5);
    executor.pending[0]?.resolve(response('slow'));
    await tick(5);

    expect(controller.getState().result?.hits[0]?.plainTitle).toBe('fast');
    expect(controller.getState().activeQuery).toBe('fast');
  });

  it('survives an abort rejection without surfacing an error', async () => {
    const executor = new DeferredExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });
    controller.setQuery('abc');
    await tick(15);

    const abort = new Error('aborted');
    abort.name = 'AbortError';
    // Rejecting the first (now stale) request must not touch state.
    executor.pending[0]?.resolve(response('abc'));
    await tick(5);
    expect(controller.getState().error).toBeNull();
  });
});

describe('QuickFindController — error handling', () => {
  it('stores the failure instead of throwing', async () => {
    const failing: SearchExecutor = {
      indexUid: BLOCKS_INDEX_UID,
      async execute() {
        throw new Error('meilisearch down');
      },
    };
    const { controller, tick } = harness(failing, { debounceMs: 5 });
    controller.setQuery('road');
    await tick(20);

    expect(controller.getState().error?.message).toBe('meilisearch down');
    expect(controller.getState().result).toBeNull();
    expect(controller.getState().loading).toBe(false);
  });

  it('refresh() retries and clears the error', async () => {
    let failures = 1;
    const flaky: SearchExecutor = {
      indexUid: BLOCKS_INDEX_UID,
      async execute(query: string) {
        if (failures > 0) {
          failures -= 1;
          throw new Error('temporary');
        }
        return response(`Recovered ${query}`);
      },
    };
    const { controller, tick } = harness(flaky, { debounceMs: 5 });
    controller.setQuery('road');
    await tick(20);
    expect(controller.getState().error).not.toBeNull();

    controller.refresh();
    await tick(10);
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().result?.hits[0]?.plainTitle).toBe(
      'Recovered road',
    );
  });

  it('does not search without an ACL scope', async () => {
    const executor = new EchoExecutor();
    const controller = new QuickFindController({
      service: new QuickFindSearchService(executor),
      scope: null,
      debounceMs: 5,
    });
    controller.setQuery('secret');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(executor.queries).toEqual([]);
    expect(controller.getState().activeQuery).toBe('secret');
    expect(controller.getState().loading).toBe(false);
  });

  it('never searches when the scope grants nothing', async () => {
    const executor = new EchoExecutor();
    const states: QuickFindState[] = [];
    const controller = new QuickFindController({
      service: new QuickFindSearchService(executor),
      scope: { userId: USER_ID, spaceIds: [] },
      debounceMs: 5,
    });
    controller.subscribe((state) => states.push(state));
    controller.setQuery('secret');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(executor.queries).toEqual([]);
    expect(controller.getState().result?.denied).toBe(true);
  });
});

describe('QuickFindController — lifecycle', () => {
  it('notifies subscribers with immutable snapshots', async () => {
    const executor = new EchoExecutor();
    const { controller, states, tick } = harness(executor, { debounceMs: 5 });
    controller.setQuery('a');
    await tick(20);

    expect(states.length).toBeGreaterThan(1);
    expect(states[0]).not.toBe(states[1]);
    expect(Object.isFrozen(states[0])).toBe(false); // plain object, never mutated
    const snapshot = controller.getState();
    expect(snapshot.result?.hits).toHaveLength(1);
  });

  it('unsubscribes cleanly', () => {
    const listener = vi.fn();
    const controller = new QuickFindController({
      service: new QuickFindSearchService(new EchoExecutor()),
      scope,
    });
    const unsubscribe = controller.subscribe(listener);
    controller.setQuery('x');
    expect(listener).toHaveBeenCalled();
    const callsBefore = listener.mock.calls.length;
    unsubscribe();
    controller.setQuery('y');
    expect(listener.mock.calls.length).toBe(callsBefore);
  });

  it('dispose() stops timers and further work', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 10 });
    controller.setQuery('road');
    controller.dispose();
    await tick(30);
    expect(executor.queries).toEqual([]);
  });

  it('reconfigure() applies a narrower scope to the next query', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });
    controller.reconfigure({ scope: { userId: USER_ID, spaceIds: [] } });
    controller.setQuery('locked');
    await tick(20);
    expect(executor.queries).toEqual([]);
  });

  it('ignores non-string input from a sloppy caller', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });
    controller.setQuery(undefined as unknown as string);
    await tick(20);
    expect(controller.getState().query).toBe('');
    expect(executor.queries).toEqual(['']);
  });
});

describe('latency budget', () => {
  it('keeps the request small enough for a < 50 ms round trip', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });
    controller.setQuery('q4 roadmap');
    await tick(20);
    const result = controller.getState().result;
    expect(result?.hits).toHaveLength(1);
    // The request carries a crop + highlight projection (no full page bodies).
    expect(result?.totalHits).toBe(1);
  });

  it('starts loading synchronously so the spinner is instant', () => {
    const { controller } = harness(new EchoExecutor(), { debounceMs: 50 });
    controller.setQuery('r');
    expect(controller.getState().loading).toBe(true);
    expect(controller.getState().isRecentView).toBe(false);
  });

  it('exposes the parent-page id used for sub-tree filtering', () => {
    expect(PROJECTS_PAGE_ID).not.toBe(ROADMAP_PAGE_ID);
  });
});

describe('modal lifecycle ordering', () => {
  it('does not abort the recent-pages request when the modal opens', async () => {
    // The modal focuses on open; the hook fires `loadRecent`. If a reset ran
    // after that, the recent list would never arrive — this guards that order.
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor);
    controller.loadRecent();
    await tick(10);
    expect(executor.queries).toEqual(['']);
    expect(controller.getState().result?.hits[0]?.plainTitle).toBe(
      'Recent page',
    );
    expect(controller.getState().loading).toBe(false);
  });

  it('reloads the recent list after a reset', async () => {
    const executor = new EchoExecutor();
    const { controller, tick } = harness(executor, { debounceMs: 5 });
    controller.setQuery('roadmap');
    await tick(20);
    controller.reset();
    controller.loadRecent();
    await tick(10);
    expect(executor.queries).toEqual(['roadmap', '']);
    expect(controller.getState().isRecentView).toBe(true);
  });
});
