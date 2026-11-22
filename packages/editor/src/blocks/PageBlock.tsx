import { useCallback } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import { BlockCanvas } from '../components/BlockCanvas.js';
import type { BlockEditorActions } from '../lib/editor.js';

export interface PageBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * Page block: renders the page title as an H1 surface followed by a nested
 * block canvas for the page's children.
 */
export function PageBlock({
  block,
  spaceId,
  editor,
}: PageBlockProps): JSX.Element {
  const title: RichText = block.properties.title ?? [];

  const handleTitleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  return (
    <div className="mb-6">
      <h1
        className="text-3xl font-bold leading-tight mb-2 outline-none"
        contentEditable={true}
        suppressContentEditableWarning
        onBlur={(event) => handleTitleChange(event.currentTarget.innerText)}
      >
        {title.length > 0 ? (
          <RichTextRenderer richText={title} />
        ) : (
          <span className="text-gray-400">Untitled page</span>
        )}
      </h1>
      <BlockCanvas rootBlockId={block.id} spaceId={spaceId} />
    </div>
  );
}
