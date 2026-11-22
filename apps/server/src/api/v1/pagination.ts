/**
 * Notion-compatible cursor pagination.
 *
 * Cursors are opaque base64url-encoded offsets. Notion SDKs treat them as
 * opaque strings, so the encoding is an implementation detail.
 */

/** Default page size when the client omits `page_size`. */
export const DEFAULT_PAGE_SIZE = 100;

/** Maximum accepted `page_size`. */
export const MAX_PAGE_SIZE = 100;

const CURSOR_PREFIX = 'v1:';

/** Encodes an offset into an opaque cursor. */
export function encodeCursor(offset: number): string {
  return Buffer.from(`${CURSOR_PREFIX}${offset}`, 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor into an offset.
 * Returns `null` when the cursor is malformed (routes answer `400`).
 */
export function decodeCursor(cursor: string | undefined): number | null {
  if (!cursor) {
    return 0;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!decoded.startsWith(CURSOR_PREFIX)) {
      return null;
    }
    const offset = Number.parseInt(decoded.slice(CURSOR_PREFIX.length), 10);
    return Number.isFinite(offset) && offset >= 0 ? offset : null;
  } catch {
    return null;
  }
}

/** Clamps a requested page size to Notion's 1..100 window. */
export function normalizePageSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

/** A Notion list response envelope. */
export interface NotionListResponse<T> {
  object: 'list';
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
  type: string;
  [key: string]: unknown;
}

/** Paginates an in-memory result set and builds the list envelope. */
export function paginate<T>(
  items: T[],
  offset: number,
  pageSize: number,
  type: string,
): NotionListResponse<T> {
  const start = Math.min(Math.max(0, offset), items.length);
  const results = items.slice(start, start + pageSize);
  const nextOffset = start + results.length;
  const hasMore = nextOffset < items.length;
  return {
    object: 'list',
    results,
    next_cursor: hasMore ? encodeCursor(nextOffset) : null,
    has_more: hasMore,
    type,
    [type]: {},
  };
}
