import { useCallback, useState } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import { BlockCanvas } from '../components/BlockCanvas.js';
import type { BlockEditorActions } from '../lib/editor.js';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

export interface HeadingBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

const HEADING_TAGS: Record<'heading_1' | 'heading_2' | 'heading_3', string> = {
  heading_1: 'h1',
  heading_2: 'h2',
  heading_3: 'h3',
};

/**
 * Heading block (H1/H2/H3) with an optional toggle-collapse button that
 * reveals or hides a nested canvas of child blocks.
 */
export function HeadingBlock({
  block,
  spaceId,
  editor,
}: HeadingBlockProps): JSX.Element {
  const tag = HEADING_TAGS[block.type as keyof typeof HEADING_TAGS];
  const title: RichText = block.properties.title ?? [];
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = block.content.length > 0;

  const handleTitleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  const Tag = tag as 'h1' | 'h2' | 'h3';

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        {hasChildren && (
          <button
            type="button"
            className="text-gray-400 hover:text-gray-900 transition-colors"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        <Tag
          className={clsx(
            block.type === 'heading_1' ? 'text-4xl font-bold leading-tight' : '',
            block.type === 'heading_2' ? 'text-2xl font-bold leading-tight' : '',
            block.type === 'heading_3' ? 'text-xl font-bold leading-snug' : '',
            'mt-2 mb-1 outline-none',
          )}
          contentEditable={true}
          suppressContentEditableWarning
          onBlur={(event) => handleTitleChange(event.currentTarget.innerText)}
        >
          {title.length > 0 ? (
            <RichTextRenderer richText={title} />
          ) : (
            <span className="text-gray-400">Type something…</span>
          )}
        </Tag>
      </div>
      {hasChildren && !collapsed && (
        <BlockCanvas rootBlockId={block.id} spaceId={spaceId} className="pl-4" />
      )}
    </div>
  );
}
