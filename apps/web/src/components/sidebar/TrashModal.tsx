'use client';

import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, Trash2, Undo2, AlertTriangle } from 'lucide-react';

import { useWorkspace } from '@/state/WorkspaceProvider';
import { pageTitle } from '@/lib/helpers';
import { formatRelativeTime } from '@/lib/helpers';
import { pageIcon } from './pageIcon';

/**
 * Trash manager — searchable list of soft-deleted pages with per-page
 * restore and permanent purge actions.
 */
export function TrashModal({ compact = false }: { compact?: boolean }) {
  const { trashPages, restorePage, purgePage } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return trashPages;
    return trashPages.filter((page) => pageTitle(page).toLowerCase().includes(needle));
  }, [trashPages, query]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Open trash"
          className={compact
            ? 'flex h-9 w-9 items-center justify-center rounded-shell text-notion-muted transition-colors hover:bg-notion-hover hover:text-notion-text'
            : 'flex w-full items-center gap-2 rounded-shell px-3 py-2 text-sm text-notion-muted transition-colors hover:bg-notion-hover hover:text-notion-text'}
        >
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
          {!compact && (
            <>
              <span className="min-w-0 flex-1 truncate text-left">Trash</span>
              {trashPages.length > 0 && (
                <span className="rounded-full bg-notion-hover px-1.5 py-0.5 text-[10px] font-semibold text-notion-muted">
                  {trashPages.length}
                </span>
              )}
            </>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed bottom-6 left-1/2 z-50 flex max-h-[80vh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-notion-border bg-white shadow-popLg outline-none"
        >
          <header className="flex items-center justify-between border-b border-notion-border px-5 py-4">
            <Dialog.Title className="text-base font-semibold text-notion-text">
              Trash
            </Dialog.Title>
            <Dialog.Close className="rounded-shell p-1 text-notion-muted transition-colors hover:bg-notion-hover" aria-label="Close trash">
              <span className="block h-5 w-5" aria-hidden />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </header>

          <div className="border-b border-notion-border px-5 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-notion-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search trash…"
                aria-label="Search trash"
                className="h-9 w-full rounded-shell border border-notion-border bg-notion-hover/50 pl-9 pr-3 text-sm outline-none focus:border-notion-accent focus:bg-white"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-notion-muted">
                <Trash2 className="h-8 w-8 text-notion-disabled" aria-hidden />
                <p className="text-sm">The trash is empty.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((page) => (
                  <li
                    key={page.id}
                    className="flex items-center gap-3 rounded-shell border border-notion-border bg-white px-3 py-2.5"
                  >
                    <span className="text-lg" aria-hidden>{pageIcon(page)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-notion-text">{pageTitle(page)}</p>
                      <p className="text-[11px] text-notion-muted">
                        Deleted {formatRelativeTime(page.last_edited_time)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => restorePage(page.id)}
                      className="flex items-center gap-1.5 rounded-shell border border-notion-border px-2.5 py-1.5 text-xs font-medium text-notion-text transition-colors hover:bg-notion-hover"
                    >
                      <Undo2 className="h-3.5 w-3.5" aria-hidden />
                      Restore
                    </button>
                    {confirmId === page.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            purgePage(page.id);
                            setConfirmId(null);
                          }}
                          className="flex items-center gap-1.5 rounded-shell bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="rounded-shell px-2 py-1.5 text-xs font-medium text-notion-muted hover:bg-notion-hover"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Delete ${pageTitle(page)} forever`}
                        onClick={() => setConfirmId(page.id)}
                        className="rounded-shell border border-notion-border p-1.5 text-notion-muted transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
