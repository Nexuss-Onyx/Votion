import { describe, expect, it } from 'vitest';
import { MultiBlockSelection, lassoRect, rectsIntersect } from '../src/dnd/MultiBlockSelection.js';

describe('MultiBlockSelection', () => {
  it('selects a single block, replacing the selection', () => {
    const selection = new MultiBlockSelection();
    selection.select('a');
    selection.select('b');
    expect(selection.ids).toEqual(['b']);
    expect(selection.size).toBe(1);
  });

  it('adds to the selection when multi is true', () => {
    const selection = new MultiBlockSelection();
    selection.select('a');
    selection.select('b', true);
    selection.select('c', true);
    expect(selection.ids).toEqual(['a', 'b', 'c']);
  });

  it('toggles blocks in and out', () => {
    const selection = new MultiBlockSelection();
    selection.toggle('a');
    selection.toggle('b');
    selection.toggle('a');
    expect(selection.ids).toEqual(['b']);
  });

  it('range selects between anchor and target', () => {
    const selection = new MultiBlockSelection();
    selection.select('a');
    selection.rangeSelect('d', ['a', 'b', 'c', 'd', 'e']);
    expect(selection.ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clears and replaces the selection', () => {
    const selection = new MultiBlockSelection();
    selection.select('a');
    selection.select('b', true);
    selection.clear();
    expect(selection.size).toBe(0);
    selection.replace(['x', 'y']);
    expect(selection.ids).toEqual(['x', 'y']);
  });

  it('lassoRect normalizes start and current points', () => {
    expect(lassoRect({ x: 100, y: 100 }, { x: 50, y: 80 })).toEqual({
      left: 50,
      top: 80,
      right: 100,
      bottom: 100,
    });
  });

  it('rectsIntersect detects overlapping rectangles', () => {
    expect(rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true);
    expect(rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(true);
    expect(rectsIntersect({ left: 0, top: 0, right: 10, bottom: 10 }, { left: 20, top: 20, right: 30, bottom: 30 })).toBe(false);
  });
});
