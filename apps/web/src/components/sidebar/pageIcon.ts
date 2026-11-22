import type { Block } from '@votion/types';

/** Returns the page/collection-view icon (emoji or 📄). */
export function pageIcon(block: Block | undefined): string {
  if (!block) return '📄';
  return block.format?.page_icon ?? '📄';
}
