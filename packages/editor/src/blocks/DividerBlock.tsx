import type { Block, UUID } from '@votion/types';
import type { BlockEditorActions } from '../lib/editor.js';

export interface DividerBlockProps {
  block: Block;
  index?: number;
  spaceId?: UUID;
  editor: BlockEditorActions;
}

/** Divider block: a minimal horizontal rule. */
export function DividerBlock(_props: DividerBlockProps): JSX.Element {
  return <hr className="divider" />;
}
