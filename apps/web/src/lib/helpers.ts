/**
 * Small pure helpers shared across the shell.
 */

import type { Block, UUID } from '@votion/types';
import { richTextToPlainText } from '@votion/types';

export function isPageLike(block: Block | undefined): boolean {
  return !!block && (block.type === 'page' || block.type === 'collection_view');
}

export function pageTitle(block: Block | undefined): string {
  if (!block) return 'Untitled';
  return richTextToPlainText(block.properties?.title) || 'Untitled';
}

/** Returns the ancestor chain (root first) of a block, stopping at the space. */
export function ancestorChain(
  blocks: Record<UUID, Block>,
  block: Block | undefined,
): Block[] {
  if (!block) return [];
  const chain: Block[] = [];
  const seen = new Set<UUID>();
  let cursor: Block | undefined = block;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    if (cursor.parent_table !== 'block') break;
    cursor = blocks[cursor.parent_id];
  }
  chain.reverse();
  return chain;
}

/** The first root ancestor (space-parented page). */
export function rootPageOf(
  blocks: Record<UUID, Block>,
  block: Block | undefined,
): Block | undefined {
  if (!block) return undefined;
  const chain = ancestorChain(blocks, block);
  return chain[0];
}

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
