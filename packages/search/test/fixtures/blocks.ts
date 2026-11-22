/**
 * Shared fixtures: realistic `Block` records covering every text-bearing family.
 */

import type {
  Block,
  BlockFormat,
  BlockProperties,
  BlockType,
  RichText,
} from '@votion/types';

const BASE_TIME = Date.UTC(2026, 10, 21, 9, 30, 0); // 2026-11-21T09:30:00Z

export interface MakeBlockOptions {
  id?: string;
  spaceId?: string;
  parentId?: string;
  type?: BlockType;
  properties?: BlockProperties;
  format?: BlockFormat;
  content?: string[];
  alive?: boolean;
  createdBy?: string;
  createdTime?: number;
  lastEditedTime?: number;
  lastEditedBy?: string;
  parentTable?: Block['parent_table'];
}

/** Builds a complete, valid `Block` with sensible defaults. */
export function makeBlock(options: MakeBlockOptions = {}): Block {
  const id = options.id ?? '11111111-1111-4111-8111-111111111111';
  return {
    id,
    space_id: options.spaceId ?? '99999999-9999-4999-8999-999999999999',
    version: 1,
    type: options.type ?? 'text',
    properties: options.properties ?? {},
    format: options.format ?? {},
    content: options.content ?? [],
    parent_id: options.parentId ?? '22222222-2222-4222-8222-222222222222',
    parent_table: options.parentTable ?? 'block',
    alive: options.alive ?? true,
    created_time: options.createdTime ?? BASE_TIME,
    last_edited_time: options.lastEditedTime ?? BASE_TIME,
    created_by_id: options.createdBy ?? '33333333-3333-4333-8333-333333333333',
    last_edited_by_id:
      options.lastEditedBy ??
      options.createdBy ??
      '33333333-3333-4333-8333-333333333333',
  };
}

/** Page fixtures forming a two-level tree (Projects > Q4 Roadmap > children). */
export const SPACE_ID = '99999999-9999-4999-8999-999999999999';
export const PROJECTS_PAGE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ROADMAP_PAGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const TEXT_BLOCK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const HEADING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const TODO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const CODE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
export const CALLOUT_ID = '12121212-1212-4212-8212-121212121212';
export const TABLE_ID = '13131313-1313-4313-8313-131313131313';
export const TABLE_CELL_ID = '14141414-1414-4414-8414-141414141414';
export const IMAGE_ID = '15151515-1515-4515-8515-151515151515';
export const DIVIDER_ID = '16161616-1616-4616-8616-161616161616';
export const COLUMN_ID = '17171717-1717-4717-8717-171717171717';
export const USER_ID = '18181818-1818-4818-8818-181818181818';
export const MENTIONED_PAGE_ID = '19191919-1919-4919-8919-191919191919';

/** Tasks page used by the "search in page" tests. */
const richTextHeading: RichText = [
  ['Q4 ', [['b']]],
  ['Financial ', [['i']]],
  ['Roadmap', [['_']]],
];

const richTextTodo: RichText = [
  ['Ship ', []],
  ['Quick', [['b']]],
  ['Find', [['b']]],
  [' by ', []],
  ['2026-12-01', [['d', { type: 'date', start_date: '2026-12-01' }]]],
];

const richTextCallout: RichText = [
  ['Ping ', []],
  ['@Ada', [['u', USER_ID]]],
  [' about the ', []],
  ['Plan', [['p', MENTIONED_PAGE_ID]]],
  [' doc', []],
];

const richTextInlineCode: RichText = [
  ['Run ', []],
  ['npm run build', [['c']]],
  [' then ', []],
  ['deploy', [['a', 'https://votion.dev/deploy']]],
];

const richTextEquation: RichText = [
  ['Energy: ', []],
  ['E = mc^2', [['e', 'E = mc^2']]],
];

/** A full page tree: Projects > Q4 Roadmap (+ 10 descendants). */
export function roadmapTree(): Map<string, Block> {
  const blocks: Block[] = [
    makeBlock({
      id: PROJECTS_PAGE_ID,
      type: 'page',
      properties: { title: [['Projects', []]] },
      content: [ROADMAP_PAGE_ID, TEXT_BLOCK_ID],
      parentId: SPACE_ID,
      parentTable: 'space',
    }),
    makeBlock({
      id: ROADMAP_PAGE_ID,
      type: 'page',
      properties: { title: [['Q4 Financial Roadmap', [['b']]]] },
      content: [
        HEADING_ID,
        TODO_ID,
        CODE_ID,
        CALLOUT_ID,
        TABLE_ID,
        IMAGE_ID,
        DIVIDER_ID,
        COLUMN_ID,
      ],
      parentId: PROJECTS_PAGE_ID,
    }),
    makeBlock({
      id: TEXT_BLOCK_ID,
      type: 'text',
      properties: { title: [['Portfolio planning notes', []]] },
      parentId: PROJECTS_PAGE_ID,
    }),
    makeBlock({
      id: HEADING_ID,
      type: 'heading_1',
      properties: { title: richTextHeading },
      parentId: ROADMAP_PAGE_ID,
    }),
    makeBlock({
      id: TODO_ID,
      type: 'to_do',
      properties: { title: richTextTodo, checked: [['no']] },
      parentId: ROADMAP_PAGE_ID,
    }),
    makeBlock({
      id: CODE_ID,
      type: 'code',
      properties: {
        title: [['const tax = rate * 1.2;\nconsole.log(tax);', []]],
        language: [['typescript']],
      },
      parentId: ROADMAP_PAGE_ID,
    }),
    makeBlock({
      id: CALLOUT_ID,
      type: 'callout',
      properties: { title: richTextCallout },
      parentId: ROADMAP_PAGE_ID,
    }),
    makeBlock({
      id: TABLE_ID,
      type: 'table',
      properties: { table_block_column_order: [] },
      content: [TABLE_CELL_ID],
      parentId: ROADMAP_PAGE_ID,
    }),
    makeBlock({
      id: TABLE_CELL_ID,
      type: 'text',
      properties: { title: [['Revenue target 4.2M', []]] },
      parentId: TABLE_ID,
    }),
    makeBlock({
      id: IMAGE_ID,
      type: 'image',
      properties: {
        source: [['https://media.votion.dev/charts/q4.png']],
        caption: [['Q4 revenue projection', [['i']]]],
      },
      parentId: ROADMAP_PAGE_ID,
    }),
    makeBlock({
      id: DIVIDER_ID,
      type: 'divider',
      parentId: ROADMAP_PAGE_ID,
    }),
    makeBlock({
      id: COLUMN_ID,
      type: 'column',
      properties: {},
      parentId: ROADMAP_PAGE_ID,
    }),
  ];

  const map = new Map<string, Block>();
  for (const block of blocks) {
    map.set(block.id, block);
  }
  return map;
}

export const RICH_TEXT_CASES = {
  heading: richTextHeading,
  todo: richTextTodo,
  callout: richTextCallout,
  inlineCode: richTextInlineCode,
  equation: richTextEquation,
} as const;

export { BASE_TIME };
