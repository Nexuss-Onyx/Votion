import { describe, expect, it } from 'vitest';
import { parseMarkdownLine, MARKDOWN_TRIGS } from '../src/shortcuts/MarkdownShortcuts.js';

describe('MarkdownShortcuts', () => {
  it('converts `# ` into a heading 1', () => {
    const conversion = parseMarkdownLine('# Hello world');
    expect(conversion).toEqual({ type: 'heading_1', text: 'Hello world' });
  });

  it('converts `## ` into a heading 2', () => {
    expect(parseMarkdownLine('## Hello world')).toEqual({
      type: 'heading_2',
      text: 'Hello world',
    });
  });

  it('converts `### ` into a heading 3', () => {
    expect(parseMarkdownLine('### Hello world')).toEqual({
      type: 'heading_3',
      text: 'Hello world',
    });
  });

  it('converts `[] ` into a to-do', () => {
    expect(parseMarkdownLine('[] Buy milk')).toEqual({
      type: 'to_do',
      text: 'Buy milk',
    });
  });

  it('converts `- ` into a bulleted list item', () => {
    expect(parseMarkdownLine('- First item')).toEqual({
      type: 'bulleted_list_item',
      text: 'First item',
    });
  });

  it('converts `* ` into a bulleted list item', () => {
    expect(parseMarkdownLine('* First item')).toEqual({
      type: 'bulleted_list_item',
      text: 'First item',
    });
  });

  it('converts `1. ` into a numbered list item', () => {
    expect(parseMarkdownLine('1. First item')).toEqual({
      type: 'numbered_list_item',
      text: 'First item',
    });
  });

  it('converts `> ` into a quote', () => {
    expect(parseMarkdownLine('> A wise quote')).toEqual({
      type: 'quote',
      text: 'A wise quote',
    });
  });

  it('converts `---` into a divider with no text', () => {
    expect(parseMarkdownLine('---')).toEqual({
      type: 'divider',
      text: '',
    });
  });

  it('converts ` ``` ` into a code block with no text', () => {
    expect(parseMarkdownLine('```')).toEqual({
      type: 'code',
      text: '',
    });
  });

  it('returns null for plain text', () => {
    expect(parseMarkdownLine('Just a plain line')).toBeNull();
    expect(parseMarkdownLine('#')).toBeNull();
    expect(parseMarkdownLine('[]')).toBeNull();
  });

  it('covers every trigger with a unique block type', () => {
    const types = MARKDOWN_TRIGS.map((trig) => trig.type);
    expect([...new Set(types)].length).toBe(types.length);
  });
});
