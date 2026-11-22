'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Check,
  ChevronDown,
  Download,
  RectangleHorizontal,
  Type,
  Trash2,
} from 'lucide-react';
import { getRecordStore } from '@votion/sync-client';
import { useWorkspace } from '@/state/WorkspaceProvider';
import { pageTitle, ancestorChain } from '@/lib/helpers';
import type { Block } from '@votion/types';

function downloadJson(filename: string, payload: unknown) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Page options menu (`…`) — Export, Full width toggle, Small text toggle,
 * Delete the page.
 */
export function PageOptionsMenu({ align = 'end' }: { align?: 'start' | 'end' } = {}) {
  const { activePage, setPageFullWidth, setPageSmallText, softDeleteActivePage } = useWorkspace();

  if (!activePage) return null;

  const fullWidth = Boolean(activePage.format?.page_full_width);
  const smallText = Boolean(activePage.format?.page_small_text);

  const exportJSON = () => {
    // Faithful export of the current surface: page + immediate children.
    const store = getRecordStore();
    const blocks = store.getState().blocks;
    const chain = ancestorChain(blocks, activePage);
    const payload = {
      exportedAt: new Date().toISOString(),
      title: pageTitle(activePage),
      breadcrumb: chain.map((block) => pageTitle(block)),
      page: activePage,
      children: activePage.content
        .map((id) => blocks[id])
        .filter((block): block is Block => Boolean(block)),
    };
    downloadJson(`${pageTitle(activePage).toLowerCase().replace(/\s+/g, '-')}.votion.json`, payload);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Page options"
          className="flex h-8 items-center gap-1 rounded-shell px-2.5 text-sm font-medium text-notion-text transition-colors hover:bg-notion-hover"
        >
          <span className="hidden sm:inline">Options</span>
          <ChevronDown className="h-3.5 w-3.5 text-notion-muted" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 w-56 overflow-hidden rounded-xl border border-notion-border bg-white py-1 shadow-pop outline-none"
        >
          <DropdownMenu.Item
            onSelect={exportJSON}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-notion-text outline-none transition-colors hover:bg-notion-hover data-[highlighted]:bg-notion-hover"
          >
            <Download className="h-4 w-4 text-notion-muted" aria-hidden />
            Export (JSON)
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setPageFullWidth(activePage.id, !fullWidth)}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-notion-text outline-none transition-colors hover:bg-notion-hover data-[highlighted]:bg-notion-hover"
          >
            <RectangleHorizontal className="h-4 w-4 text-notion-muted" aria-hidden />
            <span className="flex-1">Full width</span>
            {fullWidth && <Check className="h-4 w-4 text-notion-accent" aria-hidden />}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => setPageSmallText(activePage.id, !smallText)}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-notion-text outline-none transition-colors hover:bg-notion-hover data-[highlighted]:bg-notion-hover"
          >
            <Type className="h-4 w-4 text-notion-muted" aria-hidden />
            <span className="flex-1">Small text</span>
            {smallText && <Check className="h-4 w-4 text-notion-accent" aria-hidden />}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-notion-border" />
          <DropdownMenu.Item
            onSelect={softDeleteActivePage}
            className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-red-600 outline-none transition-colors hover:bg-red-50 data-[highlighted]:bg-red-50"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete page
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
