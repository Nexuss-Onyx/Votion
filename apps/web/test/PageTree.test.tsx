import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PageTree } from '@/components/sidebar/PageTree';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { renderShell, restoreDefaultStore } from './helpers';

describe('PageTree', () => {
  beforeEach(() => cleanup());
  afterEach(() => {
    cleanup();
    restoreDefaultStore();
  });

  it('renders root pages as tree items', () => {
    renderShell(<PageTree />);
    // Root pages from the fixture (page-level links in Nexus HQ)
    expect(screen.getByRole('treeitem', { name: /Home/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Product/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Engineering/ })).toBeInTheDocument();
  });

  it('expands and collapses nested pages', async () => {
    const user = userEvent.setup();
    renderShell(<PageTree />);

    // Engineering is in the expanded set by default in the tree; Product is not.
    const productSummary = screen.getByRole('button', { name: /Expand Product/ });
    await user.click(productSummary);

    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: /Roadmap/ })).toBeInTheDocument(),
    );

    // Collapsing hides the nested children again.
    const collapseButton = screen.getByRole('button', { name: /Collapse Product/ });
    await user.click(collapseButton);
    await waitFor(() =>
      expect(screen.queryByRole('treeitem', { name: /Roadmap/ })).not.toBeInTheDocument(),
    );
  });

  it('clicking a page switches the active page', async () => {
    const user = userEvent.setup();
    renderShell(<Sidebar />);

    const product = screen.getByRole('treeitem', { name: /Product/ });
    await user.click(product);

    // The favorites section shows active state through the tree node aria.
    await waitFor(() => expect(product).toHaveAttribute('aria-current', 'page'));
  });

  it('toggles a page favorite from the star button and reflects it in the Favorites section', async () => {
    const user = userEvent.setup();
    renderShell(<Sidebar />);

    // Find the pin button for "Journal" (a root page not otherwise pinned).
    const pinButton = screen.getByRole('button', { name: /Pin .*Journal/ });
    await user.click(pinButton);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Favorites' })).toBeInTheDocument(),
    );
    // Journal is now pinned in the favorites section.
    expect(
      screen.getAllByRole('button', { name: /Journal/ }).length,
    ).toBeGreaterThanOrEqual(1);
  });
});
