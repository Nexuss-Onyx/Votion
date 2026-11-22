/**
 * Document transformation: `Block` -> `SearchDocument`.
 *
 * Meilisearch has no idea what a rich-text tuple is. Sending
 * `[["Roadmap", [["b"]]], [" 2026", [["a", "https://…"]]]]` verbatim would
 * index the punctuation, the modifier tags (`b`, `i`, `h`, `a`) and every UUID
 * from user/page mentions — producing noisy matches and huge payloads.
 *
 * This module flattens a block into clean, human-readable tokens:
 *
 * | Input                                            | Output                     |
 * | :----------------------------------------------- | :------------------------- |
 * | `[["Road", [["b"]]], ["map", [["i"]]]]`           | `Roadmap` (no split)       |
 * | `[["see ", []], ["docs", [["a", "http://x"]]]]`   | `see docs`                 |
 * | `[["E = mc", []], ["2", [["c"]]]]`                | `E = mc2`                  |
 * | date mention `2026-11-21 → 2026-11-30`            | `2026-11-21 → 2026-11-30`  |
 * | user mention (uuid)                              | dropped (no UUIDs indexed) |
 * | page mention (uuid)                              | dropped (title is indexed) |
 * | inline equation `x^2`                            | `x^2`                      |
 * | code block `const a = 1;`                        | kept verbatim per line     |
 *
 * Adjacent segments are concatenated **without** a separator, because Notion
 * splits styled words mid-word; words are only separated where the source text
 * itself contains whitespace, punctuation, or where a line breaks.
 */

import type {
  Block,
  BlockType,
  RichText,
  RichTextSegment,
  UUID,
} from '@votion/types';

import type { SearchDocument } from '../types.js';

/* -------------------------------------------------------------------------- */
/* Text extraction                                                            */
/* -------------------------------------------------------------------------- */

/** Block types that never contribute searchable text. */
const TEXT_EXCLUDED_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'divider',
  'column',
  'column_list',
  'template',
]);

/** Media block types: the caption is searchable, the file URL is not. */
const MEDIA_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'image',
  'video',
  'audio',
  'file',
  'pdf',
  'bookmark',
  'embed',
]);

/** Types that are rendered as page titles in the Quick Find list. */
const TITLE_TYPE_OVERRIDES: ReadonlySet<BlockType> = new Set<BlockType>([
  'page',
  'collection_view',
]);

/**
 * Collapses whitespace, drops zero-width joiners and normalises the ellipsis so
 * that identical content always yields identical indexed tokens.
 */
