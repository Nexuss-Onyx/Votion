/**
 * Seed data for the Votion web shell.
 *
 * The shell is local-first: on first launch the record store is empty, so we
 * populate it with a deterministic workspace fixture (Nexus HQ + Design Lab).
 * Seeding is idempotent — it only runs when the store holds no blocks — so a
 * returning user with an existing cache never sees the fixture re-inserted.
 */

import type {
  Block,
  Collection,
  CollectionView,
  RichText,
  UUID,
} from '@votion/types';
import type {
  DiscussionThread,
  InlineComment,
  PresencePeer,
  Profile,
  ShellNotification,
  Teamspace,
  Workspace,
} from './types';

export const NEXUS_HQ_ID = 'ws-nexus-hq';
export const DESIGN_LAB_ID = 'ws-design-lab';

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                 */
/* -------------------------------------------------------------------------- */

export const WORKSPACES: Workspace[] = [
  { id: NEXUS_HQ_ID, name: 'Nexus HQ', icon: '🏢', color: '#6366f1' },
  { id: DESIGN_LAB_ID, name: 'Design Lab', icon: '🎨', color: '#d946ef' },
];

/* -------------------------------------------------------------------------- */
/* Profiles                                                                   */
/* -------------------------------------------------------------------------- */

export const VESTA_ADA: Profile = {
  id: 'user-ada',
  name: 'Ada Lovelace',
  initials: 'AL',
  color: '#ec4899',
  email: 'ada@nexus.dev',
};
export const VESTA_GRACE: Profile = {
  id: 'user-grace',
  name: 'Grace Hopper',
  initials: 'GH',
  color: '#10b981',
  email: 'grace@nexus.dev',
};
export const VESTA_ALAN: Profile = {
  id: 'user-alan',
  name: 'Alan Turing',
  initials: 'AT',
  color: '#0ea5e9',
  email: 'alan@nexus.dev',
};
export const VESTA_NORA: Profile = {
  id: 'user-nora',
  name: 'Nora Kim',
  initials: 'NK',
  color: '#f59e0b',
  email: 'nora@nexus.dev',
};
export const VESTA_KAI: Profile = {
  id: 'user-kai',
  name: 'Kai Rivera',
  initials: 'KR',
  color: '#8b5cf6',
  email: 'kai@nexus.dev',
};

/** Profile rendered as "you" — the local viewer. */
export const CURRENT_USER: Profile = {
  id: 'user-you',
  name: 'You',
  initials: 'YO',
  color: '#2383e2',
  email: 'you@nexus.dev',
};

export const SEED_PEERS: PresencePeer[] = [
  { id: VESTA_ADA.id, name: VESTA_ADA.name, initials: VESTA_ADA.initials, color: VESTA_ADA.color, active: true },
  { id: VESTA_GRACE.id, name: VESTA_GRACE.name, initials: VESTA_GRACE.initials, color: VESTA_GRACE.color, active: true },
  { id: VESTA_ALAN.id, name: VESTA_ALAN.name, initials: VESTA_ALAN.initials, color: VESTA_ALAN.color, active: false },
];

export const SEED_WORKSPACE_MEMBERS: Profile[] = [
  CURRENT_USER,
  VESTA_ADA,
  VESTA_GRACE,
  VESTA_ALAN,
  VESTA_NORA,
];

const NOW = 1_760_000_000_000; // fixed timestamp — deterministic fixture

/* -------------------------------------------------------------------------- */
/* Stable id registry                                                         */
/* -------------------------------------------------------------------------- */

