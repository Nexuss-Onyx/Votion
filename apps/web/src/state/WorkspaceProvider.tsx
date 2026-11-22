/**
 * Workspace shell context.
 *
 * Owns the app-level state the shell needs on top of the normalized record
 * store: the active workspace, the active page, sidebar state (favorites,
 * teamspaces, private pages, trash), presence, notifications, discussion
 * threads, inline comments, and the ops needed to mutate the record store.
 *
 * The record store (`@votion/sync-client`) is the single source of truth for
 * pages and blocks; this provider only caches UI chrome on top of it.
 */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Block, UUID } from '@votion/types';
import { getRecordStore, useRecordStore } from '@votion/sync-client';
import {
  seedFixture,
  seedChrome,
  WORKSPACES,
  CURRENT_USER,
  NEXUS_HQ_ID,
  SEED_IDS,
  SEED_PEERS,
} from '../lib/seed';
import { computeTreeMove, type TreeDropZone } from '../lib/treeMove';
import type {
  DiscussionThread,
  InlineComment,
  PresencePeer,
  Profile,
  ShellNotification,
  Teamspace,
  Workspace,
} from '../lib/types';

export interface WorkspaceContextValue {
  /** True once the fixture has been seeded into the record store. */
  hydrated: boolean;

  /* Workspaces */
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  activeWorkspaceId: UUID;
  setActiveWorkspaceId: (id: UUID) => void;

  /* Pages & navigation */
  getBlock: (id: UUID) => Block | undefined;
  rootPages: Block[];
  activePage: Block | undefined;
  activePageId: UUID | null;
  openPage: (id: UUID) => void;
  goHome: () => void;

  /* Sidebar */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /* Favorites */
  favorites: UUID[];
  toggleFavorite: (id: UUID) => void;

  /* Teamspaces */
  teamspaces: Teamspace[];
  createTeamspace: (name: string) => void;
  toggleTeamspacePage: (teamspaceId: UUID, pageId: UUID) => void;

  /* Private pages */
  privatePages: UUID[];
  setPrivate: (id: UUID, value: boolean) => void;

  /* Trash */
  trashPages: Block[];
  restorePage: (id: UUID) => void;
  purgePage: (id: UUID) => void;

  /* Presence */
  peers: PresencePeer[];

  /* Notifications */
  notifications: ShellNotification[];
  unreadNotifications: number;
  markNotificationRead: (id: UUID) => void;
  markAllNotificationsRead: () => void;
  clearNotification: (id: UUID) => void;

  /* Discussion threads */
  getThreadsForPage: (pageId: UUID) => DiscussionThread[];
  addThread: (pageId: UUID, body: string) => void;
  addThreadReply: (threadId: UUID, body: string) => void;
  toggleThreadResolved: (threadId: UUID) => void;
  reactToThread: (threadId: UUID, emoji: string) => void;
  updateThreadBody: (threadId: UUID, body: string) => void;

  /* Inline comments */
  getCommentsForPage: (pageId: UUID) => InlineComment[];
  addInlineComment: (pageId: UUID, blockId: UUID, anchor: string, body: string) => void;
  toggleCommentResolved: (id: UUID) => void;
  reactToComment: (id: UUID, emoji: string) => void;
  addCommentReply: (id: UUID, body: string) => void;
  updateCommentBody: (id: UUID, body: string) => void;

  /* Page ops */
  setPageIcon: (id: UUID, icon: string) => void;
  setPageCover: (id: UUID, cover: string | null) => void;
  togglePageFullWidth: (id: UUID) => void;
  togglePageSmallText: (id: UUID) => void;
  setPageFullWidth: (id: UUID, value: boolean) => void;
  setPageSmallText: (id: UUID, value: boolean) => void;
  softDeleteActivePage: () => void;
  movePage: (draggedId: UUID, targetId: UUID, zone: TreeDropZone) => void;

  /* Shared UI state */
  currentUser: Profile;
  quickFindOpen: boolean;
  setQuickFindOpen: (open: boolean) => void;

