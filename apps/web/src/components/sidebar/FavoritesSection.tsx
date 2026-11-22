'use client';

import { Star } from 'lucide-react';
import { useWorkspace } from '@/state/WorkspaceProvider';
import { isPageLike, pageTitle } from '@/lib/helpers';
import type { Block } from '@votion/types';
import { pageIcon } from './pageIcon';

/** Quick-access list of pinned pages (Notion's Favorites). */
export function FavoritesSection() {
  const { favorites, getBlock, openPage, activePageId } = useWorkspace();

  const pages = favorites
    .map((id) => getBlock(id))
    .filter((block): block is Block => block !== undefined && block.alive && isPageLike(block))
    .slice(0, 5);

  if (pages.length === 0) return null;

  return (
    <section aria-label="Favorites" className="mt-2">
      <header className="flex items-center gap-1.5 px-2 pb-1 pt-2">
        <Star className="h-3.5 w-3.5 text-yellow-500" fill="currentColor" aria-hidden />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-notion-muted">
          Favorites
        </h3>
      </header>
      <ul className="flex flex-col gap-px">
        {pages.map((page) => (
          <li key={page.id}>
            <button
              type="button"
              onClick={() => openPage(page.id)}
              aria-current={page.id === activePageId ? 'page' : undefined}
              className={`flex w-full items-center gap-2 rounded-shell px-2 py-1.5 text-left text-sm transition-colors ${
                page.id === activePageId
                  ? 'bg-notion-active font-semibold text-notion-text'
                  : 'text-notion-text hover:bg-notion-hover'
              }`}
            >
              <span aria-hidden>{pageIcon(page)}</span>
              <span className="min-w-0 flex-1 truncate">{pageTitle(page)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