export const SEED_IDS = {
  home: 'p-home',
  onboarding: 'p-onboarding',
  gettingStarted: 'p-getting-started',
  norms: 'p-norms',
  product: 'p-product',
  roadmap: 'p-roadmap',
  releases: 'p-releases',
  engineering: 'p-engineering',
  sprint42: 'p-sprint-42',
  archReview: 'p-arch-review',
  design: 'p-design',
  brand: 'p-brand',
  icons: 'p-icons',
  tasksPage: 'p-tasks-page',
  tasksCollection: 'c-tasks',
  tasksView: 'v-tasks',
  journal: 'p-journal',
  oldRetro: 'p-old-retro',
  oldChecklist: 'p-old-checklist',
  welcome: 'b-welcome',
  quote: 'b-quote',
  quickLinksHeader: 'b-quick-links',
  todo: 'b-todo-1',
  callout: 'b-callout-1',
  sprintNote: 'b-sprint-note',
  roadmapNote: 'b-roadmap-note',
  oldChecklistText: 'b-old-checklist',
  designHome: 'p-design-home',
  designTokens: 'p-design-tokens',
  designMotion: 'p-design-motion',
  taskShip: 'b-task-ship',
  taskCi: 'b-task-ci',
  taskAnnounce: 'b-task-announce',
} as const;

/* -------------------------------------------------------------------------- */
/* Block factories                                                            */
/* -------------------------------------------------------------------------- */

function block(
  id: UUID,
  type: Block['type'],
  spaceId: UUID,
  parentId: UUID,
  parentTable: 'block' | 'space' | 'collection',
  overrides: Partial<Block> = {},
): Block {
  return {
    id,
    space_id: spaceId,
    version: 1,
    type,
    properties: {},
    format: {},
    content: [],
    parent_id: parentId,
    parent_table: parentTable,
    alive: true,
    created_time: NOW,
    last_edited_time: NOW,
    created_by_id: CURRENT_USER.id,
    last_edited_by_id: CURRENT_USER.id,
    ...overrides,
  };
}

function page(
  id: UUID,
  spaceId: UUID,
  parentId: UUID,
  parentTable: 'block' | 'space',
  title: string,
  icon = '📄',
  extra: Partial<Block> = {},
): Block {
  return block(id, 'page', spaceId, parentId, parentTable, {
    properties: { title: [[title]] },
    format: { page_icon: icon },
    ...extra,
  });
}

function textBlock(id: UUID, spaceId: UUID, parentId: UUID, richText: RichText): Block {
  return block(id, 'text', spaceId, parentId, 'block', {
    properties: { title: richText },
  });
}

/* -------------------------------------------------------------------------- */
/* Fixture                                                                    */
/* -------------------------------------------------------------------------- */

export interface SeedFixtureResult {
  blocks: Block[];
  collections: Collection[];
  collectionViews: CollectionView[];
}