export function collapseWhitespace(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Renders a `['d', DateMetadata]` mention as a stable text token. */
function renderDateMention(startDate: string, endDate?: string): string {
  return endDate && endDate.length > 0
    ? `${startDate} → ${endDate}`
    : startDate;
}

/**
 * Maps a single rich-text segment to its plain-text projection.
 * Returns an empty string for mentions whose id is not human-readable.
 */
export function segmentToPlainText(segment: RichTextSegment): string {
  const content = typeof segment[0] === 'string' ? segment[0] : '';
  const modifiers = segment[1];
  if (!modifiers || modifiers.length === 0) {
    return content;
  }

  // Modifiers that carry text we should surface instead of the raw content.
  for (const modifier of modifiers) {
    switch (modifier[0]) {
      case 'e': {
        // Inline equation: `content` is the LaTeX source, keep it searchable.
        const latex = typeof modifier[1] === 'string' ? modifier[1] : content;
        return latex;
      }
      case 'd': {
        const date = modifier[1];
        if (
          date &&
          typeof date === 'object' &&
          typeof date.start_date === 'string'
        ) {
          return renderDateMention(date.start_date, date.end_date);
        }
        return content;
      }
      case 'u':
      case 'p': {
        // User/page mentions store a UUID in the content slot. Indexing raw ids
        // would let people "search" for ids and would bloat the index; the
        // mentioned page's own title is indexed separately.
        if (isUuidLike(content)) {
          return '';
        }
        return content;
      }
      default:
        // `b`, `i`, `s`, `_`, `c`, `h`, `a`: styling only, the text stands.
        break;
    }
  }
  return content;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `true` when the string is a canonical UUID (used to detect raw mention ids). */
export function isUuidLike(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

/**
 * Flattens rich text into a clean searchable string.
 *
 * Concatenates segments without inserted separators so that mid-word styling
 * splits are rejoined, then collapses whitespace.
 */
export function richTextToSearchText(
  richText: RichText | undefined | null,
): string {
  if (!richText || !Array.isArray(richText)) {
    return '';
  }
  let text = '';
  for (const segment of richText) {
    if (!Array.isArray(segment)) {
      continue;
    }
    text += segmentToPlainText(segment);
  }
  return collapseWhitespace(text);
}

/** Alias kept for symmetry with `@votion/types`' `richTextToPlainText`. */
export const stripRichTextMarkup = richTextToSearchText;

/** Reads the `properties.title` rich text of a block (empty when absent). */
function blockTitleRichText(block: Block): RichText {
  const title = block.properties?.title;
  return Array.isArray(title) ? title : [];
}

/** Reads `properties.caption` (media blocks). */
function blockCaptionRichText(block: Block): RichText {
  const caption = block.properties?.caption;
  return Array.isArray(caption) ? caption : [];
}

/** Reads the `[[language]]` payload of a code block. */
function codeLanguage(block: Block): string {
  const language = block.properties?.language;
  if (
    Array.isArray(language) &&
    Array.isArray(language[0]) &&
    typeof language[0][0] === 'string'
  ) {
    return language[0][0];
  }
  return '';
}

/** Reads the `[[url]]` payload of a media/bookmark block. */
function sourceUrl(block: Block): string {
  const source = block.properties?.source;
  if (
    Array.isArray(source) &&
    Array.isArray(source[0]) &&
    typeof source[0][0] === 'string'
  ) {
    return source[0][0];
  }
  return '';
}

/**
 * Extracts every searchable string a block carries, in reading order.
 *
 * Different block types expose text in different places, so each family is
 * handled explicitly instead of relying on a generic JSON walk (which would
 * also pull in formatter payloads, colours and ids):
 *
 * | Block family                | Searchable sources                          |
 * | :-------------------------- | :------------------------------------------ |
 * | text / headings / list / quote / callout / toggle / to_do | `title`            |
 * | code                        | `title` (verbatim, newlines normalised)     |
 * | math                        | `title` (LaTeX)                             |
 * | media / bookmark            | `caption`, and the URL for `bookmark`       |
 * | table / column / collection | nothing (children carry the text)           |
 * | `template` / `divider`      | nothing                                     |
 */
export function extractBlockText(block: Block): {
  title: string;
  body: string;
} {
  const title = richTextToSearchText(blockTitleRichText(block));

  if (TEXT_EXCLUDED_TYPES.has(block.type)) {
    return { title: '', body: '' };
  }

  if (MEDIA_TYPES.has(block.type)) {
    const caption = richTextToSearchText(blockCaptionRichText(block));
    const url = block.type === 'bookmark' ? sourceUrl(block) : '';
    return {
      title: '',
      body: collapseWhitespace([caption, url].filter(Boolean).join(' ')),
    };
  }

  if (block.type === 'code') {
    // Keep the code body searchable, including symbol-heavy tokens; the
    // language name is indexed too so "typescript" finds the block.
    const language = codeLanguage(block);
    return {
      title,
      body: collapseWhitespace([title, language].filter(Boolean).join(' ')),
    };
  }

  return { title, body: title };
}

/* -------------------------------------------------------------------------- */
/* Document assembly                                                          */
/* -------------------------------------------------------------------------- */

/** Everything the transformer needs that is not on the block itself. */
export interface TransformContext {
  /** Workspace id (`blocks.space_id` is authoritative, this is the fallback). */
  spaceId?: UUID;
  /** Root page of the block's sub-tree. Defaults to `parent_id`. */
  rootPageId?: UUID;
  /** Ancestors from the root page to the direct parent, exclusive of self. */
  ancestorIds?: readonly UUID[];
  /** Human-readable trail rendered under the result title. */
  breadcrumb?: string;
  /** Principal tokens holding an explicit read grant on the block. */
  accessPrincipals?: readonly string[];
  /**
   * Title of the parent page, used to make every descendant hit match a
   * "search in page by title" query.
   */
  parentTitle?: string;
}

/** A document plus the reasons it should not be indexed (empty when healthy). */
export interface TransformResult {
  document: SearchDocument | null;
  skipped: boolean;
  reason?:
    | 'deleted'
    | 'empty'
    | 'not-indexable'
    | 'unsupported-type'
    | 'missing-space';
}

function dedupe(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** Converts an unknown timestamp to epoch milliseconds. */
function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Transforms a single block into a {@link SearchDocument}.
 *
 * Returns `document: null` with a `reason` for blocks that must be removed from
 * the index (soft-deleted, empty, or structurally non-textual). Callers are
 * expected to delete those ids rather than skip them, otherwise stale documents
 * survive a deletion.
 */
export function transformBlock(
  block: Block,
  context: TransformContext = {},
): TransformResult {
  if (!block || typeof block.id !== 'string' || block.id.length === 0) {
    return { document: null, skipped: true, reason: 'unsupported-type' };
  }
  if (block.alive === false) {
    return { document: null, skipped: true, reason: 'deleted' };
  }
  if (
    TEXT_EXCLUDED_TYPES.has(block.type) &&
    !TITLE_TYPE_OVERRIDES.has(block.type)
  ) {
    return { document: null, skipped: true, reason: 'not-indexable' };
  }

  const { title, body } = extractBlockText(block);

  if (title.length === 0 && body.length === 0) {
    return { document: null, skipped: true, reason: 'empty' };
  }

  const spaceId = block.space_id ?? context.spaceId;
  if (typeof spaceId !== 'string' || spaceId.length === 0) {
    return { document: null, skipped: true, reason: 'missing-space' };
  }

  const parentId =
    typeof block.parent_id === 'string' ? block.parent_id : block.id;
  const rootPageId = context.rootPageId ?? parentId;
  const ancestorIds = dedupe(
    context.ancestorIds ?? (parentId === block.id ? [] : [parentId]),
  );
  const now = Date.now();

  // The title is indexed twice on purpose: as its own attribute (higher
  // attribute-ranking weight) and as part of `plain_text` so a phrase query
  // spanning title + body still matches.
  const plainTextParts = [title, body, context.parentTitle ?? '']
    .map((part) => collapseWhitespace(part))
    .filter(
      (part, index, parts) => part.length > 0 && parts.indexOf(part) === index,
    );

  const document: SearchDocument = {
    id: block.id,
    space_id: spaceId,
    parent_id: parentId,
    root_page_id: rootPageId,
    type: block.type,
    title,
    plain_text: plainTextParts.join(' '),
    created_by:
      typeof block.created_by_id === 'string' && block.created_by_id.length > 0
        ? block.created_by_id
        : 'unknown',
    last_edited_time: normalizeTimestamp(block.last_edited_time, now),
    ancestor_ids: ancestorIds,
    access_principals: dedupe(context.accessPrincipals),
    alive: block.alive,
  };

  if (context.breadcrumb !== undefined && context.breadcrumb.length > 0) {
    document.breadcrumb = context.breadcrumb;
  }

  return { document, skipped: false };
}

/**
 * Transforms a block tree (depth-first, BFS-ordered output).
 *
 * The map must contain every descendant; blocks referenced in `content` but
 * missing from the map are ignored so a partially loaded page still yields a
 * partial — never corrupt — index update.
 */
export function transformBlockTree(
  rootId: UUID,
  blocks: ReadonlyMap<UUID, Block> | readonly Block[],
  options: { spaceId?: UUID; breadcrumbSeparator?: string } = {},
): SearchDocument[] {
  const index = new Map<UUID, Block>();
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      index.set(block.id, block);
    }
  } else {
    for (const [id, block] of blocks as ReadonlyMap<UUID, Block>) {
      index.set(id, block);
    }
  }

  const root = index.get(rootId);
  if (!root) {
    return [];
  }

  const separator = options.breadcrumbSeparator ?? ' / ';
  const documents: SearchDocument[] = [];
  const visited = new Set<UUID>();

  interface Frame {
    block: Block;
    ancestors: UUID[];
    trail: string[];
  }

  const queue: Frame[] = [{ block: root, ancestors: [], trail: [] }];

  while (queue.length > 0) {
    const frame = queue.shift() as Frame;
    const { block, ancestors, trail } = frame;
    if (visited.has(block.id)) {
      continue;
    }
    visited.add(block.id);

    const parentId = block.parent_id;
    const rootPageId =
      ancestors.length > 0
        ? (ancestors[0] as UUID)
        : block.type === 'page'
          ? block.id
          : parentId;

    // A page contributes its own title to the breadcrumb of its children.
    const title = richTextToSearchText(blockTitleRichText(block));
    const nextTrail =
      block.type === 'page' && title.length > 0 ? [...trail, title] : trail;

    const result = transformBlock(block, {
      spaceId: block.space_id ?? options.spaceId,
      rootPageId,
      ancestorIds: ancestors,
      breadcrumb: trail.length > 0 ? trail.join(separator) : undefined,
      parentTitle: block.type === 'page' ? undefined : trail[trail.length - 1],
    });
    if (result.document) {
      documents.push(result.document);
    }

    const childAncestors =
      block.type === 'page' ? [...ancestors, block.id] : ancestors;
    for (const childId of block.content ?? []) {
      const child = index.get(childId);
      if (child && !visited.has(child.id)) {
        queue.push({
          block: child,
          ancestors: childAncestors,
          trail: nextTrail,
        });
      }
    }
  }

  return documents;
}

/** Batch helper used by `BatchIndexer`. */
export function transformBlocks(
  blocks: readonly Block[],
  context: TransformContext = {},
): SearchDocument[] {
  const documents: SearchDocument[] = [];
  for (const block of blocks) {
    const result = transformBlock(block, context);
    if (result.document) {
      documents.push(result.document);
    }
  }
  return documents;
}

/** Block types that can appear as a Quick Find result row at all. */
export function isIndexableBlockType(type: BlockType): boolean {
  return !TEXT_EXCLUDED_TYPES.has(type) || TITLE_TYPE_OVERRIDES.has(type);
}
