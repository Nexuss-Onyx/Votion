import type { Block, BlockType, UUID } from '@votion/types';
import type { BlockEditorActions } from '../lib/editor.js';
import { PageBlock } from './PageBlock.js';
import { TextBlock } from './TextBlock.js';
import { HeadingBlock } from './HeadingBlock.js';
import { TodoBlock } from './TodoBlock.js';
import { ListBlock } from './ListBlock.js';
import { ToggleBlock } from './ToggleBlock.js';
import { QuoteBlock } from './QuoteBlock.js';
import { CalloutBlock } from './CalloutBlock.js';
import { DividerBlock } from './DividerBlock.js';
import { CodeBlock } from './CodeBlock.js';
import { MathBlock } from './MathBlock.js';
import { MediaBlock } from './MediaBlock.js';
import { BookmarkBlock } from './BookmarkBlock.js';
import { SyncedBlock } from './SyncedBlock.js';
import { ColumnLayout } from '../components/ColumnLayout.js';
import type { ColumnLayoutProps } from '../components/ColumnLayout.js';
import type { FC } from 'react';

export interface BlockRendererProps {
  block: Block;
  /** Display index within the parent list (used for numbered lists). */
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

const BLOCK_LABELS: Record<BlockType, string> = {
  page: 'Page',
  text: 'Text',
  heading_1: 'Heading 1',
  heading_2: 'Heading 2',
  heading_3: 'Heading 3',
  bulleted_list_item: 'Bulleted List',
  numbered_list_item: 'Numbered List',
  to_do: 'To-do',
  toggle: 'Toggle',
  quote: 'Quote',
  callout: 'Callout',
  divider: 'Divider',
  column_list: 'Column List',
  column: 'Column',
  table: 'Table',
  collection_view: 'Database',
  synced_block: 'Synced Block',
  template: 'Template',
  code: 'Code',
  math: 'Math',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  pdf: 'PDF',
  bookmark: 'Bookmark',
  embed: 'Embed',
};

/**
 * Dispatches a block record to its type-specific renderer. Unknown or not-yet
 * implemented types fall back to `DefaultBlock`, so the canvas never crashes
 * on an unrecognized block type.
 */
export function BlockRenderer({
  block,
  index,
  spaceId,
  editor,
}: BlockRendererProps): JSX.Element {
  switch (block.type) {
    case 'page':
      return <PageBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'text':
      return <TextBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return (
        <HeadingBlock block={block} index={index} spaceId={spaceId} editor={editor} />
      );
    case 'to_do':
      return <TodoBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'bulleted_list_item':
    case 'numbered_list_item':
      return (
        <ListBlock block={block} index={index} spaceId={spaceId} editor={editor} />
      );
    case 'toggle':
      return <ToggleBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'quote':
      return <QuoteBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'callout':
      return <CalloutBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'divider':
      return <DividerBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'code':
      return <CodeBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'math':
      return <MathBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'pdf':
    case 'bookmark':
    case 'embed':
      return (
        <MediaBlock block={block} index={index} spaceId={spaceId} editor={editor} />
      );
    case 'synced_block':
      return <SyncedBlock block={block} index={index} spaceId={spaceId} editor={editor} />;
    case 'column_list': {
      const RenderColumnLayout: FC<ColumnLayoutProps> = ColumnLayout;
      return <RenderColumnLayout block={block} spaceId={spaceId} editor={editor} />;
    }
    default:
      return <DefaultBlock block={block} index={index} />;
  }
}

/** Fallback renderer for block types without a dedicated component. */
function DefaultBlock({
  block,
  index,
}: {
  block: Block;
  index?: number;
}): JSX.Element {
  const title = (block.properties.title as any) ?? [];
  const plain = Array.isArray(title)
    ? title
        .map((segment) => (Array.isArray(segment) ? segment[0] : ''))
        .join('')
    : '';
  return (
    <div className="mb-2 p-2 rounded border border-gray-100 bg-gray-50 text-xs text-gray-500">
      {BLOCK_LABELS[block.type] ?? block.type}{plain ? ` — ${plain}` : ''}
    </div>
  );
}
