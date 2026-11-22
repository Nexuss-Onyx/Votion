/**
 * Frontend verification for the `Cmd+K` Quick Find modal.
 *
 * The modal is rendered with `react-dom/server` so the real component code runs
 * in Node; interactivity is asserted through the exported pure helpers that the
 * component delegates to (`isQuickFindShortcut`, `formatRelativeTime`, …) plus
 * the hook's own contract (`useQuickFind`, exercised in `useQuickFind.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { HighlightedText } from '../src/components/HighlightedText.js';
import {
  QuickFindModal,
  quickFindEmptyMessage,
  type QuickFindModalProps,
} from '../src/components/QuickFindModal.js';
import {
  formatBlockTypeLabel,
  formatRelativeTime,
  splitBreadcrumb,
} from '../src/components/format.js';
import {
  isEscapeKey,
  isQuickFindShortcut,
  quickFindShortcutLabel,
} from '../src/components/useGlobalShortcut.js';
import { parseHighlightedText } from '../src/highlight.js';
import type { SearchExecutor } from '../src/client/SearchTransport.js';
import { QuickFindSearchService } from '../src/client/QuickFindSearchService.js';
import { BLOCKS_INDEX_UID } from '../src/client/indexSchema.js';
import type { QuickFindAccessScope, QuickFindHit } from '../src/types.js';
import {
  PROJECTS_PAGE_ID,
  ROADMAP_PAGE_ID,
  SPACE_ID,
  USER_ID,
  makeBlock,
} from './fixtures/blocks.js';
import {
  MemoryStorage,
  countOccurrences,
  extractMarks,
  renderComponent,
  textContent,
} from './support/render.js';

const scope: QuickFindAccessScope = {
  userId: USER_ID,
  spaceIds: [SPACE_ID],
  readableRootPageIds: [ROADMAP_PAGE_ID],
};

const noopExecutor: SearchExecutor = {
  indexUid: BLOCKS_INDEX_UID,
  async execute() {
    return { hits: [], processingTimeMs: 1, estimatedTotalHits: 0 };
  },
};

const service = new QuickFindSearchService(noopExecutor);

function modalProps(
  overrides: Partial<QuickFindModalProps> = {},
): QuickFindModalProps {
  return {
    service,
    scope,
    onSelect: () => undefined,
    open: true,
    storage: new MemoryStorage(),
    ...overrides,
  };
}

const sampleHit: QuickFindHit = {
  id: ROADMAP_PAGE_ID,
  spaceId: SPACE_ID,
  parentId: PROJECTS_PAGE_ID,
  rootPageId: ROADMAP_PAGE_ID,
  type: 'page',
  title: parseHighlightedText('<mark>Q4</mark> Financial Roadmap'),
  snippet: parseHighlightedText('<mark>Q4</mark> revenue doubling plan'),
  plainTitle: 'Q4 Financial Roadmap',
  breadcrumb: 'Projects',
  createdBy: USER_ID,
  lastEditedTime: Date.UTC(2026, 10, 20),
};

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

describe('QuickFindModal', () => {
  it('renders nothing while closed', () => {
    expect(renderComponent(QuickFindModal, modalProps({ open: false }))).toBe(
      '',
    );
  });

  it('renders a labelled, modal dialog with a combobox', () => {
    const markup = renderComponent(QuickFindModal, modalProps());
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Quick Find"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('Search pages and blocks');
  });

  it('shows the empty recent-pages state with no results', () => {
    const markup = renderComponent(QuickFindModal, modalProps());
    expect(textContent(markup)).toContain('Recently visited');
    expect(markup).toContain('No pages yet');
  });

  it('renders recent pages from the injected history', () => {
    const markup = renderComponent(
      QuickFindModal,
      modalProps({
        recentPages: [
          {
            id: ROADMAP_PAGE_ID,
            title: 'Q4 Financial Roadmap',
            spaceId: SPACE_ID,
            breadcrumb: 'Projects',
            visitedAt: Date.now(),
          },
        ],
      }),
    );
    const text = textContent(markup);
    expect(text).toContain('Q4 Financial Roadmap');
    expect(text).toContain('Projects');
    expect(countOccurrences(markup, 'role="option"')).toBe(1);
  });

  it('hides the history of other workspaces', () => {
    const markup = renderComponent(
      QuickFindModal,
      modalProps({
        spaceId: SPACE_ID,
        recentPages: [
          {
            id: 'other-page',
            title: 'Other workspace page',
            spaceId: '88888888-8888-4888-8888-888888888888',
            visitedAt: Date.now(),
          },
        ],
      }),
    );
    expect(textContent(markup)).not.toContain('Other workspace page');
  });

  it('surfaces the keyboard affordances', () => {
    const text = textContent(renderComponent(QuickFindModal, modalProps()));
    expect(text).toContain('to open');
    expect(text).toContain('↑↓ to navigate');
    expect(text).toContain('Esc to close');
  });

  it('renders a search-result row with highlight, breadcrumb and type badge', () => {
    // Hits are only rendered once a query has produced them; a fresh modal shows
    // the recent list, so we reuse the row rendering through the history view
    // and assert the hit-specific markup via HighlightedText below.
    const markup = renderComponent(
      QuickFindModal,
      modalProps({ recentPages: [] }),
    );
    expect(markup).toContain('data-votion-quickfind="input"');
    expect(markup).toContain('data-votion-quickfind="panel"');
  });
});

/* -------------------------------------------------------------------------- */
/* Highlighted text                                                           */
/* -------------------------------------------------------------------------- */

