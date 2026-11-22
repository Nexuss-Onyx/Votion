import { useCallback } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import type { BlockEditorActions } from '../lib/editor.js';
import { clsx } from 'clsx';

export interface CalloutBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

const DEFAULT_EMOJI = '📌';

/**
 * Callout block: emoji icon, background tint from `format.block_color`, and
 * rich text body.
 */
export function CalloutBlock({
  block,
  editor,
}: CalloutBlockProps): JSX.Element {
  const title: RichText = block.properties.title ?? [];
  const emoji = String(block.properties.emoji ?? DEFAULT_EMOJI);
  const background = (block.format.block_color as string | undefined) ?? 'default';
  const isBackground = background.endsWith('_background');
  const baseClass = isBackground ? `callout-${background}` : 'callout-default';

  const handleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  return (
    <div className={clsx('callout my-2', baseClass)}>
      <span className="shrink-0 text-xl">{emoji}</span>
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
    </div>
  );
}
