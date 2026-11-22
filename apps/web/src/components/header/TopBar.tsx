'use client';

import { Breadcrumbs } from './Breadcrumbs';
import { PresenceAvatars } from './PresenceAvatars';
import { ShareModal, ShareTriggerButton } from './ShareModal';
import { NotificationInbox } from '@/components/inbox/NotificationInbox';
import { PageOptionsMenu } from './PageOptionsMenu';

/**
 * Sticky top bar: the active breadcrumb, live presence, share, inbox and the
 * page options (`…`) menu.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-notion-border bg-white/95 px-3 backdrop-blur">
      <Breadcrumbs />
      <div className="flex shrink-0 items-center gap-1.5">
        <PresenceAvatars />
        <ShareModal trigger={<ShareTriggerButton aria-label="Share this page" />} />
        <NotificationInbox />
        <PageOptionsMenu />
      </div>
    </header>
  );
}