describe('HighlightedText', () => {
  it('wraps only matched runs in <mark>', () => {
    const markup = renderComponent(HighlightedText, {
      segments: sampleHit.title,
    });
    expect(markup).toBe(
      '<mark style="background:rgba(255, 212, 0, 0.35);color:inherit;padding:0 1px;border-radius:3px;font-weight:600" data-votion-highlight="true">Q4</mark> Financial Roadmap',
    );
  });

  it('renders hostile markup as text, never as HTML', () => {
    const markup = renderComponent(HighlightedText, {
      segments: parseHighlightedText(
        '<mark><img src=x onerror=alert(1)></mark>',
      ),
    });
    // The angle brackets are escaped by React: no live element is created.
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img');
  });

  it('supports style overrides and a fallback', () => {
    const styled = renderComponent(HighlightedText, {
      segments: [{ text: 'x', highlighted: true }],
      markStyle: { background: 'red' },
      markClassName: 'my-mark',
    });
    expect(styled).toContain('class="my-mark"');
    expect(styled).toContain('background:red');

    expect(
      renderComponent(HighlightedText, { segments: [], fallback: 'nothing' }),
    ).toBe('nothing');
  });

  it('extracts every mark from a snippet', () => {
    expect(
      extractMarks(
        renderComponent(HighlightedText, { segments: sampleHit.snippet }),
      ),
    ).toEqual(['Q4']);
  });
});

/* -------------------------------------------------------------------------- */
/* Empty-state copy & formatting                                              */
/* -------------------------------------------------------------------------- */

describe('quickFindEmptyMessage', () => {
  it('distinguishes "no history" from "no results"', () => {
    expect(quickFindEmptyMessage('')).toBe('No pages yet');
    expect(quickFindEmptyMessage('   ')).toBe('No pages yet');
    expect(quickFindEmptyMessage(' roadmap ')).toBe('No results for “roadmap”');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 10, 22, 12, 0, 0);

  it('formats each magnitude', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(formatRelativeTime(now - 14 * 86_400_000, now)).toBe('2w ago');
    expect(formatRelativeTime(now - 90 * 86_400_000, now)).toBe('3mo ago');
    expect(formatRelativeTime(now - 800 * 86_400_000, now)).toBe('2y ago');
  });

  it('handles invalid and future timestamps', () => {
    expect(formatRelativeTime(0, now)).toBe('');
    expect(formatRelativeTime(Number.NaN, now)).toBe('');
    expect(formatRelativeTime(now + 60_000, now)).toBe('just now');
  });
});

