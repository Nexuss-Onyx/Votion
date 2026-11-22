import { useCallback, useState } from 'react';
import type { Block, RichText, UUID } from '@votion/types';
import { RichTextRenderer } from '../richtext/RichTextRenderer.js';
import { BlockCanvas } from '../components/BlockCanvas.js';
import type { BlockEditorActions } from '../lib/editor.js';
import { ChevronDown, ChevronRight } from 'lucide-react';

export interface ToggleBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/**
 * Toggle block: chevron button reveals or hides a nested canvas of child
 * blocks.
 */
export function ToggleBlock({
  block,
  spaceId,
  editor,
}: ToggleBlockProps): JSX.Element {
  const title: RichText = block.properties.title ?? [];
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = block.content.length > 0;

  const handleTitleChange = useCallback(
    (next: string) => {
      editor.patchBlock(block.id, { properties: { title: [[next]] } });
    },
    [block.id, editor],
  );

  return (
    <div className="toggle mb-2">
      <div className="flex items-center gap-2 cursor-pointer select-none">
        <button
          type="button"
          className="text-gray-400 hover:text-gray-900 transition-colors"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <div
          className="outline-none min-w-0"
          contentEditable={true}
          suppressContentEditableWarning
          onBlur={(event) => handleTitleChange(event.currentTarget.innerText)}
        >
          {title.length > 0 ? (
            <RichTextRenderer richText={title} />
          ) : (
            <span className="text-placeholder">Type something…</span>
          )}
        </div>
      </div>
      {hasChildren && !collapsed && (
        <BlockCanvas rootBlockId={block.id} spaceId={spaceId} className="pl-4 border-l border-gray-200" />
      )}
    </div>
  );
}