  /* Workspace creation */
  createWorkspace: (name: string) => UUID;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  }
  return value;
}

interface WorkspaceProviderProps {
  children: ReactNode;
  /** Seed the fixture on mount (default true). Tests set false to control seeding. */
  seed?: boolean;
}

export function WorkspaceProvider({ children, seed = true }: WorkspaceProviderProps) {
  const [hydrated, setHydrated] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(WORKSPACES);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<UUID>(NEXUS_HQ_ID);
  const [activePageId, setActivePageId] = useState<UUID | null>(SEED_IDS.home);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [favorites, setFavorites] = useState<UUID[]>([]);
  const [teamspaces, setTeamspaces] = useState<Teamspace[]>([]);
  const [privatePages, setPrivatePages] = useState<UUID[]>([]);
  const [notifications, setNotifications] = useState<ShellNotification[]>([]);
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [comments, setComments] = useState<InlineComment[]>([]);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [quickFindOpen, setQuickFindOpen] = useState(false);

  // Subscribe to the record store *before* seeding so the seed mutation is
  // observed by the component (effects run in declaration order).
  const blocks = useRecordStore((state) => state.blocks);

  const seededRef = useRef(false);

  /* Seed the record store once, on mount. --------------------------------- */
  useEffect(() => {
    if (!seed || seededRef.current) return;
    seededRef.current = true;

    const store = getRecordStore();
    const state = store.getState();

    // Only seed when the store is empty (a returning user keeps their cache).
    if (Object.keys(state.blocks).length === 0) {
      const fixture = seedFixture();
      store.getState().setRecords('block', fixture.blocks);
      store.getState().loadRecords({
        collection: Object.fromEntries(fixture.collections.map((c) => [c.id, c])),
        collection_view: Object.fromEntries(fixture.collectionViews.map((v) => [v.id, v])),
      });
      const chrome = seedChrome(fixture.blocks);
      setFavorites(chrome.favorites);
      setPrivatePages(chrome.privatePages);
      setTeamspaces(chrome.teamspaces);
      setThreads(chrome.threads);
      setComments(chrome.inlineComments);
      setNotifications(chrome.notifications);
      setPeers(chrome.peers.slice());
    } else {
      setPeers(SEED_PEERS.slice());
      setFavorites([]);
      setPrivatePages([]);
      setTeamspaces([]);
      setThreads([]);
      setComments([]);
      setNotifications([]);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);


  /* Navigation helpers ----------------------------------------------------- */

  const isAlivePage = useCallback((block: Block | undefined): block is Block => {
    return !!block && block.alive && (block.type === 'page' || block.type === 'collection_view');
  }, []);

  const rootPages = useMemo<Block[]>(
    () =>
      Object.values(blocks)
        .filter(
          (block) =>
            block.alive &&
            (block.type === 'page' || block.type === 'collection_view') &&
            block.parent_table === 'space' &&
            block.space_id === activeWorkspaceId,
        )
        .sort((a, b) => a.created_time - b.created_time),
    [blocks, activeWorkspaceId],
  );

  const goHome = useCallback(() => {
    if (rootPages[0]) setActivePageId(rootPages[0].id);
  }, [rootPages]);

  // Keep the active page valid as records change (restore/purge/switch).
  useEffect(() => {
    if (!hydrated) return;
    const activeId = activePageId;
    const activeBlock = activeId ? blocks[activeId] : undefined;
    const valid =
      activeBlock &&
      activeBlock.alive &&
      (activeBlock.type === 'page' || activeBlock.type === 'collection_view') &&
      activeBlock.space_id === activeWorkspaceId;
    if (!valid) {
      goHome();
    }
  }, [activePageId, activeWorkspaceId, blocks, hydrated, goHome]);

  const activePage = activePageId ? blocks[activePageId] : undefined;

  const openPage = useCallback((id: UUID) => {
    const block = getRecordStore().getState().blocks[id];
    if (!isAlivePage(block)) return;
    setActivePageId(id);
  }, [isAlivePage]);

  const setActiveWorkspaceId = useCallback(
    (id: UUID) => {
      setActiveWorkspaceIdState(id);
      // Navigate to the first root page of the new workspace.
      const root = Object.values(getRecordStore().getState().blocks).find(
        (block) =>
          block.alive &&
          (block.type === 'page' || block.type === 'collection_view') &&
          block.parent_table === 'space' &&
          block.space_id === id,
      );
      if (root) setActivePageId(root.id);
    },
    [],
  );

  /* Sidebar ------------------------------------------------------------------ */

  const toggleSidebar = useCallback(() => setSidebarCollapsed((value) => !value), []);

  /* Favorites ------------------------------------------------------------------ */

  const toggleFavorite = useCallback((id: UUID) => {
    setFavorites((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }, []);

  /* Teamspaces ----------------------------------------------------------------- */

  const createTeamspace = useCallback((name: string) => {
    const id = `ts-${Date.now().toString(36)}`;
    setTeamspaces((current) => [
      ...current,
      { id, name, icon: '👥', color: '#f59e0b', pageIds: [] },
    ]);
  }, []);

  const toggleTeamspacePage = useCallback((teamspaceId: UUID, pageId: UUID) => {
    setTeamspaces((current) =>
      current.map((teamspace) =>
        teamspace.id !== teamspaceId
          ? teamspace
          : {
              ...teamspace,
              pageIds: teamspace.pageIds.includes(pageId)
                ? teamspace.pageIds.filter((id) => id !== pageId)
                : [...teamspace.pageIds, pageId],
            },
      ),
    );
  }, []);

  /* Private pages --------------------------------------------------------------- */

  const setPrivate = useCallback((id: UUID, value: boolean) => {
    setPrivatePages((current) =>
      value ? [...new Set([...current, id])] : current.filter((entry) => entry !== id),
    );
  }, []);

  /* Trash ------------------------------------------------------------------------ */

  const trashPages = useMemo<Block[]>(
    () =>
      Object.values(blocks)
        .filter(
          (block) =>
            !block.alive &&
            block.type === 'page' &&
            block.space_id === activeWorkspaceId,
        )
        .sort((a, b) => b.last_edited_time - a.last_edited_time),
    [blocks, activeWorkspaceId],
  );

  const restorePage = useCallback((id: UUID) => {
    getRecordStore().getState().updateRecord('block', id, { alive: true });
  }, []);

  const purgePage = useCallback((id: UUID) => {
    getRecordStore().getState().removeRecord('block', id);
  }, []);

  /* Notifications ----------------------------------------------------------------- */

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => notification.unread).length,
    [notifications],
  );

  const markNotificationRead = useCallback((id: UUID) => {
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, unread: false } : notification,
      ),
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((current) => current.map((notification) => ({ ...notification, unread: false })));
  }, []);

  const clearNotification = useCallback((id: UUID) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  /* Discussion threads ------------------------------------------------------------- */

  const getThreadsForPage = useCallback(
    (pageId: UUID) => threads.filter((thread) => thread.pageId === pageId),
    [threads],
  );

  const addThread = useCallback((pageId: UUID, body: string) => {
    const id = `t-${Date.now().toString(36)}`;
    setThreads((current) => [
      ...current,
      {
        id,
        pageId,
        author: CURRENT_USER,
        body,
        resolved: false,
        reactions: {},
        replies: [],
        createdAt: Date.now(),
      },
    ]);
  }, []);

  const addThreadReply = useCallback((threadId: UUID, body: string) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id !== threadId
          ? thread
          : {
              ...thread,
              replies: [
                ...thread.replies,
                { id: `t-${Date.now().toString(36)}-r`, author: CURRENT_USER, body, createdAt: Date.now() },
              ],
            },
      ),
    );
  }, []);

  const toggleThreadResolved = useCallback((threadId: UUID) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, resolved: !thread.resolved } : thread,
      ),
    );
  }, []);

  const reactToThread = useCallback((threadId: UUID, emoji: string) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id !== threadId
          ? thread
          : {
              ...thread,
              reactions: {
                ...thread.reactions,
                [emoji]: (thread.reactions[emoji] ?? 0) + 1,
              },
            },
      ),
    );
  }, []);

  const updateThreadBody = useCallback((threadId: UUID, body: string) => {
    setThreads((current) =>
      current.map((thread) => (thread.id === threadId ? { ...thread, body } : thread)),
    );
  }, []);

  /* Inline comments ----------------------------------------------------------------- */

  const getCommentsForPage = useCallback(
    (pageId: UUID) => comments.filter((comment) => comment.pageId === pageId),
    [comments],
  );

  const addInlineComment = useCallback(
    (pageId: UUID, blockId: UUID, anchor: string, body: string) => {
      const id = `ic-${Date.now().toString(36)}`;
      setComments((current) => [
        ...current,
        {
          id,
          pageId,
          blockId,
          anchor,
          author: CURRENT_USER,
          body,
          resolved: false,
          reactions: {},
          replies: [],
          createdAt: Date.now(),
        },
      ]);
    },
    [],
  );

  const toggleCommentResolved = useCallback((id: UUID) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id === id ? { ...comment, resolved: !comment.resolved } : comment,
      ),
    );
  }, []);

  const reactToComment = useCallback((id: UUID, emoji: string) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id !== id
          ? comment
          : {
              ...comment,
              reactions: {
                ...comment.reactions,
                [emoji]: (comment.reactions[emoji] ?? 0) + 1,
              },
            },
      ),
    );
  }, []);

  const addCommentReply = useCallback((id: UUID, body: string) => {
    setComments((current) =>
      current.map((comment) =>
        comment.id !== id
          ? comment
          : {
              ...comment,
              replies: [
                ...comment.replies,
                { id: `ic-${Date.now().toString(36)}`, author: CURRENT_USER, body, createdAt: Date.now() },
              ],
            },
      ),
    );
  }, []);

  const updateCommentBody = useCallback((id: UUID, body: string) => {
    setComments((current) =>
      current.map((comment) => (comment.id === id ? { ...comment, body } : comment)),
    );
  }, []);

  /* Page ops ------------------------------------------------------------------------- */

  const patchPageBlock = useCallback((id: UUID, patch: Partial<Block['format']>) => {
    const store = getRecordStore();
    const current = store.getState().blocks[id];
    if (!current) return;
    store.getState().updateRecord('block', id, { format: { ...current.format, ...patch } });
  }, []);

  const setPageIcon = useCallback(
    (id: UUID, icon: string) => patchPageBlock(id, { page_icon: icon }),
    [patchPageBlock],
  );

  const setPageCover = useCallback(
    (id: UUID, cover: string | null) => {
      if (cover === null) {
        patchPageBlock(id, { page_cover: undefined });
        return;
      }
      patchPageBlock(id, { page_cover: cover });
    },
    [patchPageBlock],
  );

  const setPageFullWidth = useCallback(
    (id: UUID, value: boolean) => patchPageBlock(id, { page_full_width: value }),
    [patchPageBlock],
  );

  const setPageSmallText = useCallback(
    (id: UUID, value: boolean) => patchPageBlock(id, { page_small_text: value }),
    [patchPageBlock],
  );

  const togglePageFullWidth = useCallback(
    (id: UUID) => {
      const current = getRecordStore().getState().blocks[id];
      if (!current) return;
      setPageFullWidth(id, !current.format?.page_full_width);
    },
    [setPageFullWidth],
  );

  const togglePageSmallText = useCallback(
    (id: UUID) => {
      const current = getRecordStore().getState().blocks[id];
      if (!current) return;
      setPageSmallText(id, !current.format?.page_small_text);
    },
    [setPageSmallText],
  );

  const softDeleteActivePage = useCallback(() => {
    if (!activePage) return;
    getRecordStore().getState().updateRecord('block', activePage.id, { alive: false });
    goHome();
  }, [activePage, goHome]);

  const movePage = useCallback(
    (draggedId: UUID, targetId: UUID, zone: TreeDropZone) => {
      const store = getRecordStore();
      const updates = computeTreeMove(store.getState().blocks, draggedId, targetId, zone);
      for (const update of updates) {
        if (update.content) {
          store.getState().updateRecord('block', update.blockId, { content: update.content });
        }
        if (update.parentId) {
          store.getState().updateRecord('block', update.blockId, {
            parent_id: update.parentId,
            parent_table: update.parentTable ?? 'block',
          });
        }
      }
    },
    [],
  );

  const createWorkspace = useCallback(
    (name: string) => {
      const id = `ws-${Date.now().toString(36)}`;
      const pageId = `p-${Date.now().toString(36)}`;
      const now = Date.now();
      setWorkspaces((current) => [
        ...current,
        { id, name, icon: '🏢', color: '#6366f1' },
      ]);
      const store = getRecordStore();
      store.getState().setRecords('block', [
        {
          id: pageId,
          space_id: id,
          version: 1,
          type: 'page',
          properties: { title: [['Home']] },
          format: { page_icon: '🏠' },
          content: [],
          parent_id: id,
          parent_table: 'space',
          alive: true,
          created_time: now,
          last_edited_time: now,
          created_by_id: CURRENT_USER.id,
          last_edited_by_id: CURRENT_USER.id,
        },
      ]);
      setActiveWorkspaceIdState(id);
      setActivePageId(pageId);
      return id;
    },
    [],
  );

  /* Context value -------------------------------------------------------------------- */

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0]!,
    [workspaces, activeWorkspaceId],
  );

  const value: WorkspaceContextValue = useMemo(
    () => ({
      hydrated,

      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      setActiveWorkspaceId,

      getBlock: (id) => getRecordStore().getState().blocks[id],
      rootPages,
      activePage,
      activePageId,
      openPage,
      goHome,

      sidebarCollapsed,
      toggleSidebar,

      favorites,
      toggleFavorite,

      teamspaces,
      createTeamspace,
      toggleTeamspacePage,

      privatePages,
      setPrivate,

      trashPages,
      restorePage,
      purgePage,

      peers,

      notifications,
      unreadNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotification,

      getThreadsForPage,
      addThread,
      addThreadReply,
      toggleThreadResolved,
      reactToThread,
      updateThreadBody,

      getCommentsForPage,
      addInlineComment,
      toggleCommentResolved,
      reactToComment,
      addCommentReply,
      updateCommentBody,

      setPageIcon,
      setPageCover,
      togglePageFullWidth,
      togglePageSmallText,
      setPageFullWidth,
      setPageSmallText,
      softDeleteActivePage,
      movePage,

      currentUser: CURRENT_USER,
      quickFindOpen,
      setQuickFindOpen,
      createWorkspace,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hydrated,
      workspaces,
      activeWorkspace,
      activeWorkspaceId,
      setActiveWorkspaceId,
      rootPages,
      activePage,
      activePageId,
      openPage,
      goHome,
      sidebarCollapsed,
      toggleSidebar,
      favorites,
      toggleFavorite,
      teamspaces,
      createTeamspace,
      toggleTeamspacePage,
      privatePages,
      setPrivate,
      trashPages,
      restorePage,
      purgePage,
      peers,
      notifications,
      unreadNotifications,
      markNotificationRead,
      markAllNotificationsRead,
      clearNotification,
      getThreadsForPage,
      addThread,
      addThreadReply,
      toggleThreadResolved,
      reactToThread,
      updateThreadBody,
      getCommentsForPage,
      addInlineComment,
      toggleCommentResolved,
      reactToComment,
      addCommentReply,
      updateCommentBody,
      setPageIcon,
      setPageCover,
      togglePageFullWidth,
      togglePageSmallText,
      setPageFullWidth,
      setPageSmallText,
      softDeleteActivePage,
      movePage,
      quickFindOpen,
      setQuickFindOpen,
      createWorkspace,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