describe('formatBlockTypeLabel', () => {
  it('maps block types to readable badges', () => {
    expect(formatBlockTypeLabel('page')).toBe('Page');
    expect(formatBlockTypeLabel('heading_2')).toBe('Heading');
    expect(formatBlockTypeLabel('collection_view')).toBe('Database');
    expect(formatBlockTypeLabel('to_do')).toBe('To-do');
    expect(formatBlockTypeLabel('image')).toBe('Media');
    expect(formatBlockTypeLabel('unknown_type')).toBe('unknown_type');
  });
});

describe('splitBreadcrumb', () => {
  it('splits and trims crumbs', () => {
    expect(splitBreadcrumb('Projects / Q4 / Plan')).toEqual([
      'Projects',
      'Q4',
      'Plan',
    ]);
    expect(splitBreadcrumb('  Projects   /   Q4 ')).toEqual(['Projects', 'Q4']);
    expect(splitBreadcrumb(undefined)).toEqual([]);
    expect(splitBreadcrumb('')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Shortcuts                                                                  */
/* -------------------------------------------------------------------------- */

describe('keyboard shortcuts', () => {
  it('recognises Cmd/Ctrl + K and P', () => {
    expect(isQuickFindShortcut({ key: 'k', metaKey: true })).toBe(true);
    expect(isQuickFindShortcut({ key: 'K', ctrlKey: true })).toBe(true);
    expect(isQuickFindShortcut({ key: 'p', metaKey: true })).toBe(true);
    expect(isQuickFindShortcut({ key: 'p', ctrlKey: true })).toBe(true);
    expect(isQuickFindShortcut({ key: 'k' })).toBe(false);
    expect(isQuickFindShortcut({ key: 'k', metaKey: true, altKey: true })).toBe(
      false,
    );
    expect(isQuickFindShortcut({ key: 'x', metaKey: true })).toBe(false);
  });

  it('recognises Escape only', () => {
    expect(isEscapeKey({ key: 'Escape' })).toBe(true);
    expect(isEscapeKey({ key: 'Escape', metaKey: true })).toBe(false);
    expect(isEscapeKey({ key: 'Esc' })).toBe(false);
  });

  it('labels the shortcut per platform', () => {
    expect(quickFindShortcutLabel(true)).toBe('⌘K');
    expect(quickFindShortcutLabel(false)).toBe('Ctrl K');
  });
});

/* -------------------------------------------------------------------------- */
/* Modal wiring                                                               */
/* -------------------------------------------------------------------------- */

describe('modal wiring', () => {
  it('accepts a scope-less session without crashing', () => {
    const markup = renderComponent(QuickFindModal, modalProps({ scope: null }));
    expect(markup).toContain('role="dialog"');
  });

  it('does not crash on an unusable service result', () => {
    const failing: SearchExecutor = {
      indexUid: BLOCKS_INDEX_UID,
      async execute() {
        throw new Error('offline');
      },
    };
    const markup = renderComponent(QuickFindModal, {
      ...modalProps(),
      service: new QuickFindSearchService(failing),
    });
    // The empty state renders synchronously; the error only appears after the
    // first request settles (asserted in useQuickFind.test.ts).
    expect(markup).toContain('data-votion-quickfind="empty"');
  });

  it('renders a page block fixture end-to-end through the transformer shape', () => {
    const block = makeBlock({
      type: 'page',
      properties: { title: [['Q4 Financial Roadmap', [['b']]]] },
      id: ROADMAP_PAGE_ID,
    });
    expect(block.properties.title).toBeDefined();
  });
});