/** Builds the complete Nexus HQ + Design Lab fixture (deterministic). */
export function seedFixture(): SeedFixtureResult {
  const blocks: Block[] = [];

  // --- Home body blocks ------------------------------------------------------
  const homeWelcome = textBlock(SEED_IDS.welcome, NEXUS_HQ_ID, SEED_IDS.home, [
    ['Welcome to Nexus HQ. This page covers the ', [['b']]],
    ['onboarding checklist', [['h', 'yellow_background']]],
    [' for new engineers and covers the release cadence for ', [['i']]],
    ['Q4 2026', [['h', 'yellow_background']]],
    ['.'],
  ]);
  const homeQuote = block(SEED_IDS.quote, 'quote', NEXUS_HQ_ID, SEED_IDS.home, 'block', {
    properties: { title: [['Ship the thing, then polish it.']] },
  });
  const homeHeader = block(SEED_IDS.quickLinksHeader, 'heading_2', NEXUS_HQ_ID, SEED_IDS.home, 'block', {
    properties: { title: [['Quick links']] },
  });
  const homeTodo = block(SEED_IDS.todo, 'to_do', NEXUS_HQ_ID, SEED_IDS.home, 'block', {
    properties: { title: [['Update the release calendar']], checked: [['no']] },
  });
  const homeCallout = block(SEED_IDS.callout, 'callout', NEXUS_HQ_ID, SEED_IDS.home, 'block', {
    properties: { title: [['Ping Ada before shipping — she owns the handoff.']] },
  });
  const normNote = textBlock(SEED_IDS.sprintNote, NEXUS_HQ_ID, SEED_IDS.norms, [
    ['Team norms: '],
    ['one PR per intent', [['h', 'green_background']]],
    ['. Review in pairs, merge behind CI.'],
  ]);
  const roadmapNoteBlock = textBlock(SEED_IDS.roadmapNote, NEXUS_HQ_ID, SEED_IDS.roadmap, [
    ['Roadmap 2026: '],
    ['Web shell', [['h', 'blue_background']]],
    [' is in flight; Q4 is the delivery quarter.'],
  ]);
  const oldChecklistTextBlock = textBlock(SEED_IDS.oldChecklistText, NEXUS_HQ_ID, SEED_IDS.oldChecklist, [
    ['Old checklist body'],
  ]);

  // --- Pages ------------------------------------------------------------------
  const pHome = page(SEED_IDS.home, NEXUS_HQ_ID, NEXUS_HQ_ID, 'space', 'Home', '🏠', {
    content: [
      SEED_IDS.onboarding,
      SEED_IDS.product,
      SEED_IDS.engineering,
      SEED_IDS.design,
      SEED_IDS.tasksPage,
      SEED_IDS.welcome,
      SEED_IDS.quote,
      SEED_IDS.quickLinksHeader,
      SEED_IDS.todo,
      SEED_IDS.callout,
    ],
  });
  const pOnboarding = page(SEED_IDS.onboarding, NEXUS_HQ_ID, SEED_IDS.home, 'block', 'Onboarding', '📘', {
    content: [SEED_IDS.gettingStarted, SEED_IDS.norms],
  });
  const pGettingStarted = page(SEED_IDS.gettingStarted, NEXUS_HQ_ID, SEED_IDS.onboarding, 'block', 'Getting Started', '🚀');
  const pNorms = page(SEED_IDS.norms, NEXUS_HQ_ID, SEED_IDS.onboarding, 'block', 'Team Norms', '⚙️', {
    content: [SEED_IDS.sprintNote],
  });
  const pProduct = page(SEED_IDS.product, NEXUS_HQ_ID, SEED_IDS.home, 'block', 'Product', '📦', {
    content: [SEED_IDS.roadmap, SEED_IDS.releases],
  });
  const pRoadmap = page(SEED_IDS.roadmap, NEXUS_HQ_ID, SEED_IDS.product, 'block', 'Roadmap 2026', '🗺️', {
    content: [SEED_IDS.roadmapNote],
  });
  const pReleases = page(SEED_IDS.releases, NEXUS_HQ_ID, SEED_IDS.product, 'block', 'Release Notes', '📝');
  const pEngineering = page(SEED_IDS.engineering, NEXUS_HQ_ID, SEED_IDS.home, 'block', 'Engineering', '🛠️', {
    content: [SEED_IDS.sprint42, SEED_IDS.archReview],
  });
  const pSprint = page(SEED_IDS.sprint42, NEXUS_HQ_ID, SEED_IDS.engineering, 'block', 'Sprint 42', '🏃');
  const pArch = page(SEED_IDS.archReview, NEXUS_HQ_ID, SEED_IDS.engineering, 'block', 'Architecture Review', '🔍');
  const pDesign = page(SEED_IDS.design, NEXUS_HQ_ID, SEED_IDS.home, 'block', 'Design', '🎨', {
    content: [SEED_IDS.brand, SEED_IDS.icons],
  });
  const pBrand = page(SEED_IDS.brand, NEXUS_HQ_ID, SEED_IDS.design, 'block', 'Brand Guidelines', '🎭');
  const pIcons = page(SEED_IDS.icons, NEXUS_HQ_ID, SEED_IDS.design, 'block', 'Icon Library', '🖼️');
  const pJournal = page(SEED_IDS.journal, NEXUS_HQ_ID, NEXUS_HQ_ID, 'space', 'Personal Journal', '📓');
  const pOldRetro = page(SEED_IDS.oldRetro, NEXUS_HQ_ID, NEXUS_HQ_ID, 'space', 'Old Sprint Retro', '📓', {
    alive: false,
    content: [],
  });
  const pOldChecklist = page(SEED_IDS.oldChecklist, NEXUS_HQ_ID, SEED_IDS.home, 'block', 'Old Launch Checklist', '📋', {
    alive: false,
    content: [SEED_IDS.oldChecklistText],
  });

  // Tasks board page renders the collection view projection directly.
  const pTasks = block(SEED_IDS.tasksPage, 'collection_view', NEXUS_HQ_ID, SEED_IDS.home, 'block', {
    properties: {
      title: [['Task Board']],
      collection_id: SEED_IDS.tasksCollection,
    },
    format: { page_icon: '✅' },
  });

  // --- Collection + view + rows ----------------------------------------------
  const TASKS_TITLE = 'prop_title';
  const TASKS_STATUS = 'prop_status';
  const tasksCollectionRecord: Collection = {
    id: SEED_IDS.tasksCollection,
    space_id: NEXUS_HQ_ID,
    parent_id: SEED_IDS.tasksPage,
    name: [['Task Board']],
    icon: '✅',
    schema: {
      [TASKS_TITLE]: { name: 'Name', type: 'title' },
      [TASKS_STATUS]: {
        name: 'Status',
        type: 'select',
        options: [
          { id: 'opt_todo', value: 'Todo', color: 'gray' },
          { id: 'opt_doing', value: 'Doing', color: 'blue' },
          { id: 'opt_done', value: 'Done', color: 'green' },
        ],
      },
    },
    alive: true,
    version: 1,
    created_time: NOW,
    last_edited_time: NOW,
    created_by_id: CURRENT_USER.id,
    last_edited_by_id: CURRENT_USER.id,
  };

  const tasksViewRecord: CollectionView = {
    id: SEED_IDS.tasksView,
    space_id: NEXUS_HQ_ID,
    collection_id: SEED_IDS.tasksCollection,
    type: 'table',
    name: 'Table',
    format: {
      table_properties: [
        { property: TASKS_TITLE, visible: true, width: 320 },
        { property: TASKS_STATUS, visible: true, width: 160 },
      ],
    },
    query2: {},
    alive: true,
    version: 1,
    created_time: NOW,
    last_edited_time: NOW,
    created_by_id: CURRENT_USER.id,
    last_edited_by_id: CURRENT_USER.id,
  };

  const taskRowBlock = (id: UUID, title: string, status: string) =>
    block(id, 'page', NEXUS_HQ_ID, SEED_IDS.tasksCollection, 'collection', {
      properties: {
        [TASKS_TITLE]: [[title]],
        [TASKS_STATUS]: status,
      },
      format: {},
    });

  const taskBlocks = [
    taskRowBlock(SEED_IDS.taskShip, 'Ship Phase 10 web shell', 'opt_doing'),
    taskRowBlock(SEED_IDS.taskCi, 'Set up CI for apps/web', 'opt_todo'),
    taskRowBlock(SEED_IDS.taskAnnounce, 'Draft launch announcement', 'opt_done'),
  ];

  // --- Design Lab workspace ---------------------------------------------------
  const designHomeBlock = page(SEED_IDS.designHome, DESIGN_LAB_ID, DESIGN_LAB_ID, 'space', 'Design Lab', '🎨', {
    content: [SEED_IDS.designTokens, SEED_IDS.designMotion],
  });
  const designTokensBlock = page(SEED_IDS.designTokens, DESIGN_LAB_ID, SEED_IDS.designHome, 'block', 'Design Tokens', '🎭');
  const designMotionBlock = page(SEED_IDS.designMotion, DESIGN_LAB_ID, SEED_IDS.designHome, 'block', 'Motion Principles', '🎬');

  blocks.push(
    pHome,
    pOnboarding,
    pGettingStarted,
    pNorms,
    pProduct,
    pRoadmap,
    pReleases,
    pEngineering,
    pSprint,
    pArch,
    pDesign,
    pBrand,
    pIcons,
    pJournal,
    pOldRetro,
    pOldChecklist,
    pTasks,
    homeWelcome,
    homeQuote,
    homeHeader,
    homeTodo,
    homeCallout,
    normNote,
    roadmapNoteBlock,
    oldChecklistTextBlock,
    ...taskBlocks,
    designHomeBlock,
    designTokensBlock,
    designMotionBlock,
  );

  return {
    blocks,
    collections: [tasksCollectionRecord],
    collectionViews: [tasksViewRecord],
  };
}

