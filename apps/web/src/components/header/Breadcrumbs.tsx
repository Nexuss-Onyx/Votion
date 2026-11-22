'use client';

import { ChevronRight } from 'lucide-react';
import { useWorkspace } from '@/state/WorkspaceProvider';
import { isPageLike, pageTitle } from '@/lib/helpers';
import type { Block } from '@votion/types';

/**
 * Interactive breadcrumb path: 🏠 Home / 📘 Onboarding / 🚀 Getting Started.
 * Every ancestor is a link; the current page is bold text, not a link.
 */
export function Breadcrumbs() {
  const { activePage, getBlock, openPage } = useWorkspace();
  if (!activePage) return null;

  // Accumulate the ancestor chain (root first) via per-ancestor lookups.
  let cursor: Block | undefined = activePage;
  const chain: Block[] = [];
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    if (cursor.parent_table !== 'block') break;
    cursor = getBlock(cursor.parent_id);
  }
  chain.reverse();

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
      {chain.map((page, index) => {
        const isLast = index === chain.length - 1;
        const title = pageTitle(page);
        return (
          <span key={page.id} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-notion-disabled" aria-hidden />}
            {isLast ? (
              <span aria-current="page" className="truncate font-semibold text-notion-text">
                {title}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => isPageLike(page) && openPage(page.id)}
                className="truncate text-notion-muted transition-colors hover:text-notion-text"
              >
                {title}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
