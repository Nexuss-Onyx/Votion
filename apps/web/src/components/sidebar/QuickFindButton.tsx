'use client';

import { Search } from 'lucide-react';
import { useWorkspace } from '@/state/WorkspaceProvider';

/**
 * Quick Find launcher — opens the `@votion/search` Quick Find modal
 * (`Cmd+K`). The global shortcut is wired by the modal itself.
 */
export function QuickFindButton() {
  const { setQuickFindOpen } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => setQuickFindOpen(true)}
      className="flex min-w-0 flex-1 items-center gap-2 rounded-shell border border-notion-border bg-white px-2.5 py-1.5 text-start text-sm text-notion-muted shadow-sm transition-colors hover:border-notion-disabled hover:bg-notion-hover"
      aria-label="Open Quick Find"
    >
      <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Quick Find</span>
      <kbd className="hidden shrink-0 rounded border border-notion-border bg-notion-sidebar px-1.5 py-0.5 text-[10px] font-medium text-notion-muted sm:inline-block">
        ⌘K
      </kbd>
    </button>
  );
}