/* -------------------------------------------------------------------------- */
/* Chrome (favorites / teamspaces / comments / notifications)                 */
/* -------------------------------------------------------------------------- */

export interface SeedChrome {
  favorites: UUID[];
  privatePages: UUID[];
  teamspaces: Teamspace[];
  inlineComments: InlineComment[];
  threads: DiscussionThread[];
  notifications: ShellNotification[];
  peers: PresencePeer[];
}

function findBlockByTitle(blocks: Block[], title: string): Block | undefined {
  return blocks.find((candidate) => {
    if (candidate.type !== 'page') return false;
    const titleSegment = (candidate.properties?.title as RichText | undefined)?.[0];
    return titleSegment?.[0] === title;
  });
}

/** Derives the seeded UI chrome (favorites, teamspaces, comments, inbox). */
export function seedChrome(blocks: Block[]): SeedChrome {
  const home = findBlockByTitle(blocks, 'Home');
  const gettingStarted = findBlockByTitle(blocks, 'Getting Started');
  const roadmap = findBlockByTitle(blocks, 'Roadmap 2026');
  const sprint42 = findBlockByTitle(blocks, 'Sprint 42');
  const arch = findBlockByTitle(blocks, 'Architecture Review');
  const design = findBlockByTitle(blocks, 'Design');
  const brand = findBlockByTitle(blocks, 'Brand Guidelines');
  const engineering = findBlockByTitle(blocks, 'Engineering');
  const journal = blocks.find(
    (candidate) =>
      candidate.type === 'page' &&
      candidate.format?.page_icon === '📓' &&
      candidate.alive &&
      candidate.parent_table === 'space',
  );

  const welcome = blocks.find(
    (candidate) =>
      candidate.type === 'text' &&
      (candidate.properties?.title as RichText | undefined)?.some(([text]) =>
        text.includes('onboarding checklist'),
      ),
  );

  const favorites: UUID[] = [home?.id ?? '', gettingStarted?.id ?? '', roadmap?.id ?? '', sprint42?.id ?? ''].filter(
    Boolean,
  );

  const privatePages: UUID[] = journal ? [journal.id] : [];

  const teamspaces: Teamspace[] = [
    {
      id: 'ts-engineering',
      name: 'Engineering',
      icon: '🛠️',
      color: '#0ea5e9',
      pageIds: [engineering?.id ?? '', sprint42?.id ?? '', arch?.id ?? ''].filter(Boolean),
    },
    {
      id: 'ts-design',
      name: 'Design',
      icon: '🎨',
      color: '#d946ef',
      pageIds: [design?.id ?? '', brand?.id ?? ''].filter(Boolean),
    },
  ];

  const inlineComments: InlineComment[] =
    home && welcome
      ? [
          {
            id: 'ic-1',
            pageId: home.id,
            blockId: welcome.id,
            anchor: 'onboarding checklist',
            author: VESTA_ADA,
            body: 'Can we add a sign-up step here so new hires do not get stuck?',
            resolved: false,
            reactions: { '🎉': 1 },
            replies: [
              {
                id: 'ic-1r',
                author: VESTA_GRACE,
                body: 'Yes — I will draft the steps after standup.',
                createdAt: NOW + 5,
              },
            ],
            createdAt: NOW + 4,
          },
          {
            id: 'ic-2',
            pageId: home.id,
            blockId: welcome.id,
            anchor: 'Q4 2026',
            author: VESTA_ALAN,
            body: 'Confirm the quarter — looks right, ship it.',
            resolved: true,
            reactions: {},
            replies: [],
            createdAt: NOW + 3,
          },
        ]
      : [];

  const threads: DiscussionThread[] = home
    ? [
        {
          id: 't-1',
          pageId: home.id,
          author: VESTA_ADA,
          body: 'Can we move the release to Friday?',
          resolved: false,
          reactions: { '🎉': 2 },
          replies: [
            {
              id: 't-1r',
              author: VESTA_GRACE,
              body: 'Yes — and add the sign-up step to the launch.',
              createdAt: NOW + 6,
            },
          ],
          createdAt: NOW + 2,
        },
        {
          id: 't-2',
          pageId: home.id,
          author: VESTA_GRACE,
          body: 'Do we still have the Q3 retro deck ready?',
          resolved: true,
          reactions: { '🚀': 1 },
          replies: [{ id: 't-2r', author: VESTA_ALAN, body: 'Yes, it is in the deck archive.', createdAt: NOW + 7 }],
          createdAt: NOW + 1,
        },
      ]
    : [];

  if (roadmap) {
    threads.push({
      id: 't-3',
      pageId: roadmap.id,
      author: VESTA_NORA,
      body: 'Can we add the mobile milestone to the Q4 board?',
      resolved: false,
      reactions: {},
      replies: [],
      createdAt: NOW,
    });
  }

  const notifications: ShellNotification[] = [
    {
      id: 'n-1',
      kind: 'mention',
      title: 'Ada mentioned you',
      body: '@you — can we ship the shell first?',
      pageId: roadmap?.id,
      authorName: VESTA_ADA.name,
      authorColor: VESTA_ADA.color,
      unread: true,
      createdAt: NOW,
    },
    {
      id: 'n-2',
      kind: 'reply',
      title: 'Grace replied to you',
      body: 'Yes — add the sign-up step to the launch.',
      pageId: sprint42?.id,
      authorName: VESTA_GRACE.name,
      authorColor: VESTA_GRACE.color,
      unread: true,
      createdAt: NOW - 1,
    },
    {
      id: 'n-3',
      kind: 'invite',
      title: 'Alan was invited',
      body: 'Alan was added to Design Lab.',
      pageId: DESIGN_LAB_ID,
      authorName: VESTA_ALAN.name,
      authorColor: VESTA_ALAN.color,
      unread: true,
      createdAt: NOW - 2,
    },
    {
      id: 'n-4',
      kind: 'mention',
      title: 'Nora mentioned you',
      body: '@you — can you review the brand tokens?',
      pageId: design?.id,
      authorName: VESTA_NORA.name,
      authorColor: VESTA_NORA.color,
      unread: false,
      createdAt: NOW - 3,
    },
    {
      id: 'n-5',
      kind: 'reply',
      title: 'Kai replied to you',
      body: 'I added the CI checklist to the roadmap.',
      pageId: gettingStarted?.id,
      authorName: VESTA_KAI.name,
      authorColor: VESTA_KAI.color,
      unread: false,
      createdAt: NOW - 4,
    },
  ];

  return {
    favorites,
    privatePages,
    teamspaces,
    inlineComments,
    threads,
    notifications,
    peers: SEED_PEERS,
  };
}

/** Legacy alias kept for compatibility with the first draft. */
export function seedRecords() {
  const fixture = seedFixture();
  return fixture;
}
