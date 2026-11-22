'use client';

import { useState } from 'react';
import { ChevronRight, Users, Plus } from 'lucide-react';
import { useWorkspace } from '@/state/WorkspaceProvider';
import { isPageLike, pageTitle } from '@/lib/helpers';
import type { Block } from '@votion/types';
import { pageIcon } from './pageIcon';

/** Teamspaces — collapsible department groupings (Engineering, Design, …). */
export function TeamspacesSection() {
  const { teamspaces, getBlock, openPage, createTeamspace } = useWorkspace();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  if (teamspaces.length === 0) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createTeamspace(trimmed);
    setName('');
    setAdding(false);
  };

  return (
    <section aria-label="Teamspaces" className="mt-2">
      <header className="flex items-center gap-1.5 px-2 pb-1 pt-2">
        <Users className="h-3.5 w-3.5 text-notion-muted" aria-hidden />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-notion-muted">
          Teamspaces
        </h3>
        <button
          type="button"
          aria-label="Add teamspace"
          onClick={() => setAdding((value) => !value)}
          className="ml-auto rounded p-0.5 text-notion-muted transition-colors hover:bg-notion-hover hover:text-notion-text"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      {adding && (
        <form onSubmit={submit} className="mx-2 mb-1 flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Team name"
            aria-label="New teamspace name"
            className="h-7 min-w-0 flex-1 rounded-shell border border-notion-border px-2 text-xs outline-none focus:border-notion-accent"
          />
          <button
            type="submit"
            className="h-7 rounded-shell bg-notion-accent px-2 text-[11px] font-semibold text-white"
          >
            Add
          </button>
        </form>
      )}

      <ul className="flex flex-col gap-px">
        {teamspaces.map((teamspace) => {
          const isCollapsed = collapsed[teamspace.id] ?? false;
          const pages = teamspace.pageIds
            .map((id) => getBlock(id))
            .filter((block): block is Block => block !== undefined && block.alive && isPageLike(block));
          return (
            <li key={teamspace.id}>
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((current) => ({ ...current, [teamspace.id]: !isCollapsed }))}
                className="flex w-full items-center gap-2 rounded-shell px-2 py-1.5 text-left text-sm text-notion-text transition-colors hover:bg-notion-hover"
              >
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-notion-muted"
                  style={{ transform: isCollapsed ? undefined : 'rotate(90deg)' }}
                  aria-hidden
                />
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: teamspace.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-medium">{teamspace.name}</span>
                <span className="shrink-0 rounded-full bg-notion-hover px-1.5 py-0.5 text-[10px] font-medium text-notion-muted">
                  {pages.length}
                </span>
              </button>
              {!isCollapsed && pages.length > 0 && (
                <ul className="mb-1 ml-5 flex flex-col gap-px border-l border-notion-border pl-2">
                  {pages.map((page) => (
                    <li key={page.id}>
                      <button
                        type="button"
                        onClick={() => openPage(page.id)}
                        className="flex w-full items-center gap-2 rounded-shell px-1.5 py-1 text-left text-[13px] text-notion-text transition-colors hover:bg-notion-hover"
                      >
                        <span aria-hidden>{pageIcon(page)}</span>
                        <span className="min-w-0 flex-1 truncate">{pageTitle(page)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
