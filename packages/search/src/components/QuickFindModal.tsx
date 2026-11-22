/**
 * `QuickFindModal` — the global `Cmd+K` / `Ctrl+K` search dialog.
 *
 * Features
 *  - Global shortcut handling (`Cmd+K`, `Ctrl+K`, `Cmd+P`, `Ctrl+P`, `Escape`).
 *  - Search-as-you-type with a 150 ms debounce and request cancellation.
 *  - Highlighted match rendering (`<mark>`, never `dangerouslySetInnerHTML`).
 *  - Breadcrumb context per result row.
 *  - Recent-pages history in the empty state (local cache + server refresh).
 *  - Full keyboard navigation: `↑`/`↓` (and `Ctrl+N`/`Ctrl+P`), `Enter` to open,
 *    `Escape` to close, `Home`/`End`, plus listbox ARIA semantics.
 *
 * The component is headless with respect to routing: it calls `onSelect(hit)`
 * and lets the application shell navigate and record the visit.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import {
  Clock,
  CornerDownLeft,
  FileText,
  Loader2,
  Search,
  X,
} from 'lucide-react';

import { HighlightedText } from './HighlightedText.js';
import {
  formatBlockTypeLabel,
  formatRelativeTime,
  splitBreadcrumb,
} from './format.js';
import { useQuickFind } from './useQuickFind.js';
import {
  RecentPagesStore,
  type RecentPage,
  type RecentPagesStorage,
} from './recentPages.js';
import {
  isEscapeKey,
  isQuickFindShortcut,
  quickFindShortcutLabel,
  useGlobalShortcut,
} from './useGlobalShortcut.js';
import type { QuickFindSearchService } from '../client/QuickFindSearchService.js';
import type {
  QuickFindAccessScope,
  QuickFindHit,
  QuickFindSearchResult,
} from '../types.js';

/** Props of {@link QuickFindModal}. */
export interface QuickFindModalProps {
  /** Search service (or a React-friendly wrapper around it). */
  service: QuickFindSearchService;
  /** ACL scope of the current user. `null` disables searching. */
  scope: QuickFindAccessScope | null;
  /** Called with the chosen page/block. */
  onSelect: (hit: QuickFindHit) => void;
  /** Controlled open state; omit to let the modal own it via `Cmd+K`. */
  open?: boolean;
  /** Toggle callback for controlled usage. */
  onOpenChange?: (open: boolean) => void;
  /** Placeholder copy. */
  placeholder?: string;
  /** Debounce override (tests). */
  debounceMs?: number;
  /** Number of recent pages shown in the empty state. */
  recentLimit?: number;
  /** Injected storage for the recent list (tests / SSR). */
  storage?: RecentPagesStorage | null;
  /** Additional recent pages supplied by the shell (e.g. from the server). */
  recentPages?: readonly RecentPage[];
  /** Workspace the modal is scoped to (filters the recent list). */
  spaceId?: string;
  /** Disable the global shortcut (e.g. while a command palette is mounted). */
  disabled?: boolean;
  /** Extra class for the overlay. */
  className?: string;
}

/* Styles are inline objects with sensible defaults so the package has no CSS
   build step; the host app can override them through `className`. */
const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: '12vh',
  background: 'rgba(15, 15, 15, 0.45)',
  backdropFilter: 'blur(2px)',
};

const PANEL_STYLE: CSSProperties = {
  width: 'min(640px, calc(100vw - 32px))',
  maxHeight: '60vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 12,
  background: '#ffffff',
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.28)',
  border: '1px solid rgba(0, 0, 0, 0.08)',
};

const INPUT_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 14px',
  borderBottom: '1px solid rgba(0, 0, 0, 0.07)',
};

const INPUT_STYLE: CSSProperties = {
  flex: 1,
  border: 'none',
  outline: 'none',
  fontSize: 15,
  lineHeight: '22px',
  background: 'transparent',
  color: 'inherit',
};

const LIST_STYLE: CSSProperties = {
  overflowY: 'auto',
  padding: 6,
};

const SECTION_LABEL_STYLE: CSSProperties = {
  padding: '8px 10px 4px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'rgba(0, 0, 0, 0.45)',
};

const FOOTER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  borderTop: '1px solid rgba(0, 0, 0, 0.07)',
  fontSize: 11,
  color: 'rgba(0, 0, 0, 0.5)',
};

function rowsStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '8px 10px',
    border: 'none',
    borderRadius: 8,
    background: active ? 'rgba(46, 98, 255, 0.10)' : 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'inherit',
    font: 'inherit',
  };
}

/** Empty-state list entry, unified with search hits. */
interface RowModel {
  id: string;
  title: string;
  titleSegments?: QuickFindHit['title'];
  snippet?: QuickFindHit['snippet'];
  breadcrumb?: string;
  type?: string;
  lastEditedTime?: number;
  icon?: string;
  hit?: QuickFindHit;
  page?: RecentPage;
}

