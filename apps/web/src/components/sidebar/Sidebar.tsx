'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useWorkspace } from '@/state/WorkspaceProvider';
import { QuickFindButton } from './QuickFindButton';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { FavoritesSection } from './FavoritesSection';
import { TeamspacesSection } from './TeamspacesSection';
import { PrivateSection } from './PrivateSection';
import { PageTree } from './PageTree';
import { TrashModal } from './TrashModal';

/**
 * Collapsible left navigation drawer.
 *
 * Expanded: Quick Find, workspace switcher, Favorites / Teamspaces / Private
 * sections, the recursive page tree, and a trash footer. Collapsed: a slim
 * rail with a restore button — expandable again at any time.
 */
export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useWorkspace();

  if (sidebarCollapsed) {
    return (
      <aside
        aria-label="Navigation (collapsed)"
        className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-notion-border bg-notion-sidebar py-2"
      >
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="flex h-9 w-9 items-center justify-center rounded-shell text-notion-muted transition-colors hover:bg-notion-hover hover:text-notion-text"
        >
          <PanelLeftOpen className="h-5 w-5" aria-hidden />
        </button>
        <TrashModal compact />
      </aside>
    );
  }

  return (
    <aside
      aria-label="Navigation"
      className="flex h-full w-64 shrink-0 flex-col border-r border-notion-border bg-notion-sidebar transition-all duration-200 ease-in-out"
    >
      <div className="flex items-center gap-1 border-b border-notion-border px-2 pb-2 pt-2">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-shell text-notion-muted transition-colors hover:bg-notion-hover hover:text-notion-text"
        >
          <PanelLeftClose className="h-4 w-4" aria-hidden />
        </button>
        <QuickFindButton />
      </div>

      <WorkspaceSwitcher />

      <nav aria-label="Sidebar sections" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <FavoritesSection />
        <TeamspacesSection />
        <PrivateSection />
        <div className="mt-1 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-notion-muted">
          Pages
        </div>
        <PageTree />
      </nav>

      <div className="border-t border-notion-border p-2">
        <TrashModal />
      </div>
    </aside>
  );
}
