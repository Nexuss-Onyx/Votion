/**
 * Canonical block contracts.
 *
 * A Votion page is an ordered parent/child link list of blocks. Hierarchy is
 * expressed twice (denormalised for read performance):
 *  - downwards via `content: UUID[]` (ordered child ids), and
 *  - upwards via `parent_id` + `parent_table`.
 */

import type {
  AuditedRecord,
  IconString,
  ParentTable,
  UUID,
} from './common.js';
import type { RichText } from './rich-text.js';

/** Every block primitive and container type supported by the editor. */
export type BlockType =
  // Primitive / text
  | 'page'
  | 'text'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'to_do'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  // Containers
  | 'column_list'
  | 'column'
  | 'table'
  | 'collection_view'
  | 'synced_block'
  | 'template'
  // Code & math
  | 'code'
  | 'math'
  // Media
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'pdf'
  | 'bookmark'
  | 'embed';

/** Blocks whose children are rendered inline inside the parent row. */
export type InlineContainerBlockType =
  | 'page'
  | 'toggle'
  | 'column'
  | 'column_list'
  | 'table'
  | 'synced_block'
  | 'template';

/** Notion-compatible checkbox payload: `[['yes']]` or `[['no']]`. */
export type CheckboxValue = [['yes'] | ['no']];

/** Code block payload (`language` doubles as the highlight grammar id). */
export type CodeLanguageValue = [[language: string]];

/** Media / bookmark payload holding the primary source URL. */
export type SourceValue = [[source: string]];

/**
 * Content payload of a block. Typed keys cover the hot paths used by the editor;
 * the index signature keeps type-specific (and forward-compatible) property keys
 * addressable without falling back to `any`.
 */
export interface BlockProperties {
  /** Rich text content of text-like blocks. */
  title?: RichText;
  /** To-do checkbox state. */
  checked?: CheckboxValue;
  /** Code block language (e.g. `typescript`). */
  language?: CodeLanguageValue;
  /** Media / bookmark source URL. */
  source?: SourceValue;
  /** Media caption. */
  caption?: RichText;
  /** Collection schema referenced by a `collection_view` block. */
  collection_id?: UUID;
  /** Page ids rendered by a `collection_view` block. */
  view_ids?: UUID[];
  /** Master block id referenced by a `synced_block`. */
  synced_from_block_id?: UUID;
  /** Table column order for `table` blocks. */
  table_block_column_order?: UUID[];
  /** Arbitrary extra property payloads (JSONB). */
  [key: string]: unknown;
}

/** Visual / layout payload of a block (`format` JSONB column). */
export interface BlockFormat {
  block_color?: BlockColor;
  /** Percentage width used inside column layouts. */
  block_width?: number;
  page_icon?: IconString;
  page_cover?: string;
  page_cover_position?: number;
  page_full_width?: boolean;
  page_small_text?: boolean;
  column_ratio?: number;
  column_ratios?: number[];
  table_width?: number;
  table_has_column_header?: boolean;
  table_has_row_header?: boolean;
  /** Media display mode (`page_cover`, `preview`, `full_page`). */
  display_source?: string;
  /** CSS-like alignment used by media blocks. */
  block_alignment?: 'left' | 'center' | 'right';
  [key: string]: unknown;
}

/** Color token accepted by `format.block_color`. */
export type BlockColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'default_background'
  | 'gray_background'
  | 'brown_background'
  | 'orange_background'
  | 'yellow_background'
  | 'green_background'
  | 'blue_background'
  | 'purple_background'
  | 'pink_background'
  | 'red_background';

/** Canonical persisted block record. */
export interface Block extends AuditedRecord {
  id: UUID;
  space_id: UUID;
  /** Monotonic optimistic-concurrency counter, bumped on every mutation. */
  version: number;
  type: BlockType;
  properties: BlockProperties;
  format: BlockFormat;
  /** Ordered array of child block ids. */
  content: UUID[];
  parent_id: UUID;
  parent_table: ParentTable;
  alive: boolean;
}

/** Payload accepted when inserting a brand new block. */
export type NewBlock = Pick<Block, 'type' | 'space_id' | 'parent_id' | 'parent_table'> &
  Partial<Omit<Block, 'type' | 'space_id' | 'parent_id' | 'parent_table'>>;

/** Properties of a text-like block. */
export type TextBlockProperties = Required<Pick<BlockProperties, 'title'>>;

/** Properties of a to-do block. */
export type TodoBlockProperties = Required<
  Pick<BlockProperties, 'title' | 'checked'>
>;

/** Properties of a code block. */
export type CodeBlockProperties = Required<
  Pick<BlockProperties, 'title' | 'language'>
>;

/** Properties of a media (image/video/audio/file/pdf) block. */
export type MediaBlockProperties = Required<Pick<BlockProperties, 'source'>> &
  Pick<BlockProperties, 'caption'>;

/** Format payload of a page block. */
export type PageBlockFormat = Pick<
  BlockFormat,
  | 'page_icon'
  | 'page_cover'
  | 'page_cover_position'
  | 'page_full_width'
  | 'page_small_text'
>;

/** Format payload of a column block. */
export type ColumnBlockFormat = Required<Pick<BlockFormat, 'column_ratio'>>;

/** Blocks that can render a page title surface. */
export const PAGE_LIKE_BLOCK_TYPES: readonly BlockType[] = [
  'page',
  'collection_view',
];

/** All media block types. */
export const MEDIA_BLOCK_TYPES: readonly BlockType[] = [
  'image',
  'video',
  'audio',
  'file',
  'pdf',
  'bookmark',
  'embed',
];

/** Type guard for a persisted {@link Block} record. */
export function isBlock(value: unknown): value is Block {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof Block, unknown>>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.space_id === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.content) &&
    typeof candidate.parent_id === 'string' &&
    typeof candidate.parent_table === 'string' &&
    typeof candidate.alive === 'boolean'
  );
}

/** Narrows a block to a specific {@link BlockType}. */
export function isBlockOfType<T extends BlockType>(
  block: Block,
  type: T,
): block is Block & { type: T } {
  return block.type === type;
}

/** Returns the block title as rich text (empty array when absent). */
export function getBlockTitle(block: Block): RichText {
  return block.properties.title ?? [];
}

/** Returns the ids of every child block of the given block. */
export function getBlockChildren(block: Block): UUID[] {
  return block.content;
}

/** Blocks that hold no children and no title surface. */
export function isLeafBlock(block: Block): boolean {
  return block.type === 'divider' || MEDIA_BLOCK_TYPES.includes(block.type);
}
