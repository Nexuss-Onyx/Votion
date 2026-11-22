'use client';

import { useEffect, useState } from 'react';
import { Check, RotateCcw, Send, X } from 'lucide-react';
import type { InlineComment } from '@/lib/types';
import { CURRENT_USER } from '@/lib/seed';
import { formatRelativeTime } from '@/lib/helpers';

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface AnchorRequest {
  blockId: string;
  anchor: string;
}

interface InlineCommentOverlayProps {
  /** The clicked anchor — when non-null, the popover is visible. */
  request: AnchorRequest | null;
  /** Viewport rect of the anchor, used to position the popover. */
  rect: AnchorRect | null;
  /** Inline comments of the active page. */
  comments: InlineComment[];
  onClose: () => void;
  /** Create a new comment anchored to `anchor` (or reply to nothing). */
  onAdd: (blockId: string, anchor: string, body: string) => void;
  onToggleResolve: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onReply: (id: string, body: string) => void;
  onUpdateBody: (id: string, body: string) => void;
}

/**
 * Floating inline-comment popover. Anchored near the highlighted span the user
 * clicked: when the span already carries a comment, the popover edits that
 * thread; otherwise it composes a new one.
 */
export function InlineCommentOverlay({
  request,
  rect,
  comments,
  onClose,
  onAdd,
  onToggleResolve,
  onReact,
  onReply,
  onUpdateBody,
}: InlineCommentOverlayProps) {
  const [draft, setDraft] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');

  // Close on Escape.
  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onClose]);

  // Reset composer state whenever the anchor changes.
  useEffect(() => {
    setDraft('');
    setReplyDraft('');
    setIsEditing(false);
  }, [request?.anchor, request?.blockId]);

  if (!request) return null;

  const existing = comments.find(
    (comment) =>
      comment.pageId && comment.blockId === request.blockId && comment.anchor === request.anchor,
  );

  const anchorTop = rect?.top ?? 80;
  const anchorBottom = rect?.bottom ?? 120;
  const anchorLeft = rect?.left ?? 24;

  // Viewport-safe placement: prefer below the anchor; flip above when the
  // popover would overflow the bottom of the viewport.
  const popoverHeight = 260;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const flipAbove = anchorBottom + 12 + popoverHeight > viewportHeight;
  const top = flipAbove
    ? Math.max(8, anchorTop - popoverHeight - 12)
    : anchorBottom + 12;
  const left = Math.max(8, Math.min(anchorLeft, (typeof window === 'undefined' ? 400 : window.innerWidth) - 380));

  const submitInline = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(request.blockId, request.anchor, trimmed);
    setDraft('');
  };

  const submitReply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!existing) return;
    const trimmed = replyDraft.trim();
    if (!trimmed) return;
    onReply(existing.id, trimmed);
    setReplyDraft('');
  };

  return (
    <div
      role="dialog"
      aria-label={existing ? 'Inline comment' : 'Add inline comment'}
      style={{ position: 'fixed', zIndex: 60, top, left, width: 360, maxWidth: 'calc(100vw - 24px)' }}
      className="overflow-hidden rounded-2xl border border-notion-border bg-white shadow-popLg"
    >
      <header className="flex items-center gap-2 border-b border-notion-border px-3.5 py-2.5">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-semibold text-white"
          style={{ backgroundColor: existing?.author.color ?? CURRENT_USER.color }}
          aria-hidden
        >
          {existing?.author.initials ?? CURRENT_USER.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-notion-text">
            {existing ? existing.author.name : CURRENT_USER.name}
          </p>
          <p className="truncate text-[10px] text-notion-muted">
            {existing ? `Comment · ${formatRelativeTime(existing.createdAt)}` : 'New comment'}
          </p>
        </div>
        {existing && (
          <button
            type="button"
            onClick={() => onToggleResolve(existing.id)}
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              existing.resolved ? 'bg-green-100 text-green-800' : 'bg-notion-hover text-notion-muted'
            }`}
          >
            {existing.resolved ? (
              <>
                <Check className="h-3 w-3" aria-hidden /> Resolved
              </>
            ) : (
              <>
                <RotateCcw className="h-3 w-3" aria-hidden /> Unresolved
              </>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comment"
          className="rounded p-1 text-notion-muted transition-colors hover:bg-notion-hover"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="max-h-64 overflow-y-auto px-3.5 py-3">
        {existing ? (
          <>
            {isEditing ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = editDraft.trim();
                  if (trimmed) onUpdateBody(existing.id, trimmed);
                  setIsEditing(false);
                }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={editDraft}
                  onChange={(event) => setEditDraft(event.target.value)}
                  aria-label="Edit comment"
                  className="h-8 min-w-0 flex-1 rounded-shell border border-notion-border px-2 text-sm outline-none focus:border-notion-accent"
                />
                <button type="submit" className="rounded-shell bg-notion-accent px-2.5 py-1 text-[11px] font-semibold text-white">
                  Save
                </button>
              </form>
            ) : (
              <p
                className="cursor-text rounded-shell px-1 text-sm leading-6 text-notion-text"
                onClick={() => {
                  setEditDraft(existing.body);
                  setIsEditing(true);
                }}
                title="Click to edit"
              >
                {existing.body}
              </p>
            )}

            {Object.entries(existing.reactions).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(existing.reactions).map(([emoji, count]) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onReact(existing.id, emoji)}
                    className="rounded-full border border-notion-border bg-white px-2 py-0.5 text-xs transition-colors hover:border-notion-accent"
                  >
                    <span aria-hidden>{emoji}</span>{' '}
                    <span className="tabular-nums text-notion-muted">{count}</span>
                  </button>
                ))}
              </div>
            )}

            {existing.replies.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2 border-l border-notion-border pl-2.5">
                {existing.replies.map((reply) => (
                  <li key={reply.id}>
                    <p className="text-[11px] font-semibold text-notion-text">{reply.author.name}</p>
                    <p className="text-[13px] leading-5 text-notion-text">{reply.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[13px] leading-6 text-notion-text">
            <span className="font-semibold">Highlight:</span> “{request.anchor}”
          </p>
        )}
      </div>

      {existing ? (
        <form onSubmit={submitReply} className="flex items-center gap-2 border-t border-notion-border px-3.5 py-2.5">
          <input
            type="text"
            value={replyDraft}
            onChange={(event) => setReplyDraft(event.target.value)}
            placeholder="Reply…"
            aria-label="Reply to inline comment"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-notion-disabled"
          />
          <button
            type="submit"
            disabled={!replyDraft.trim()}
            className="flex h-8 items-center gap-1 rounded-shell bg-notion-accent px-2.5 text-[11px] font-semibold text-white hover:bg-notion-accentOn disabled:opacity-40"
          >
            <Send className="h-3 w-3" aria-hidden />
            Reply
          </button>
        </form>
      ) : (
        <form onSubmit={submitInline} className="flex items-center gap-2 border-t border-notion-border px-3.5 py-2.5">
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-notion-disabled"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="flex h-8 items-center gap-1 rounded-shell bg-notion-accent px-2.5 text-[11px] font-semibold text-white hover:bg-notion-accentOn disabled:opacity-40"
          >
            <Send className="h-3 w-3" aria-hidden />
            Post
          </button>
        </form>
      )}
    </div>
  );
}
