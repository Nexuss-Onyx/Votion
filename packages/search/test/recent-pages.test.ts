/**
 * Recent-pages history: capping, dedupe, persistence and corruption tolerance.
 */

import { describe, expect, it } from 'vitest';

import {
  RECENT_PAGES_LIMIT,
  RECENT_PAGES_STORAGE_KEY,
  RecentPagesStore,
  mergeRecentWithHits,
  type RecentPage,
} from '../src/components/recentPages.js';
import { MemoryStorage } from './support/render.js';
import { SPACE_ID } from './fixtures/blocks.js';

const OTHER_SPACE_ID = '88888888-8888-4888-8888-888888888888';

function page(
  id: string,
  title: string,
  visitedAt: number,
  spaceId = SPACE_ID,
): RecentPage {
  return { id, title, spaceId, visitedAt };
}

describe('RecentPagesStore', () => {
  it('starts empty and caps the list', () => {
    const store = new RecentPagesStore(new MemoryStorage(), 3);
    expect(store.list()).toEqual([]);

    store.record({ id: 'a', title: 'A', spaceId: SPACE_ID, visitedAt: 1 });
    store.record({ id: 'b', title: 'B', spaceId: SPACE_ID, visitedAt: 2 });
    store.record({ id: 'c', title: 'C', spaceId: SPACE_ID, visitedAt: 3 });
    store.record({ id: 'd', title: 'D', spaceId: SPACE_ID, visitedAt: 4 });

    expect(store.list().map((entry) => entry.id)).toEqual(['d', 'c', 'b']);
  });

  it('moves a re-visited page to the top instead of duplicating it', () => {
    const store = new RecentPagesStore(new MemoryStorage(), 10);
    store.record({ id: 'a', title: 'A', spaceId: SPACE_ID, visitedAt: 1 });
    store.record({ id: 'b', title: 'B', spaceId: SPACE_ID, visitedAt: 2 });
    store.record({
      id: 'a',
      title: 'A (renamed)',
      spaceId: SPACE_ID,
      visitedAt: 3,
    });

    expect(store.list()).toHaveLength(2);
    expect(store.list()[0]).toMatchObject({ id: 'a', title: 'A (renamed)' });
  });

  it('defaults visitedAt to now and ignores unusable ids', () => {
    const store = new RecentPagesStore(new MemoryStorage());
    const before = Date.now();
    store.record({ id: 'a', title: 'A', spaceId: SPACE_ID });
    expect(store.list()[0]?.visitedAt).toBeGreaterThanOrEqual(before);

    store.record({ id: '', title: 'Bad', spaceId: SPACE_ID });
    expect(store.list()).toHaveLength(1);
  });

  it('filters by workspace', () => {
    const store = new RecentPagesStore(new MemoryStorage());
    store.record({ id: 'a', title: 'A', spaceId: SPACE_ID, visitedAt: 2 });
    store.record({
      id: 'b',
      title: 'B',
      spaceId: OTHER_SPACE_ID,
      visitedAt: 1,
    });
    expect(store.list(SPACE_ID).map((entry) => entry.id)).toEqual(['a']);
  });

  it('forget() and clear() prune entries', () => {
    const store = new RecentPagesStore(new MemoryStorage());
    store.record({ id: 'a', title: 'A', spaceId: SPACE_ID });
    store.record({ id: 'b', title: 'B', spaceId: SPACE_ID });
    expect(store.forget('a').map((entry) => entry.id)).toEqual(['b']);
    store.clear();
    expect(store.list()).toEqual([]);
  });

  it('retain() drops pages that no longer exist', () => {
    const store = new RecentPagesStore(new MemoryStorage());
    store.record({ id: 'a', title: 'A', spaceId: SPACE_ID });
    store.record({ id: 'b', title: 'B', spaceId: SPACE_ID });
    expect(store.retain(['a']).map((entry) => entry.id)).toEqual(['a']);
  });

  it('persists and reloads across instances', () => {
    const storage = new MemoryStorage();
    const first = new RecentPagesStore(storage, 5);
    first.record({ id: 'a', title: 'A', spaceId: SPACE_ID, visitedAt: 10 });

    const second = new RecentPagesStore(storage, 5);
    expect(second.list()).toEqual([page('a', 'A', 10)]);
  });

  it('discards corrupt or foreign payloads instead of throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(RECENT_PAGES_STORAGE_KEY, '{not json');
    expect(new RecentPagesStore(storage).list()).toEqual([]);

    storage.setItem(RECENT_PAGES_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(new RecentPagesStore(storage).list()).toEqual([]);

    storage.setItem(
      RECENT_PAGES_STORAGE_KEY,
      JSON.stringify([
        { id: 1 },
        null,
        { id: 'ok', title: 'Ok', spaceId: SPACE_ID, visitedAt: 3 },
      ]),
    );
    expect(new RecentPagesStore(storage).list()).toEqual([page('ok', 'Ok', 3)]);
  });

  it('survives a storage backend that throws (private mode / quota)', () => {
    const throwing = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    const store = new RecentPagesStore(throwing);
    expect(store.list()).toEqual([]);
    expect(() =>
      store.record({ id: 'a', title: 'A', spaceId: SPACE_ID }),
    ).not.toThrow();
    expect(store.list()).toHaveLength(1);
  });

  it('works without any storage (SSR)', () => {
    const store = new RecentPagesStore(null);
    store.record({ id: 'a', title: 'A', spaceId: SPACE_ID });
    expect(store.list()).toHaveLength(1);
  });

  it('uses a versioned key', () => {
    expect(RECENT_PAGES_STORAGE_KEY).toMatch(/votion\.quickfind\.recent\.v\d+/);
    expect(RECENT_PAGES_LIMIT).toBeGreaterThanOrEqual(5);
  });
});

describe('mergeRecentWithHits', () => {
  it('prefers fresh titles from the search index, keeping visit order', () => {
    const merged = mergeRecentWithHits(
      [page('a', 'Stale A', 3), page('b', 'B', 2)],
      [
        { id: 'a', plainTitle: 'Fresh A' },
        { id: 'c', plainTitle: 'C' },
      ],
      5,
    );
    expect(merged.map((entry) => `${entry.id}:${entry.title}`)).toEqual([
      'a:Fresh A',
      'b:B',
      'c:C',
    ]);
  });

  it('caps the merged list', () => {
    const merged = mergeRecentWithHits(
      [page('a', 'A', 2), page('b', 'B', 1)],
      [{ id: 'c', plainTitle: 'C' }],
      2,
    );
    expect(merged).toHaveLength(2);
  });

  it('carries the breadcrumb from the index hit', () => {
    const merged = mergeRecentWithHits(
      [],
      [{ id: 'a', plainTitle: 'A', breadcrumb: 'Projects / Q4' }],
    );
    expect(merged[0]?.breadcrumb).toBe('Projects / Q4');
  });
});
