import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { renderShell, restoreDefaultStore } from './helpers';

describe('Sidebar', () => {
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    restoreDefaultStore();
  });

  it('renders the workspace switcher, favorites and the pages tree', async () => {
    renderShell(<Sidebar />);

    // Workspace switcher shows the active workspace name.
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toHaveTextContent('Nexus HQ');

    // Favorites section renders with the seeded header.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Favorites' })).toBeInTheDocument(),
    );

    // The Pages tree renders with a Home page treeitem.
    expect(screen.getByRole('tree', { name: 'Pages' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Home/ })).toBeInTheDocument();
  });

  it('collapses to a slim rail and expands again', async () => {
    const user = userEvent.setup();
    renderShell(<Sidebar />);

    const collapse = await screen.findByRole('button', { name: 'Collapse sidebar' });
    await user.click(collapse);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Navigation (collapsed)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
  });

  it('opens the Quick Find launcher without crashing', () => {
    renderShell(<Sidebar />);
    expect(screen.getByRole('button', { name: 'Open Quick Find' })).toBeEnabled();
  });
});
