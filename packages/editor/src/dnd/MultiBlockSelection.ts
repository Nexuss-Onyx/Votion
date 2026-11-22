/**
 * Multi-block selection logic for the canvas.
 *
 * Supports shift-click range selection and mouse-drag lasso selection, plus
 * bulk actions: indent / outdent / bulk delete.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Computes the bounding rectangle of a lasso drag from start to current. */
export function lassoRect(start: Point, current: Point): Rect {
  return {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    right: Math.max(start.x, current.x),
    bottom: Math.max(start.y, current.y),
  };
}

export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

/** True when two rectangles intersect (touching edges count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.left <= b.right &&
    a.right >= b.left &&
    a.top <= b.bottom &&
    a.bottom >= b.top
  );
}

/**
 * Tracker for the currently selected block ids. All selection mutations go
 * through here so the canvas can derive bulk actions from a single source.
 */
export class MultiBlockSelection {
  private selected = new Set<string>();
  private lastSelectedId: string | null = null;

  get ids(): string[] {
    return [...this.selected];
  }

  get size(): number {
    return this.selected.size;
  }

  has(id: string): boolean {
    return this.selected.has(id);
  }

  /** Select a single block, replacing the selection unless `multi` is true. */
  select(id: string, multi = false): void {
    if (multi && this.selected.has(id)) {
      this.selected.delete(id);
    } else if (multi) {
      this.selected.add(id);
    } else {
      this.selected.clear();
      this.selected.add(id);
    }
    this.lastSelectedId = id;
  }

  /** Toggle a block in the selection. */
  toggle(id: string): void {
    if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this.lastSelectedId = id;
  }

  /** Range-select from `lastSelectedId` to `id` (shift-click semantics). */
  rangeSelect(id: string, allIds: string[]): void {
    this.selected.clear();
    const index = allIds.indexOf(id);
    const anchor = this.lastSelectedId ? allIds.indexOf(this.lastSelectedId) : -1;
    if (index === -1) {
      this.selected.add(id);
    } else if (anchor === -1) {
      this.selected.add(id);
    } else {
      const from = Math.min(index, anchor);
      const to = Math.max(index, anchor);
      for (let i = from; i <= to; i++) {
        const candidate = allIds[i];
        if (candidate) this.selected.add(candidate);
      }
    }
    this.lastSelectedId = id;
  }

  clear(): void {
    this.selected.clear();
    this.lastSelectedId = null;
  }

  replace(ids: string[]): void {
    this.selected = new Set(ids);
    this.lastSelectedId = ids[ids.length - 1] ?? null;
  }
}
