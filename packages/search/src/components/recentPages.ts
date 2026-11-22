/**
 * Recent pages history (client-side cache).
 *
 * The empty state of the Quick Find modal shows the pages the user visited
 * last. That list must feel instant, so it is kept in `localStorage` rather than
 * round-tripping to Meilisearch — but it is still re-validated against the
 * index on open (see `QuickFindModal`), because a page can be un-shared or
 * deleted between visits.
 */

import type { UUID } from '@votion/types';

/** One entry of the recent-pages list. */
export interface RecentPage {
  id: UUID;
  title: string;
  /** Workspace, used to scope the history to the active board. */
  spaceId: UUID;
  /** Root page (`id` for a page itself), used for the breadcrumb. */
  rootPageId?: UUID;
  breadcrumb?: string;
  icon?: string;
  /** When the page was last opened by this user (epoch ms). */
  visitedAt: number;
}

/** Default cap; Notion shows 5–10 in the empty state. */
export const RECENT_PAGES_LIMIT = 10;

/** Storage key (versioned so a schema change can be discarded safely). */
export const RECENT_PAGES_STORAGE_KEY = 'votion.quickfind.recent.v1';

/** Minimal storage contract (`localStorage` in the browser, a map in tests). */
export interface RecentPagesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecentPage(value: unknown): value is RecentPage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Partial<RecentPage>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.title === 'string' &&
    typeof entry.spaceId === 'string' &&
    typeof entry.visitedAt === 'number' &&
    Number.isFinite(entry.visitedAt)
  );
}

/**
 * In-memory recent-pages store with optional `localStorage` persistence.
 *
 * Deduplicates by id, sorts newest-first and caps the list. Corrupt payloads
 * (older schema, manual tampering) are discarded instead of throwing.
 */
export class RecentPagesStore {
  private readonly storage: RecentPagesStorage | null;
  private readonly limit: number;
  private entries: RecentPage[];

  constructor(
    storage: RecentPagesStorage | null = defaultStorage(),
    limit: number = RECENT_PAGES_LIMIT,
  ) {
    this.storage = storage;
    this.limit = Math.max(1, limit);
    this.entries = this.read();
  }

  /** All entries, newest first. */
  list(spaceId?: UUID): RecentPage[] {
    if (spaceId === undefined) {
      return [...this.entries];
    }
    return this.entries.filter((entry) => entry.spaceId === spaceId);
  }

  /** Records a visit (moves an existing entry to the top). */
  record(
    page: Omit<RecentPage, 'visitedAt'> & { visitedAt?: number },
  ): RecentPage[] {
    if (typeof page.id !== 'string' || page.id.length === 0) {
      return this.list();
    }
    const entry: RecentPage = {
      id: page.id,
      title: page.title,
      spaceId: page.spaceId,
      visitedAt: page.visitedAt ?? Date.now(),
      ...(page.rootPageId !== undefined ? { rootPageId: page.rootPageId } : {}),
      ...(page.breadcrumb !== undefined ? { breadcrumb: page.breadcrumb } : {}),
      ...(page.icon !== undefined ? { icon: page.icon } : {}),
    };
    this.entries = [
      entry,
      ...this.entries.filter((existing) => existing.id !== entry.id),
    ]
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, this.limit);
    this.write();
    return this.list();
  }

  /** Removes a single entry (page deleted or un-shared). */
  forget(id: UUID): RecentPage[] {
    this.entries = this.entries.filter((entry) => entry.id !== id);
    this.write();
    return this.list();
  }

  /** Drops entries that no longer exist in the index. */
  retain(ids: Iterable<UUID>): RecentPage[] {
    const keep = new Set(ids);
    this.entries = this.entries.filter((entry) => keep.has(entry.id));
    this.write();
    return this.list();
  }

  /** Clears the history. */
  clear(): void {
    this.entries = [];
    this.write();
  }

  private read(): RecentPage[] {
    if (!this.storage) {
      return [];
    }
    try {
      const raw = this.storage.getItem(RECENT_PAGES_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(isRecentPage)
        .sort((a, b) => b.visitedAt - a.visitedAt)
        .slice(0, this.limit);
    } catch {
      return [];
    }
  }

  private write(): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.setItem(
        RECENT_PAGES_STORAGE_KEY,
        JSON.stringify(this.entries),
      );
    } catch {
      // Quota exceeded / private mode: history is best-effort.
    }
  }
}

/** Returns `localStorage` when available, else `null` (SSR, private mode). */
export function defaultStorage(): RecentPagesStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: RecentPagesStorage })
      .localStorage;
    if (!candidate) {
      return null;
    }
    // Probe: Safari private mode throws on setItem.
    const probe = '__votion_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return null;
  }
}

/** Merges server results with the local history for the empty state. */
export function mergeRecentWithHits(
  recent: readonly RecentPage[],
  hits: readonly { id: string; plainTitle: string; breadcrumb?: string }[],
  limit: number = RECENT_PAGES_LIMIT,
): RecentPage[] {
  const byId = new Map<string, RecentPage>();
  for (const hit of hits) {
    byId.set(hit.id, {
      id: hit.id,
      title: hit.plainTitle,
      spaceId: '',
      visitedAt: 0,
      ...(hit.breadcrumb !== undefined ? { breadcrumb: hit.breadcrumb } : {}),
    });
  }
  const merged: RecentPage[] = [];
  for (const entry of recent) {
    merged.push(byId.get(entry.id) ?? entry);
    byId.delete(entry.id);
  }
  // Server-only entries (visited on another device) come last, newest first.
  for (const entry of byId.values()) {
    merged.push(entry);
  }
  return merged.slice(0, Math.max(1, limit));
}
