'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bell, UserPlus, AtSign, MessageSquare, Check } from 'lucide-react';
import { getRecordStore } from '@votion/sync-client';
import { useWorkspace } from '@/state/WorkspaceProvider';
import { formatRelativeTime } from '@/lib/helpers';
import type { ShellNotification } from '@/lib/types';

function kindIcon(kind: ShellNotification['kind']) {
  switch (kind) {
    case 'mention':
      return <AtSign className="h-3.5 w-3.5" aria-hidden />;
    case 'reply':
      return <MessageSquare className="h-3.5 w-3.5" aria-hidden />;
    case 'invite':
      return <UserPlus className="h-3.5 w-3.5" aria-hidden />;
  }
}

/**
 * Notification inbox — mentions, replies and invites with unread badges.
 * Clicking a row marks it read and navigates to its page.
 */
export function NotificationInbox() {
  const {
    notifications,
    unreadNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    openPage,
    setActiveWorkspaceId,
    workspaces,
  } = useWorkspace();

  const handleSelect = (notification: ShellNotification) => {
    markNotificationRead(notification.id);
    if (!notification.pageId) return;
    const block = getRecordStore().getState().blocks[notification.pageId];
    if (block) {
      openPage(block.id);
      return;
    }
    // A workspace-scoped invite (e.g. Alan was added to Design Lab).
    if (workspaces.some((workspace) => workspace.id === notification.pageId)) {
      setActiveWorkspaceId(notification.pageId);
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Notifications${unreadNotifications > 0 ? ` (${unreadNotifications} unread)` : ''}`}
        className="relative flex h-8 w-8 items-center justify-center rounded-shell text-notion-muted transition-colors hover:bg-notion-hover hover:text-notion-text"
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadNotifications > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-semibold leading-none text-white">
            {unreadNotifications}
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 max-h-[75vh] w-80 overflow-hidden rounded-xl border border-notion-border bg-white shadow-pop outline-none"
        >
          <div className="flex items-center justify-between border-b border-notion-border px-3 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-notion-muted">
              Notifications
            </span>
            <button
              type="button"
              onClick={markAllNotificationsRead}
              className="flex items-center gap-1 rounded-shell px-2 py-1 text-[11px] font-medium text-notion-muted transition-colors hover:bg-notion-hover hover:text-notion-text"
            >
              <Check className="h-3 w-3" aria-hidden />
              Mark all read
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-notion-muted">
                You are all caught up.
              </div>
            ) : (
              <ul className="flex flex-col gap-1 p-2">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(notification)}
                      className="flex w-full items-start gap-2.5 rounded-shell px-2 py-2 text-left transition-colors hover:bg-notion-hover"
                    >
                      <span
                        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{ backgroundColor: `${notification.authorColor}22`, color: notification.authorColor }}
                        aria-hidden
                      >
                        {kindIcon(notification.kind)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-notion-text">
                          {notification.title}
                        </span>
                        <span className="block truncate text-[11px] text-notion-muted">
                          {notification.body}
                        </span>
                        <span className="block text-[10px] text-notion-disabled">
                          {formatRelativeTime(notification.createdAt)}
                        </span>
                      </span>
                      {notification.unread && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-notion-accent" aria-hidden />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
