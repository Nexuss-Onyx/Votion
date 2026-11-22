import { useCallback } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import type { BlockEditorActions } from '../lib/editor.js';

export interface QuoteBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * Quote block: italicized text with an accent left border bar.
 */
export function QuoteBlock({
  block,
  editor,
}: QuoteBlockProps): JSX.Element {
  const title: RichText = block.properties.title ?? [];

  const handleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  return (
    <blockquote className="quote my-2">
      <div
        contentEditable={true}
        suppressContentEditableWarning
        className="outline-none"
        onBlur={(event) => handleChange(event.currentTarget.innerText)}
      >
        {title.length > 0 ? (
          <RichTextRenderer richText={title} />
        ) : (
          <span className="text-placeholder">Type something…</span>
        )}
      </div>
    </blockquote>
  );
}
