/**
 * Highlight parsing: Meilisearch's `<mark>`-wrapped strings -> segments.
 *
 * The modal renders segments (never raw HTML), so this parser is the only place
 * highlight markup is interpreted. It must be tolerant of unbalanced tags and
 * must never lose or reorder characters.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HIGHLIGHT_POST_TAG,
  DEFAULT_HIGHLIGHT_PRE_TAG,
  hasHighlight,
  parseHighlightedText,
  plainTextFromSegments,
  stripHighlightTags,
} from '../src/highlight.js';
import { extractMarks, renderComponent } from './support/render.js';
import { HighlightedText } from '../src/components/HighlightedText.js';

describe('parseHighlightedText', () => {
  it('splits a single match', () => {
    expect(parseHighlightedText('<mark>Q4</mark> Roadmap')).toEqual([
      { text: 'Q4', highlighted: true },
      { text: ' Roadmap', highlighted: false },
    ]);
  });

  it('handles multiple matches and merges adjacent runs', () => {
    expect(
      parseHighlightedText('<mark>Q4</mark> Road<mark>map</mark>'),
    ).toEqual([
      { text: 'Q4', highlighted: true },
      { text: ' Road', highlighted: false },
      { text: 'map', highlighted: true },
    ]);

    expect(parseHighlightedText('<mark>a</mark><mark>b</mark>')).toEqual([
      { text: 'ab', highlighted: true },
    ]);
  });

  it('handles a match at the very start and end', () => {
    expect(parseHighlightedText('<mark>start</mark>')).toEqual([
      { text: 'start', highlighted: true },
    ]);
    expect(parseHighlightedText('end <mark>match</mark>')).toEqual([
      { text: 'end ', highlighted: false },
      { text: 'match', highlighted: true },
    ]);
  });

  it('returns plain text when nothing matched', () => {
    expect(parseHighlightedText('no matches here')).toEqual([
      { text: 'no matches here', highlighted: false },
    ]);
  });

  it('tolerates an unclosed tag by highlighting the remainder', () => {
    expect(parseHighlightedText('abc <mark>def')).toEqual([
      { text: 'abc ', highlighted: false },
      { text: 'def', highlighted: true },
    ]);
  });

  it('drops a stray closing tag (never renders it literally)', () => {
    expect(parseHighlightedText('abc</mark> def')).toEqual([
      { text: 'abc def', highlighted: false },
    ]);
  });

  it('handles empty and nullish input', () => {
    expect(parseHighlightedText('')).toEqual([]);
    expect(parseHighlightedText(undefined)).toEqual([]);
    expect(parseHighlightedText(null)).toEqual([]);
  });

  it('supports custom tags', () => {
    expect(parseHighlightedText('a [[b]] c', '[[', ']]')).toEqual([
      { text: 'a ', highlighted: false },
      { text: 'b', highlighted: true },
      { text: ' c', highlighted: false },
    ]);
    // Empty tags degrade to a single plain segment instead of an infinite loop.
    expect(parseHighlightedText('abc', '', '')).toEqual([
      { text: 'abc', highlighted: false },
    ]);
  });

  it('is lossless: segment text always equals the input without tags', () => {
    const samples = [
      '<mark>Q4</mark> Financial <mark>Roadmap</mark>',
      'no markup',
      '<mark>unclosed',
      '</mark>stray',
      '<mark></mark>empty',
      '<mark>a</mark> and <mark>b</mark> and <mark>c</mark>',
    ];
    for (const sample of samples) {
      expect(plainTextFromSegments(parseHighlightedText(sample))).toBe(
        stripHighlightTags(sample),
      );
      expect(stripHighlightTags(sample)).toBe(
        sample
          .split(DEFAULT_HIGHLIGHT_PRE_TAG)
          .join('')
          .split(DEFAULT_HIGHLIGHT_POST_TAG)
          .join(''),
      );
    }
  });

  it('never interprets nested tags as HTML', () => {
    expect(parseHighlightedText('<mark><b>x</b></mark>')).toEqual([
      { text: '<b>x</b>', highlighted: true },
    ]);
  });
});

describe('hasHighlight', () => {
  it('reports whether any run matched', () => {
    expect(hasHighlight(parseHighlightedText('<mark>a</mark>'))).toBe(true);
    expect(hasHighlight(parseHighlightedText('a'))).toBe(false);
    expect(hasHighlight([])).toBe(false);
  });
});

describe('HighlightedText rendering', () => {
  it('emits one <mark> per matched run', () => {
    const markup = renderComponent(HighlightedText, {
      segments: parseHighlightedText(
        '<mark>Q4</mark> Financial <mark>Roadmap</mark>',
      ),
    });
    expect(extractMarks(markup)).toEqual(['Q4', 'Roadmap']);
    // Everything else stays plain text.
    expect(markup).toContain(' Financial ');
  });

  it('renders nothing for an empty segment list without a fallback', () => {
    expect(renderComponent(HighlightedText, { segments: [] })).toBe('');
  });
});
