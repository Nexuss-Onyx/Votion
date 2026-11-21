/**
 * Canonical Rich Text annotation model.
 *
 * Votion stores formatted strings as a compact array of segments:
 *
 * ```ts
 * type RichText = Array<[text: string, modifiers?: TextModifier[]]>;
 * ```
 *
 * Modifier tuples are intentionally terse (matching the Notion wire format):
 * `b` bold, `i` italic, `s` strikethrough, `_` underline, `c` inline code,
 * `h` color/highlight, `a` hyperlink, `e` inline equation,
 * `u` user mention, `p` page mention, `d` date mention.
 */

import type { ISODateString, UUID } from './common.js';

/** Foreground text colors supported by the editor palette. */
export type TextColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

/** Background (highlight) colors, suffixed with `_background`. */
export type BackgroundColor =
  | 'gray_background'
  | 'brown_background'
  | 'orange_background'
  | 'yellow_background'
  | 'green_background'
  | 'blue_background'
  | 'purple_background'
  | 'pink_background'
  | 'red_background';

/** Any color token accepted by the `['h', color]` modifier. */
export type HighlightColor = TextColor | BackgroundColor;

/** Payload of a `['d', DateMetadata]` mention. */
export interface DateMetadata {
  type: 'date';
  /** Inclusive ISO-8601 start date (`2026-11-21`) or date-time. */
  start_date: ISODateString;
  /** Exclusive/optional ISO-8601 end date for ranges. */
  end_date?: ISODateString;
  /** IANA time zone used to render the date (e.g. `Africa/Addis_Ababa`). */
  time_zone?: string;
  /** Whether the time-of-day component is rendered. */
  include_time?: boolean;
}

/** Bold text. */
export type BoldModifier = ['b'];
/** Italic text. */
export type ItalicModifier = ['i'];
/** Strikethrough text. */
export type StrikethroughModifier = ['s'];
/** Underlined text. */
export type UnderlineModifier = ['_'];
/** Inline code span. */
export type CodeModifier = ['c'];
/** Text / highlight color. */
export type ColorModifier = ['h', HighlightColor];
/** Hyperlink to an external URL. */
export type LinkModifier = ['a', string];
/** Inline KaTeX equation. */
export type EquationModifier = ['e', string];
/** Inline `@user` mention. */
export type UserMentionModifier = ['u', UUID];
/** Inline `@page` mention. */
export type PageMentionModifier = ['p', UUID];
/** Inline date mention. */
export type DateMentionModifier = ['d', DateMetadata];

/** Every inline annotation accepted by a rich text segment. */
export type TextModifier =
  | BoldModifier
  | ItalicModifier
  | StrikethroughModifier
  | UnderlineModifier
  | CodeModifier
  | ColorModifier
  | LinkModifier
  | EquationModifier
  | UserMentionModifier
  | PageMentionModifier
  | DateMentionModifier;

/** Single `[text, modifiers?]` tuple inside a rich text array. */
export type RichTextSegment = [content: string, modifiers?: TextModifier[]];

/** A full rich text value (array of segments). */
export type RichText = RichTextSegment[];

/** Tags of all supported modifier tuples. */
export type TextModifierTag = TextModifier[0];

const MODIFIER_TAGS: ReadonlySet<string> = new Set<TextModifierTag>([
  'b',
  'i',
  's',
  '_',
  'c',
  'h',
  'a',
  'e',
  'u',
  'p',
  'd',
]);

/** Creates an empty rich text value. */
export function emptyRichText(): RichText {
  return [];
}

/** Narrows an unknown value to a {@link TextModifier} tuple. */
export function isTextModifier(value: unknown): value is TextModifier {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    return false;
  }
  const [tag, argument] = value as unknown[];
  if (typeof tag !== 'string' || !MODIFIER_TAGS.has(tag)) {
    return false;
  }
  if (argument === undefined) {
    return true;
  }
  if (tag === 'd') {
    return (
      typeof argument === 'object' &&
      argument !== null &&
      (argument as { type?: unknown }).type === 'date' &&
      typeof (argument as { start_date?: unknown }).start_date === 'string'
    );
  }
  return typeof argument === 'string';
}

/** Narrows an unknown value to a {@link RichTextSegment} tuple. */
export function isRichTextSegment(value: unknown): value is RichTextSegment {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    return false;
  }
  const [content, modifiers] = value as unknown[];
  if (typeof content !== 'string') {
    return false;
  }
  if (modifiers === undefined) {
    return true;
  }
  return Array.isArray(modifiers) && modifiers.every(isTextModifier);
}

/** Narrows an unknown value to a {@link RichText} array. */
export function isRichText(value: unknown): value is RichText {
  return Array.isArray(value) && value.every(isRichTextSegment);
}

/** Builds a rich text value from plain text (single unstyled segment). */
export function plainTextToRichText(text: string): RichText {
  return text.length === 0 ? [] : [[text]];
}

/**
 * Flattens rich text into its plain-text projection. Mentions and equations are
 * rendered to a stable textual representation so search/index pipelines can use
 * the same helper.
 */
export function richTextToPlainText(richText: RichText | undefined): string {
  if (!richText) {
    return '';
  }
  let result = '';
  for (const segment of richText) {
    const content = segment[0] ?? '';
    const modifiers = segment[1];
    if (!modifiers || modifiers.length === 0) {
      result += content;
      continue;
    }
    const dateMention = modifiers.find(
      (modifier): modifier is DateMentionModifier => modifier[0] === 'd',
    );
    if (dateMention) {
      const { start_date, end_date } = dateMention[1];
      result += end_date ? `${start_date} → ${end_date}` : start_date;
      continue;
    }
    result += content;
  }
  return result;
}

/** Returns the first {@link LinkModifier} found in a segment, if any. */
export function getSegmentLink(
  segment: RichTextSegment,
): LinkModifier | undefined {
  return segment[1]?.find(
    (modifier): modifier is LinkModifier => modifier[0] === 'a',
  );
}

/** Returns `true` when the segment carries the given {@link TextModifierTag}. */
export function hasModifier(
  segment: RichTextSegment,
  tag: TextModifierTag,
): boolean {
  return segment[1]?.some((modifier) => modifier[0] === tag) ?? false;
}

/** Wraps plain text in a segment carrying the supplied modifiers. */
export function createRichTextSegment(
  content: string,
  ...modifiers: TextModifier[]
): RichTextSegment {
  return modifiers.length === 0 ? [content] : [content, modifiers];
}
