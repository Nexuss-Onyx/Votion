import { useCallback, useEffect, useRef, useState } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import { richTextToPlainText } from '@votion/types';
import type { BlockEditorActions } from '../lib/editor.js';
import { clsx } from 'clsx';

export interface TextBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * Text block: contenteditable paragraph backed by rich text segments.
 * Typing updates a local draft; on blur the draft is committed to the store
 * as the block title, preserving any existing segments until the next edit.
 */
export function TextBlock({
  block,
  editor,
}: TextBlockProps): JSX.Element {
  const title: RichText = block.properties.title ?? [];
  const [draft, setDraft] = useState(richTextToPlainText(title));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(richTextToPlainText(title));
  }, [title]);

  const handleInput = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      setDraft(event.currentTarget.innerText);
    },
    [],
  );

  const handleBlur = useCallback(() => {
    const plain = richTextToPlainText(title);
    if (draft !== plain) {
      editor.patchBlock(block.id, { properties: { title: [[draft]] } });
    }
  }, [block.id, draft, editor, title]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && event.shiftKey) {
        // Insert a soft line break as an actual newline in the draft.
        event.preventDefault();
        document.execCommand('insertLineBreak', false, undefined);
      }
    },
    [],
  );

  const empty = draft.length === 0 && title.length === 0;

  return (
    <div
      ref={ref}
      className={clsx('text-block block-text', empty ? 'is-empty' : '')}
      contentEditable={true}
      suppressContentEditableWarning
      onInput={handleInput}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {title.length > 0 ? (
        <RichTextRenderer richText={title} />
      ) : empty ? (
        <span className="text-placeholder">Type something…</span>
      ) : null}
    </div>
  );
}
