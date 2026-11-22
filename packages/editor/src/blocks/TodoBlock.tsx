import { useCallback } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import { richTextToPlainText } from '@votion/types';
import type { BlockEditorActions } from '../lib/editor.js';
import { clsx } from 'clsx';

export interface TodoBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * To-do block: checkbox toggling `properties.checked` between `['yes']` and
 * `['no']`, with strikethrough styling applied when checked.
 */
export function TodoBlock({
  block,
  editor,
}: TodoBlockProps): JSX.Element {
  const title: RichText = block.properties.title ?? [];
  const checked = block.properties.checked?.[0]?.[0] === 'yes';

  const handleToggle = useCallback(() => {
    editor.patchBlock(block.id, {
      properties: { checked: [[checked ? 'no' : 'yes']] },
    });
  }, [block.id, checked, editor]);

  const handleTitleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  return (
    <div className="todo mb-1">
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={handleToggle}
          className="todo-checkbox shrink-0"
          aria-label="Mark as done"
        />
        <span
          className={clsx(
            'todo-text',
            checked && 'is-checked',
            'block-text outline-none',
          )}
          contentEditable={true}
          suppressContentEditableWarning
          onBlur={(event) => handleTitleChange(event.currentTarget.innerText)}
        >
          {title.length > 0 ? (
            <RichTextRenderer richText={title} />
          ) : (
            <span className="text-placeholder">Type something…</span>
          )}
        </span>
      </label>
    </div>
  );
}
