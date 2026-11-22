import { useCallback, useState } from 'react';
import katex from 'katex';
import type { Block, UUID } from '@votion/types';
import { richTextToPlainText } from '@votion/types';
import type { BlockEditorActions } from '../lib/editor.js';

export interface MathBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * Math block: block-level KaTeX equation. Double-click to edit the LaTeX
 * source in a textarea; the result is stored in `properties.title`.
 */
export function MathBlock({
  block,
  editor,
}: MathBlockProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(richTextToPlainText(block.properties.title));
  const latex = richTextToPlainText(block.properties.title);

  const handleSave = useCallback(() => {
    editor.patchBlock(block.id, { properties: { title: [[draft]] } });
    setEditing(false);
  }, [block.id, draft, editor]);

  if (editing) {
    return (
      <div className="math-block my-2 relative">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={handleSave}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSave();
            }
          }}
          className="w-full text-sm font-mono p-2 border border-gray-200 rounded outline-none"
        />
        <button
          type="button"
          onClick={handleSave}
          className="absolute top-1 right-1 text-xs text-gray-600 hover:text-gray-900"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div
      className="math-block my-2"
      onDoubleClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') setEditing(true);
      }}
    >
      <div
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(latex, {
            throwOnError: false,
            displayMode: true,
          }),
        }}
      />
    </div>
  );
}
