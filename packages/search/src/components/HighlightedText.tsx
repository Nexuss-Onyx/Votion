/**
 * Renders Meilisearch highlight segments as React nodes.
 *
 * Matched runs become `<mark>` elements; the rest is plain text. Because the
 * input is a segment array (never an HTML string), a page titled
 * `<img src=x onerror=alert(1)>` is rendered as literal text, not markup.
 */

import {
  createElement,
  Fragment,
  type CSSProperties,
  type ReactElement,
} from 'react';

import type { HighlightSegment } from '../types.js';

export interface HighlightedTextProps {
  /** Segments produced by `parseHighlightedText`. */
  segments: readonly HighlightSegment[];
  /** Mark styling (defaults to a translucent yellow background). */
  markStyle?: CSSProperties;
  /** Extra class applied to every `<mark>`. */
  markClassName?: string;
  /** Rendered when there are no segments. */
  fallback?: string;
}

/** Default highlight styling: readable on both light and dark surfaces. */
export const DEFAULT_MARK_STYLE: CSSProperties = {
  background: 'rgba(255, 212, 0, 0.35)',
  color: 'inherit',
  padding: '0 1px',
  borderRadius: 3,
  fontWeight: 600,
};

export function HighlightedText({
  segments,
  markStyle,
  markClassName,
  fallback,
}: HighlightedTextProps): ReactElement {
  if (segments.length === 0) {
    return createElement(Fragment, null, fallback ?? '');
  }
  return createElement(
    Fragment,
    null,
    ...segments.map((segment, index) =>
      segment.highlighted
        ? createElement(
            'mark',
            {
              key: `mark-${index}`,
              style: { ...DEFAULT_MARK_STYLE, ...markStyle },
              ...(markClassName ? { className: markClassName } : {}),
              'data-votion-highlight': 'true',
            },
            segment.text,
          )
        : createElement(Fragment, { key: `text-${index}` }, segment.text),
    ),
  );
}
