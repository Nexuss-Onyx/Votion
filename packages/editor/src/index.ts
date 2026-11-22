/**
 * `@votion/editor` — Votion's block editor canvas.
 *
 * Public surface:
 *  - `BlockCanvas`, `BlockWrapper`, `ColumnLayout` — canvas & layout
 *  - `BlockRenderer` — per-type block renderer dispatch
 *  - `createBlockEditor`, `createBlockRecord`, `removeBlockTree`, `upsertBlockRecord`, `buildInsertBlockTransaction` — local-first mutations
 *  - `RichTextRenderer`, `FloatingToolbar` — rich text
 *  - `SlashMenu`, `MarkdownShortcuts` — commands & auto-formatting
 *  - `DragManager`, `MultiBlockSelection` — drag-and-drop & selection
 */

export {
  BlockCanvas,
  BlockWrapper,
  ColumnLayout,
} from './components/index.js';
export { BlockRenderer } from './blocks/BlockRenderer.js';
export type { BlockRendererProps } from './blocks/BlockRenderer.js';
export {
  createBlockEditor,
  createBlockRecord,
  removeBlockTree,
  upsertBlockRecord,
  buildInsertBlockTransaction,
  type BlockEditorActions,
  now,
} from './lib/editor.js';
export { useBlock, useChildBlocks, useBlockStore, installTestStore, uninstallTestStore } from './lib/store.js';
export { RichTextRenderer } from './richtext/RichTextRenderer.js';
export { renderSafeKatex } from './lib/sanitize.js';
export { FloatingToolbar } from './richtext/FloatingToolbar.js';
export { SlashMenu } from './shortcuts/SlashMenu.js';
export { BookmarkBlock } from './blocks/BookmarkBlock.js';
export type { MarkdownTrigger } from './shortcuts/MarkdownShortcuts.js';
export {
  parseMarkdownLine,
  MARKDOWN_TRIGS,
} from './shortcuts/MarkdownShortcuts.js';
export {
  getDropZone,
  computeDropIndex,
  dropZoneToOperation,
  type DropZone,
} from './dnd/DragManager.js';
export { MultiBlockSelection } from './dnd/MultiBlockSelection.js';
