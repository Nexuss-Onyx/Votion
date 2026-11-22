'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useWorkspace } from '@/state/WorkspaceProvider';

/**
 * Workspace switcher dropdown — lets the user hop between workspaces, or
 * create a fresh one, from the top of the sidebar.
 */
export function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, setActiveWorkspaceId, createWorkspace } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createWorkspace(trimmed);
    setName('');
    setCreating(false);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="mx-2 my-1 flex w-[calc(100%-16px)] items-center gap-2 rounded-shell border border-transparent px-2.5 py-2 text-left transition-colors hover:bg-notion-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-notion-accent"
        aria-label="Switch workspace"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base"
          style={{ backgroundColor: `${activeWorkspace.color}1f` }}
          aria-hidden
        >
          {activeWorkspace.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-notion-text">
            {activeWorkspace.name}
          </span>
          <span className="block text-[11px] leading-tight text-notion-muted">
            {workspaces.length} workspace{workspaces.length === 1 ? '' : 's'}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-notion-muted" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="z-50 w-72 overflow-hidden rounded-xl border border-notion-border bg-white shadow-pop"
        >
          <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-notion-muted">
            Workspaces
          </div>
          <div className="max-h-56 overflow-y-auto pb-1">
            {workspaces.map((workspace) => (
              <DropdownMenu.Item
                key={workspace.id}
                onSelect={() => setActiveWorkspaceId(workspace.id)}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm outline-none transition-colors hover:bg-notion-hover data-[highlighted]:bg-notion-hover"
              >
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-md text-xs"
                  style={{ backgroundColor: `${workspace.color}1f` }}
                  aria-hidden
                >
                  {workspace.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {workspace.id === activeWorkspace.id && (
                  <Check className="h-4 w-4 text-notion-accent" aria-hidden />
                )}
              </DropdownMenu.Item>
            ))}
          </div>
          <div className="border-t border-notion-border p-2">
            {creating ? (
              <form onSubmit={submit} className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Workspace name"
                  className="h-8 min-w-0 flex-1 rounded-shell border border-notion-border px-2 text-sm outline-none focus:border-notion-accent focus:ring-1 focus:ring-notion-accent"
                  aria-label="New workspace name"
                />
                <button
                  type="submit"
                  className="h-8 rounded-shell bg-notion-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-notion-accentOn"
                >
                  Create
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-shell px-2.5 py-2 text-sm text-notion-text transition-colors hover:bg-notion-hover"
              >
                <Plus className="h-4 w-4 text-notion-muted" aria-hidden />
                Create workspace
              </button>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
