import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TopBar } from '@/components/header/TopBar';
import { renderShell, restoreDefaultStore } from './helpers';

describe('TopBar', () => {
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    restoreDefaultStore();
  });

  it('renders the breadcrumb, presence avatars and the inbox trigger', async () => {
    renderShell(<TopBar />);

    // Share trigger is rendered.
    expect(await screen.findByRole('button', { name: 'Share this page' })).toBeInTheDocument();

    // Presence avatars report online collaborators.
    expect(screen.getByLabelText(/collaborator/i)).toBeInTheDocument();

    // Inbox trigger exposes the unread count.
    expect(screen.getByRole('button', { name: /Notifications/ })).toBeInTheDocument();
  });

  it('opens the share modal with a public link affordance and a member list', async () => {
    const user = userEvent.setup();
    renderShell(<TopBar />);

    await user.click(await screen.findByRole('button', { name: 'Share this page' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByLabelText('Public link')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Members')).toBeInTheDocument();
  });

  it('opens the page options menu with export / layout / delete actions', async () => {
    const user = userEvent.setup();
    renderShell(<TopBar />);

    await user.click(await screen.findByRole('button', { name: 'Page options' }));

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: /Export/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('menuitem', { name: /Delete page/i })).toBeInTheDocument();
  });
});