function rowFromHit(hit: QuickFindHit): RowModel {
  return {
    id: hit.id,
    title: hit.plainTitle,
    titleSegments: hit.title,
    snippet: hit.snippet,
    ...(hit.breadcrumb !== undefined ? { breadcrumb: hit.breadcrumb } : {}),
    type: hit.type,
    lastEditedTime: hit.lastEditedTime,
    hit,
  };
}

function rowFromRecent(page: RecentPage): RowModel {
  return {
    id: page.id,
    title: page.title,
    page,
    ...(page.breadcrumb !== undefined ? { breadcrumb: page.breadcrumb } : {}),
    ...(page.icon !== undefined ? { icon: page.icon } : {}),
    type: 'page',
  };
}

/** Shared "no results" copy, split out so it can be asserted in tests. */
export function quickFindEmptyMessage(query: string): string {
  const term = query.trim();
  return term.length === 0 ? 'No pages yet' : `No results for “${term}”`;
}

export function QuickFindModal(
  props: QuickFindModalProps,
): ReactElement | null {
  const {
    service,
    scope,
    onSelect,
    placeholder = 'Search pages and blocks…',
    debounceMs,
    recentLimit = 8,
    storage,
    recentPages: externalRecent,
    spaceId,
    disabled = false,
    className,
    onOpenChange,
  } = props;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = props.open !== undefined;
  const open = isControlled ? Boolean(props.open) : uncontrolledOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const search = useQuickFind({
    service,
    scope,
    enabled: open,
    recentLimit,
    ...(debounceMs !== undefined ? { debounceMs } : {}),
  });

  const baseId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const store = useMemo(
    () =>
      new RecentPagesStore(
        storage === undefined ? undefined : storage,
        recentLimit,
      ),
    [storage, recentLimit],
  );
  const [localRecent, setLocalRecent] = useState<RecentPage[]>(() =>
    store.list(spaceId),
  );

  // Refresh the local history when the workspace changes / the modal opens.
  useEffect(() => {
    if (open) {
      setLocalRecent(store.list(spaceId));
    }
  }, [open, store, spaceId]);

  // Global shortcut handling (also active while closed).
  useGlobalShortcut({
    enabled: !disabled,
    open,
    onToggle: () => setOpen(!open),
    onEscape: () => {
      if (open) {
        setOpen(false);
      }
    },
  });

  // Focus the input on open. `search.reset` is a stable controller method; only
  // `open` should re-run this effect (focus once per open, not per keystroke).
  //
  // The controller is reset by the hook itself when the modal closes, which
  // keeps this effect free of ordering hazards (resetting here would abort the
  // recent-pages request that `useQuickFind` fires when the modal opens).
  const resetSearch = search.reset;
  useEffect(() => {
    if (!open) {
      resetSearch();
      setActiveIndex(0);
      return;
    }
    setActiveIndex(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [open, resetSearch]);

  const rows: RowModel[] = useMemo(() => {
    if (search.isRecentView) {
      const recent =
        externalRecent && externalRecent.length > 0
          ? externalRecent
          : localRecent;
      const seen = new Set<string>();
      const rowsOut: RowModel[] = [];
      for (const page of recent) {
        if (seen.has(page.id)) {
          continue;
        }
        if (spaceId !== undefined && page.spaceId !== spaceId) {
          continue;
        }
        seen.add(page.id);
        rowsOut.push(rowFromRecent(page));
        if (rowsOut.length >= recentLimit) {
          break;
        }
      }
      return rowsOut;
    }
    return search.hits.map(rowFromHit);
  }, [
    search.isRecentView,
    search.hits,
    externalRecent,
    localRecent,
    spaceId,
    recentLimit,
  ]);

  // Keep the active row in range when results change.
  useEffect(() => {
    setActiveIndex((current) =>
      rows.length === 0 ? 0 : Math.min(current, rows.length - 1),
    );
  }, [rows.length]);

  // Scroll the active row into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const active = list.querySelector<HTMLElement>(
      '[data-votion-active="true"]',
    );
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, rows.length]);

  const choose = useCallback(
    (row: RowModel | undefined) => {
      if (!row) {
        return;
      }
      const hit = row.hit;
      if (hit) {
        store.record({
          id: hit.id,
          title: hit.plainTitle,
          spaceId: hit.spaceId || (spaceId ?? ''),
          ...(hit.rootPageId ? { rootPageId: hit.rootPageId } : {}),
          ...(hit.breadcrumb !== undefined
            ? { breadcrumb: hit.breadcrumb }
            : {}),
        });
        setLocalRecent(store.list(spaceId));
        onSelect(hit);
      } else if (row.page) {
        // Recent history entry: synthesise the minimal hit shape the shell needs.
        onSelect({
          id: row.page.id,
          spaceId: row.page.spaceId,
          parentId: row.page.rootPageId ?? row.page.id,
          rootPageId: row.page.rootPageId ?? row.page.id,
          type: 'page',
          title: [{ text: row.page.title, highlighted: false }],
          snippet: [],
          plainTitle: row.page.title,
          ...(row.page.breadcrumb !== undefined
            ? { breadcrumb: row.page.breadcrumb }
            : {}),
          createdBy: '',
          lastEditedTime: row.page.visitedAt,
        });
      }
      setOpen(false);
    },
    [store, spaceId, onSelect, setOpen],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (isEscapeKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        return;
      }
      if (isQuickFindShortcut(event)) {
        event.preventDefault();
        return;
      }
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((current) =>
            rows.length === 0 ? 0 : (current + 1) % rows.length,
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((current) =>
            rows.length === 0 ? 0 : (current - 1 + rows.length) % rows.length,
          );
          break;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setActiveIndex(rows.length === 0 ? 0 : rows.length - 1);
          break;
        case 'Enter':
          event.preventDefault();
          choose(rows[activeIndex]);
          break;
        case 'Tab':
          // Keep focus inside the dialog: the input is the only tab stop.
          event.preventDefault();
          break;
        default:
          break;
      }
    },
    [rows, activeIndex, choose, setOpen],
  );

  if (!open) {
    return null;
  }

  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number): string => `${baseId}-option-${index}`;
  const result: QuickFindSearchResult | null = search.result;

  return (
    <div
      role="presentation"
      className={className}
      style={OVERLAY_STYLE}
      data-votion-quickfind="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick Find"
        style={PANEL_STYLE}
        data-votion-quickfind="panel"
        onKeyDown={onKeyDown}
      >
        <div style={INPUT_ROW_STYLE}>
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              rows.length > 0 ? optionId(activeIndex) : undefined
            }
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            style={INPUT_STYLE}
            value={search.query}
            onChange={(event) => search.setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter bubbles to the panel handler, which owns selection; only
              // the in-flight debounce needs flushing here.
              if (event.key === 'Enter') {
                search.submit();
              }
            }}
            data-votion-quickfind="input"
          />
          {search.loading ? (
            <Loader2
              size={15}
              className="votion-quickfind-spinner"
              aria-hidden="true"
            />
          ) : null}
          <button
            type="button"
            aria-label="Clear search"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: 2,
            }}
            onClick={() => {
              search.reset();
              inputRef.current?.focus();
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          style={LIST_STYLE}
        >
          {search.isRecentView ? (
            <div style={SECTION_LABEL_STYLE}>Recently visited</div>
          ) : null}

          {rows.map((row, index) => {
            const active = index === activeIndex;
            const crumbs = splitBreadcrumb(row.breadcrumb);
            return (
              <div
                key={`${row.id}-${index}`}
                id={optionId(index)}
                role="option"
                aria-selected={active}
                data-votion-active={active ? 'true' : 'false'}
                data-votion-result-type={row.type ?? 'text'}
                style={rowsStyle(active)}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(row)}
              >
                <span
                  aria-hidden="true"
                  style={{ display: 'flex', flexShrink: 0 }}
                >
                  {search.isRecentView ? (
                    <Clock size={15} />
                  ) : (
                    <FileText size={15} />
                  )}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 14,
                    }}
                  >
                    {row.titleSegments ? (
                      <HighlightedText
                        segments={row.titleSegments}
                        fallback={row.title}
                      />
                    ) : (
                      row.title
                    )}
                  </span>
                  {crumbs.length > 0 ? (
                    <span
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 11,
                        color: 'rgba(0, 0, 0, 0.45)',
                      }}
                      data-votion-breadcrumb="true"
                    >
                      {crumbs.join(' › ')}
                    </span>
                  ) : null}
                  {row.snippet && row.snippet.length > 0 ? (
                    <span
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 11,
                        color: 'rgba(0, 0, 0, 0.55)',
                      }}
                      data-votion-snippet="true"
                    >
                      <HighlightedText segments={row.snippet} />
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(0, 0, 0, 0.06)',
                    color: 'rgba(0, 0, 0, 0.55)',
                  }}
                >
                  {formatBlockTypeLabel(row.type ?? 'text')}
                </span>
                {row.lastEditedTime ? (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      color: 'rgba(0, 0, 0, 0.4)',
                    }}
                  >
                    {formatRelativeTime(row.lastEditedTime)}
                  </span>
                ) : null}
              </div>
            );
          })}

          {rows.length === 0 && !search.loading ? (
            <div
              style={{
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: 13,
                color: 'rgba(0,0,0,0.5)',
              }}
              data-votion-quickfind="empty"
            >
              {search.error ? (
                <>
                  Search is unavailable.
                  <button
                    type="button"
                    onClick={() => search.refresh()}
                    style={{
                      marginLeft: 6,
                      border: 'none',
                      background: 'transparent',
                      color: '#2e62ff',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    Retry
                  </button>
                </>
              ) : (
                quickFindEmptyMessage(search.query)
              )}
            </div>
          ) : null}
        </div>

        <div style={FOOTER_STYLE}>
          <span>
            <CornerDownLeft size={11} aria-hidden="true" /> to open
          </span>
          <span>↑↓ to navigate</span>
          <span>Esc to close</span>
          <span style={{ marginLeft: 'auto' }}>{quickFindShortcutLabel()}</span>
          {result && !search.isRecentView ? (
            <span data-votion-quickfind="latency">
              {Math.round(result.elapsedMs)} ms
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
