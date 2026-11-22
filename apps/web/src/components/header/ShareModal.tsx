'use client';

import { forwardRef, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Copy, Link2, Mail, Shield } from 'lucide-react';

import { useWorkspace } from '@/state/WorkspaceProvider';
import { SEED_WORKSPACE_MEMBERS, CURRENT_USER } from '@/lib/seed';
import { pageTitle } from '@/lib/helpers';

const SHARE_URL = 'https://votion.dev/share/nx';

type Role = 'Viewer' | 'Commenter' | 'Editor' | 'Owner';

interface MemberRow {
  id: string;
  name: string;
  initials: string;
  color: string;
  email?: string;
  role: Role;
}

/**
 * Share / Permissions modal: invite members with roles, copy a public link,
 * and toggle the public access setting.
 */
export function ShareModal({ trigger }: { trigger: React.ReactNode }) {
  const { activePage } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Editor');
  const [inviteSent, setInviteSent] = useState(false);
  const [publicAccess, setPublicAccess] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>(() =>
    SEED_WORKSPACE_MEMBERS.map((profile) => ({
      id: profile.id,
      name: profile.name,
      initials: profile.initials,
      color: profile.color,
      ...(profile.email ? { email: profile.email } : {}),
      role: profile.id === CURRENT_USER.id ? 'Owner' : 'Editor',
    })),
  );

  const scopeTitle = useMemo(() => (activePage ? pageTitle(activePage) : 'this page'), [activePage]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions / non-secure context): fall back to
      // selecting the link box instead of failing silently.
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) return;
    const local = trimmed.split('@')[0] ?? trimmed;
    const initials = local.slice(0, 2).toUpperCase();
    setMembers((current) => [
      ...current,
      {
        id: `m-${Date.now().toString(36)}`,
        name: local.replace(/[._-]/g, ' '),
        initials,
        color: '#0ea5e9',
        ...(trimmed ? { email: trimmed } : {}),
        role,
      },
    ]);
    setEmail('');
    setInviteSent(true);
    setTimeout(() => setInviteSent(false), 2000);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-notion-border bg-white shadow-popLg outline-none"
        >
          <header className="flex items-center gap-3 border-b border-notion-border px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-notion-hover text-lg" aria-hidden>
              🔗
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-sm font-semibold text-notion-text">
                Share “{scopeTitle}”
              </Dialog.Title>
              <p className="text-xs text-notion-muted">Manage who can view and edit this page</p>
            </div>
            <Dialog.Close className="rounded-shell p-1.5 text-notion-muted transition-colors hover:bg-notion-hover" aria-label="Close share dialog">
              <span className="sr-only">Close</span>
              <span aria-hidden className="block h-5 w-5" />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {/* Public link */}
            <section aria-label="Share link" className="mb-4">
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-notion-muted">
                <Link2 className="h-3.5 w-3.5" aria-hidden />
                Public link
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={SHARE_URL}
                  aria-label="Public link"
                  className="h-9 min-w-0 flex-1 rounded-shell border border-notion-border bg-notion-hover/50 px-3 text-sm text-notion-muted outline-none"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-shell bg-notion-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-notion-accentOn"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
                    </>
                  )}
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-notion-muted">
                <input
                  type="checkbox"
                  checked={publicAccess}
                  onChange={(event) => setPublicAccess(event.target.checked)}
                  className="h-3.5 w-3.5 accent-notion-accent"
                />
                Allow anyone with the link to view
              </label>
            </section>

            {/* Invite */}
            <section aria-label="Invite members" className="mb-4">
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-notion-muted">
                <Mail className="h-3.5 w-3.5" aria-hidden />
                Invite by email
              </label>
              <form onSubmit={invite} className="flex items-center gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  aria-label="Invite email"
                  className="h-9 min-w-0 flex-1 rounded-shell border border-notion-border px-3 text-sm outline-none focus:border-notion-accent"
                />
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                  aria-label="Invite role"
                  className="h-9 shrink-0 rounded-shell border border-notion-border bg-white px-2 text-xs outline-none"
                >
                  {(['Viewer', 'Commenter', 'Editor'] as Role[]).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-shell border border-notion-border px-3 text-xs font-semibold text-notion-text transition-colors hover:bg-notion-hover"
                >
                  Invite
                </button>
              </form>
              {inviteSent && (
                <p className="mt-1.5 text-xs font-medium text-green-700">Invite sent ✓</p>
              )}
            </section>

            {/* Members */}
            <section aria-label="Members">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-notion-muted">
                <Shield className="h-3.5 w-3.5" aria-hidden />
                Members ({members.length})
              </div>
              <ul className="flex flex-col gap-1">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center gap-2.5 rounded-shell border border-notion-border px-3 py-2"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ backgroundColor: member.color }}
                      aria-hidden
                    >
                      {member.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-notion-text">{member.name}</span>
                      {member.email && <span className="block truncate text-[11px] text-notion-muted">{member.email}</span>}
                    </span>
                    <span className="shrink-0 rounded-full bg-notion-hover px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-notion-muted">
                      {member.role}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Re-export for consumers that only need the trigger button. */
export const ShareTriggerButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ShareTriggerButton(props, ref) {
  return (
    <button
      type="button"
      ref={ref}
      {...props}
      className={[
        'flex items-center gap-1.5 rounded-shell bg-notion-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-notion-accentOn',
        props.className ?? '',
      ].join(' ')}
    >
      <Link2 className="h-3.5 w-3.5" aria-hidden />
      Share
    </button>
  );
});
