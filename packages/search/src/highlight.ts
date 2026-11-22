/**
 * Highlight helpers.
 *
 * Meilisearch returns pre-highlighted strings (by default wrapped in `<mark>`
 * tags) rather than structured match positions. The modal must render those
 * matches as React nodes — never as raw HTML — so the strings are parsed into
 * {@link HighlightSegment} runs that can be mapped to `<mark>` elements.
 */

import type { HighlightSegment } from './types.js';

/** Default tags requested from Meilisearch (and understood by the parser). */
export const DEFAULT_HIGHLIGHT_PRE_TAG = '<mark>';
export const DEFAULT_HIGHLIGHT_POST_TAG = '</mark>';

/**
 * Splits a Meilisearch-highlighted string into plain / highlighted segments.
 *
 * Unbalanced tags are tolerated: a trailing `<mark>` without a closing tag
 * highlights the remainder instead of being dropped or rendered literally.
 *
 * @example
 * ```ts
 * parseHighlightedText('<mark>Q4</mark> Roadmap');
 * // [{ text: 'Q4', highlighted: true }, { text: ' Roadmap', highlighted: false }]
 * ```
 */
export function parseHighlightedText(
  input: string | null | undefined,
  preTag: string = DEFAULT_HIGHLIGHT_PRE_TAG,
  postTag: string = DEFAULT_HIGHLIGHT_POST_TAG,
): HighlightSegment[] {
  if (!input) {
    return [];
  }
  if (preTag.length === 0 || postTag.length === 0) {
    return [{ text: input, highlighted: false }];
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;

  const push = (text: string, highlighted: boolean): void => {
    if (text.length === 0) {
      return;
    }
    const previous = segments[segments.length - 1];
    if (previous && previous.highlighted === highlighted) {
      previous.text += text;
      return;
    }
    segments.push({ text, highlighted });
  };

  while (cursor < input.length) {
    const openIndex = input.indexOf(preTag, cursor);
    if (openIndex === -1) {
      push(input.slice(cursor).split(postTag).join(''), false);
      break;
    }
    // A stray closing tag (no matching opener) is literal text to Meilisearch
    // but must never reach the DOM: it is dropped from the plain run.
    push(input.slice(cursor, openIndex).split(postTag).join(''), false);
    const contentStart = openIndex + preTag.length;
    const closeIndex = input.indexOf(postTag, contentStart);
    if (closeIndex === -1) {
      push(input.slice(contentStart), true);
      break;
    }
    push(input.slice(contentStart, closeIndex), true);
    cursor = closeIndex + postTag.length;
  }

  return segments;
}

/** Rebuilds the plain text of a highlighted string (tags removed). */
export function plainTextFromSegments(
  segments: readonly HighlightSegment[],
): string {
  return segments.map((segment) => segment.text).join('');
}

/** Convenience wrapper: strips highlight markup from a Meilisearch string. */
export function stripHighlightTags(
  input: string | null | undefined,
  preTag: string = DEFAULT_HIGHLIGHT_PRE_TAG,
  postTag: string = DEFAULT_HIGHLIGHT_POST_TAG,
): string {
  return plainTextFromSegments(parseHighlightedText(input, preTag, postTag));
}

/** Returns `true` when at least one segment was matched by the query. */
export function hasHighlight(segments: readonly HighlightSegment[]): boolean {
  return segments.some((segment) => segment.highlighted);
}
