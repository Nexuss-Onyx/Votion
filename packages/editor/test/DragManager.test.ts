import { describe, expect, it } from 'vitest';
import { getDropZone, computeDropIndex, dropZoneToOperation } from '../src/dnd/DragManager.js';

describe('DragManager', () => {
  const rect = { left: 100, top: 100, width: 200, height: 40 };

  it('classifies a pointer above the block as above', () => {
    expect(getDropZone(rect, 200, 105)).toBe('above');
    expect(getDropZone(rect, 200, 111)).toBe('above');
  });

  it('classifies a pointer below the block as below', () => {
    expect(getDropZone(rect, 200, 135)).toBe('below');
  });

  it('classifies left and right pointers as column zones', () => {
    expect(getDropZone(rect, 105, 120)).toBe('left');
    expect(getDropZone(rect, 295, 120)).toBe('right');
  });

  it('computes insertion indexes for above and below zones', () => {
    const content = ['a', 'b', 'c'];
    expect(computeDropIndex(content, 'b', 'above')).toBe(1);
    expect(computeDropIndex(content, 'b', 'below')).toBe(2);
  });

  it('returns the end index for a missing target', () => {
    expect(computeDropIndex(['a', 'b'], 'missing', 'above')).toBe(2);
  });

  it('maps zones to list operations', () => {
    const content = ['a', 'b', 'c'];
    expect(dropZoneToOperation(content, 'b', 'above', 'x')).toEqual({
      zone: 'above',
      index: 1,
      operation: 'listBefore',
      anchorId: 'b',
    });
    expect(dropZoneToOperation(content, 'b', 'below', 'x')).toEqual({
      zone: 'below',
      index: 2,
      operation: 'listAfter',
      anchorId: 'c',
    });
    expect(dropZoneToOperation(content, 'b', 'left', 'x').operation).toBe('set');
  });
});
