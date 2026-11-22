import { useCallback } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import type { BlockEditorActions } from '../lib/editor.js';

export interface ListBlockProps {
  block: Block;
  /** Display index within the parent list (for numbered list markers). */
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * List block: `bulleted_list_item` renders a bullet marker and
 * `numbered_list_item` renders an auto-incremented number derived from its
 * position in the parent `content` list.
 */
export function ListBlock({
  block,
  index,
  editor,
}: ListBlockProps): JSX.Element {
  const title: RichText = block.properties.title ?? [];
  const isNumbered = block.type === 'numbered_list_item';
  const marker = isNumbered ? `${(index ?? 0) + 1}.` : '•';

  const handleTitleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  return (
    <div className="list-item mb-1 block-text">
      <span className="mr-2 shrink-0 text-gray-500">{marker}</span>
      <div
        contentEditable={true}
        suppressContentEditableWarning
        className="outline-none"
        onBlur={(event) => handleTitleChange(event.currentTarget.innerText)}
      >
        {title.length > 0 ? (
          <RichTextRenderer richText={title} />
        ) : (
          <span className="text-placeholder">Type something…</span>
        )}
      </div>
    </div>
  );
}
