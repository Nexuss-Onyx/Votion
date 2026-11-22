'use client';

import { useState } from 'react';
import { Check, Pencil, Reply, RotateCcw, Send, SmilePlus, X } from 'lucide-react';

import { useWorkspace } from '@/state/WorkspaceProvider';
import { formatRelativeTime } from '@/lib/helpers';
import type { DiscussionThread } from '@/lib/types';

const REACTION_OPTIONS = ['🎉', '🚀', '👏', '❤️', '🙂'];

/**
 * Threaded page discussion — the comment stream pinned at the top of the page.
 * Supports threading, replies, emoji reactions, resolve and inline edit.
 */
export function PageDiscussion({ pageId }: { pageId: string }) {
  const {
    getThreadsForPage,
    addThread,
    addThreadReply,
    toggleThreadResolved,
    reactToThread,
    updateThreadBody,
  } = useWorkspace();

  const threads = getThreadsForPage(pageId);
  const [draft, setDraft] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    addThread(pageId, trimmed);
    setDraft('');
  };

  return (
    <section aria-label="Page discussion" className="mt-8 border-t border-notion-border pt-6">
      <div className="flex items-center gap-2 pb-4">
        <h2 className="text-base font-semibold text-notion-text">💬 Discussion</h2>
        <span className="rounded-full bg-notion-hover px-2 py-0.5 text-[11px] font-semibold text-notion-muted">
          {threads.length}
        </span>
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-shell border border-notion-border bg-white px-3 py-1 focus-within:border-notion-accent">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment to this page…"
            aria-label="Add a discussion comment"
            className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-notion-disabled"
          />
        </div>
        <button
          type="submit"
          disabled={draft.trim().length === 0}
          className="flex h-9 items-center gap-1.5 rounded-shell bg-notion-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-notion-accentOn disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Post
        </button>
      </form>

      {threads.length === 0 ? (
        <p className="mt-4 text-sm text-notion-muted">No discussion yet — share an idea or a question.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <ThreadCard
                thread={thread}
                onReply={(body) => addThreadReply(thread.id, body)}
                onToggleResolved={() => toggleThreadResolved(thread.id)}
                onReact={(emoji) => reactToThread(thread.id, emoji)}
                onUpdateBody={(body) => updateThreadBody(thread.id, body)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ThreadCard({
  thread,
  onReply,
  onToggleResolved,
  onReact,
  onUpdateBody,
}: {
  thread: DiscussionThread;
  onReply: (body: string) => void;
  onToggleResolved: () => void;
  onReact: (emoji: string) => void;
  onUpdateBody: (body: string) => void;
}) {
  const [replyDraft, setReplyDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(thread.body);

  const submitReply = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    onReply(trimmed);
    setReplyDraft('');
  };

  const submitEdit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = editDraft.trim();
    if (!trimmed || trimmed === thread.body) {
      setEditing(false);
      return;
    }
    onUpdateBody(trimmed);
    setEditing(false);
  };

  return (
    <div
      className={`rounded-shell border px-4 py-3 transition-colors ${
        thread.resolved ? 'border-notion-border bg-notion-hover/40' : 'border-notion-border bg-white'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
          style={{ backgroundColor: thread.author.color }}
          aria-hidden
        >
          {thread.author.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-notion-text">{thread.author.name}</span>
            <span className="text-[11px] text-notion-muted">{formatRelativeTime(thread.createdAt)}</span>
            {thread.resolved && (
              <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800">
                <Check className="h-3 w-3" aria-hidden />
                Resolved
              </span>
            )}
          </div>
          {editing ? (
            <form onSubmit={submitEdit} className="mt-1 flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
                aria-label="Edit comment"
                className="h-8 min-w-0 flex-1 rounded-shell border border-notion-accent px-2 text-sm outline-none"
              />
              <button
                type="submit"
                className="flex h-8 w-8 items-center justify-center rounded-shell bg-notion-accent text-white"
                aria-label="Save comment"
              >
                <Check className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditDraft(thread.body);
                  setEditing(false);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-shell border border-notion-border text-notion-muted"
                aria-label="Cancel editing"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </form>
          ) : (
            <div className="group/body flex items-start gap-1.5">
              <p className={`flex-1 text-sm leading-6 ${thread.resolved ? 'text-notion-muted line-through' : 'text-notion-text'}`}>
                {thread.body}
              </p>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit comment"
                className="mt-1 rounded p-1 text-notion-muted opacity-0 transition-opacity group-hover/body:opacity-100 hover:text-notion-text"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reaction chips */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {Object.entries(thread.reactions)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 4)
          .map(([emoji, count]) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onReact(emoji)}
              className="flex items-center gap-1 rounded-full border border-notion-border bg-white px-2 py-0.5 text-xs transition-colors hover:border-notion-accent"
            >
              <span aria-hidden>{emoji}</span>
              <span className="tabular-nums text-notion-muted">{count}</span>
            </button>
          ))}
        <div className="flex items-center gap-1 text-[11px] text-notion-muted">
          <SmilePlus className="h-3.5 w-3.5" aria-hidden />
          {REACTION_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              onClick={() => onReact(emoji)}
              className="rounded-full px-1 text-base transition-transform hover:scale-125"
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Reply composer */}
      <form onSubmit={submitReply} className="mt-2 flex items-center gap-2">
        <Reply className="h-3.5 w-3.5 text-notion-muted" aria-hidden />
        <input
          type="text"
          value={replyDraft}
          onChange={(event) => setReplyDraft(event.target.value)}
          placeholder={thread.resolved ? 'Add a reply…' : 'Reply…'}
          aria-label={`Reply to ${thread.author.name}'s comment`}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-notion-disabled"
        />
        {replyDraft.trim() && (
          <button
            type="submit"
            className="rounded-shell bg-notion-accent px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-notion-accentOn"
          >
            Reply
          </button>
        )}
      </form>

      {/* Replies */}
      {thread.replies.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2 border-l border-notion-border pl-3">
          {thread.replies.map((reply) => (
            <li key={reply.id} className="flex items-start gap-2">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                style={{ backgroundColor: reply.author.color }}
                aria-hidden
              >
                {reply.author.initials}
              </span>
              <div className="min-w-0">
                <span className="text-xs font-semibold text-notion-text">{reply.author.name}</span>
                <span className="ml-1.5 text-[10px] text-notion-muted">{formatRelativeTime(reply.createdAt)}</span>
                <p className="text-[13px] leading-5 text-notion-text">{reply.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleResolved}
          className={`flex items-center gap-1.5 rounded-shell px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            thread.resolved
              ? 'border border-notion-border text-notion-muted hover:text-notion-text'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {thread.resolved ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Reopen
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              Mark resolved
            </>
          )}
        </button>
      </div>
    </div>
  );
}
