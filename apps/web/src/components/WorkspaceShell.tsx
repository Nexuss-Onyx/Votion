'use client';

import { useMemo } from 'react';
import { getRecordStore } from '@votion/sync-client';
import { QuickFindModal, QuickFindSearchService } from '@votion/search';

import { WorkspaceProvider, useWorkspace } from '@/state/WorkspaceProvider';
import { LocalSearchExecutor } from '@/lib/localSearch';
import { CURRENT_USER } from '@/lib/seed';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { TopBar } from '@/components/header/TopBar';
import { PageView } from '@/components/page/PageView';

/**
 * The Votion application shell.
 *
 * Layout: collapsible sidebar | top bar | scrollable page surface. All page
 * content reads through `@votion/sync-client`, so page switches are instant
 * and never touch the network.
 */
export function WorkspaceShell() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const {
    activeWorkspaceId,
    activePage,
    openPage,
    hydrated,
    quickFindOpen,
    setQuickFindOpen,
  } = useWorkspace();

  const store = getRecordStore();
  const searchService = useMemo(
    () => new QuickFindSearchService(new LocalSearchExecutor(store)),
    [store],
  );
  const scope = useMemo(
    () => ({
      userId: CURRENT_USER.id,
      spaceIds: [activeWorkspaceId],
    }),
    [activeWorkspaceId],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-white text-notion-text">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          {hydrated && activePage ? (
            <PageView key={activePage.id} page={activePage} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-notion-muted">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-notion-border border-t-notion-accent" />
              <p className="text-sm">Loading workspace…</p>
            </div>
          )}
        </main>
      </div>

      <QuickFindModal
        service={searchService}
        scope={scope}
        open={quickFindOpen}
        onOpenChange={setQuickFindOpen}
        onSelect={(hit) => {
          setQuickFindOpen(false);
          openPage(hit.id);
        }}
        spaceId={activeWorkspaceId}
        disabled={!hydrated}
        placeholder="Search pages and blocks…"
      />
    </div>
  );
}
