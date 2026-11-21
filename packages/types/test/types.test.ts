import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type Block,
  type BlockFormat,
  type BlockProperties,
  type BlockType,
  type Collection,
  type CollectionProperty,
  type CollectionView,
  type CollectionViewFormat,
  type CollectionViewQuery,
  type FilterGroup,
  type Operation,
  type OperationPointer,
  type RecordUpdatedEnvelope,
  type RichText,
  type RichTextSegment,
  type SaveTransactionsRequest,
  type TextModifier,
  type Transaction,
  type UUID,
  type ViewType,
  type WorkspaceRole,
  getBlockTitle,
  getPropertiesOfType,
  getSegmentLink,
  getTransactionPointers,
  hasModifier,
  isBlock,
  isCollection,
  isCollectionView,
  isFilterGroup,
  isOperation,
  isPresenceEnvelope,
  isRecordUpdatedEnvelope,
  isRichText,
  isSubscribeEnvelope,
  isTextModifier,
  isTransaction,
  keyedObjectSetOperation,
  listAfterOperation,
  listBeforeOperation,
  listRemoveOperation,
  mergeTransactions,
  plainTextToRichText,
  richTextToPlainText,
  roleSatisfies,
  setOperation,
  updateOperation,
} from '../src/index.js';

// =============================================================
// Compile-time fixtures: every fixture is checked by `tsc`, so a
// regression in the contracts fails the typecheck layer of `pnpm test`.
// =============================================================

const SPACE_ID: UUID = '38a8e10b-47e4-4d89-b14e-b86a8ff35df1';
const PAGE_ID = '76ef2b14-8c8f-402a-9e12-32b036ca6d5f';
const BLOCK_ID = '0f1e2d3c-4b5a-6978-8a9b-cdef01234567';

const richTextFixture = [
  ['Bold and Italic text', [['b'], ['i']]],
  [' Normal text '],
  ['inline code', [['c']]],
  ['underline', [['_']]],
  ['strikethrough', [['s']]],
  ['link to site', [['a', 'https://github.com']]],
  ['highlighted', [['h', 'yellow_background']]],
  ['E=mc^2', [['e', 'E=mc^2']]],
  ['user mention', [['u', 'user-uuid-1']]],
  ['page mention', [['p', 'page-uuid-2']]],
  ['date mention', [['d', { type: 'date', start_date: '2026-11-21' }]]],
] satisfies RichText;

const blockFixture = {
  id: BLOCK_ID,
  space_id: SPACE_ID,
  version: 1,
  type: 'text',
  properties: { title: [['Hello Votion']] } satisfies BlockProperties,
  format: { block_color: 'gray_background' } satisfies BlockFormat,
  content: [],
  parent_id: PAGE_ID,
  parent_table: 'block',
  alive: true,
  created_time: 1716300000000,
  last_edited_time: 1716300050000,
  created_by_id: 'user-uuid-1',
  last_edited_by_id: 'user-uuid-1',
} satisfies Block;

const todoFixture = {
  ...blockFixture,
  type: 'to_do',
  properties: { title: [['Ship Phase 1']], checked: [['no']] },
} satisfies Block;

const collectionFixture = {
  id: 'coll-uuid-1',
  space_id: SPACE_ID,
  parent_id: PAGE_ID,
  name: [['Sprint Tasks']],
  schema: {
    title: { name: 'Task Name', type: 'title' },
    prop_status: {
      name: 'Status',
      type: 'status',
      options: [
        { id: 's1', value: 'To Do', color: 'default' },
        { id: 's2', value: 'In Progress', color: 'blue' },
        { id: 's3', value: 'Done', color: 'green' },
      ],
      groups: [{ id: 'g1', name: 'Complete', color: 'green', option_ids: ['s3'] }],
    },
    prop_rel_project: {
      name: 'Project',
      type: 'relation',
      collection_id: 'coll-projects-uuid',
      relation: { collection_id: 'coll-projects-uuid', property_id: 'prop_backlink' },
    },
    prop_points: { name: 'Points', type: 'number', number_format: 'number' },
    prop_points_rollup: {
      name: 'Total points',
      type: 'rollup',
      relation_property_id: 'prop_rel_project',
      target_property_id: 'prop_points',
      rollup: {
        relation_property_id: 'prop_rel_project',
        target_property_id: 'prop_points',
        aggregation: 'sum',
      },
    },
  } satisfies Record<string, CollectionProperty>,
  icon: '🚀',
  alive: true,
  version: 1,
} satisfies Collection;

const viewTypesFixture = [
  'table',
  'board',
  'calendar',
  'timeline',
  'gallery',
  'list',
] satisfies ViewType[];

const viewFilterFixture = {
  operator: 'and',
  clauses: [
    { property: 'prop_status', comparator: 'equals', value: 'In Progress' },
    {
      operator: 'or',
      clauses: [
        { property: 'prop_points', comparator: 'greater_than', value: 3 },
        { property: 'title', comparator: 'contains', value: 'phase' },
      ],
    },
  ],
} satisfies FilterGroup;

const viewQueryFixture = {
  filter: viewFilterFixture,
  sort: [{ property: 'prop_points', direction: 'descending' }],
  aggregations: [{ property: 'prop_points', aggregation: 'sum' }],
} satisfies CollectionViewQuery;

const viewFormatFixture = {
  table_properties: [{ property: 'title', visible: true, width: 280 }],
  board_columns_by: 'prop_status',
  gallery_cover: 'content',
} satisfies CollectionViewFormat;

const collectionViewFixture = {
  id: 'view-uuid-1',
  space_id: SPACE_ID,
  collection_id: 'coll-uuid-1',
  type: 'table',
  name: 'All tasks',
  format: viewFormatFixture,
  query2: viewQueryFixture,
  alive: true,
  version: 2,
} satisfies CollectionView;

const pointerFixture: OperationPointer = {
  table: 'block',
  id: BLOCK_ID,
  spaceId: SPACE_ID,
};

const operationsFixture = [
  setOperation(pointerFixture, ['properties', 'title'], [['Updated Document Title']]),
  updateOperation(pointerFixture, ['format'], { block_color: 'blue_background' }),
  listAfterOperation(pointerFixture, ['content'], BLOCK_ID, null),
  listBeforeOperation(pointerFixture, ['content'], BLOCK_ID, PAGE_ID),
  listRemoveOperation(pointerFixture, ['content'], BLOCK_ID),
  keyedObjectSetOperation(pointerFixture, ['properties'], 'prop_status', 's2'),
] satisfies Operation[];

const transactionFixture = {
  id: 'tx-1234-uuid',
  spaceId: SPACE_ID,
  operations: operationsFixture,
  createdAt: 1716300050000,
} satisfies Transaction;

const saveRequestFixture = {
  requestId: 'req-9876-uuid',
  transactions: [transactionFixture],
} satisfies SaveTransactionsRequest;

// Negative compile-time assertions: invalid payloads must not typecheck.

// @ts-expect-error - property type is a closed union
const invalidPropertyType: CollectionProperty = { name: 'Bad', type: 'rating' };

// @ts-expect-error - view type is a closed union
const invalidViewType: ViewType = 'kanban';

// @ts-expect-error - `d` modifier requires DateMetadata, not a bare string
const invalidDateModifier: TextModifier = ['d', '2026-11-21'];

// @ts-expect-error - unknown operation commands are rejected
const invalidCommand: Operation = { pointer: pointerFixture, path: [], command: 'delete', args: {} };

// @ts-expect-error - `owner` is not an entity-level permission role
const invalidWorkspaceRole: WorkspaceRole = 'superadmin';

// @ts-expect-error - blocks cannot be parented to a collection view
const invalidParent: Block = { ...blockFixture, parent_table: 'collection_view' };

void [
  richTextFixture,
  blockFixture,
  todoFixture,
  collectionFixture,
  viewTypesFixture,
  viewQueryFixture,
  viewFormatFixture,
  collectionViewFixture,
  saveRequestFixture,
  invalidPropertyType,
  invalidViewType,
  invalidDateModifier,
  invalidCommand,
  invalidWorkspaceRole,
  invalidParent,
];

// =============================================================
// Runtime tests
// =============================================================

describe('rich text contracts', () => {
  it('exposes the canonical tuple shape', () => {
    expectTypeOf<RichTextSegment>().toEqualTypeOf<
      [content: string, modifiers?: TextModifier[]]
    >();
    expectTypeOf<RichText>().toEqualTypeOf<RichTextSegment[]>();
    expect(richTextFixture).toHaveLength(11);
  });

  it('flattens rich text into plain text', () => {
    expect(richTextToPlainText(richTextFixture)).toBe(
      'Bold and Italic text Normal text inline codeunderlinestrikethroughlink to sitehighlightedE=mc^2user mentionpage mention2026-11-21',
    );
    expect(richTextToPlainText(undefined)).toBe('');
  });

  it('builds rich text from plain text', () => {
    expect(plainTextToRichText('Hello')).toEqual([['Hello']]);
    expect(plainTextToRichText('')).toEqual([]);
    expectTypeOf(plainTextToRichText).returns.toEqualTypeOf<RichText>();
  });

  it('validates modifiers and segments', () => {
    expect(isTextModifier(['b'])).toBe(true);
    expect(isTextModifier(['a', 'https://votion.dev'])).toBe(true);
    expect(isTextModifier(['d', { type: 'date', start_date: '2026-11-21' }])).toBe(true);
    expect(isTextModifier(['d', 'nope'])).toBe(false);
    expect(isTextModifier(['z'])).toBe(false);
    expect(isRichText([['hello', [['b']]]])).toBe(true);
    expect(isRichText([['hello', [['z']]]])).toBe(false);
    expect(isRichText('not rich text')).toBe(false);
  });

  it('reads links and modifiers off a segment', () => {
    const segment: RichTextSegment = ['link', [['a', 'https://votion.dev'], ['b']]];
    expect(getSegmentLink(segment)?.[1]).toBe('https://votion.dev');
    expect(hasModifier(segment, 'b')).toBe(true);
    expect(hasModifier(segment, 'i')).toBe(false);
  });
});

describe('block contracts', () => {
  it('narrows persisted blocks', () => {
    expect(isBlock(blockFixture)).toBe(true);
    expect(isBlock({ id: BLOCK_ID })).toBe(false);
    expect(getBlockTitle(blockFixture)).toEqual([['Hello Votion']]);
  });

  it('types every block type in the union', () => {
    const allBlockTypes: BlockType[] = [
      'page',
      'text',
      'heading_1',
      'heading_2',
      'heading_3',
      'bulleted_list_item',
      'numbered_list_item',
      'to_do',
      'toggle',
      'quote',
      'callout',
      'divider',
      'column_list',
      'column',
      'table',
      'collection_view',
      'synced_block',
      'template',
      'code',
      'math',
      'image',
      'video',
      'audio',
      'file',
      'pdf',
      'bookmark',
      'embed',
    ];
    expect(new Set(allBlockTypes).size).toBeGreaterThanOrEqual(26);
  });

  it('keeps block properties typed without `any`', () => {
    expectTypeOf<Block['properties']['title']>().toEqualTypeOf<RichText | undefined>();
    expectTypeOf<Block['parent_table']>().toEqualTypeOf<'block' | 'collection' | 'space'>();
    expectTypeOf<Block['content']>().toEqualTypeOf<UUID[]>();
  });
});

describe('collection contracts', () => {
  it('narrows persisted collections', () => {
    expect(isCollection(collectionFixture)).toBe(true);
    expect(isCollection({ id: 'x' })).toBe(false);
  });

  it('finds schema entries by type', () => {
    expect(findTitlePropertyId(collectionFixture)).toBe('title');
    const relations = getPropertiesOfType(collectionFixture.schema, 'relation');
    expect(relations.map(([id]) => id)).toEqual(['prop_rel_project']);
  });

  function findTitlePropertyId(collection: Collection): string | undefined {
    for (const [id, property] of Object.entries(collection.schema)) {
      if (property.type === 'title') {
        return id;
      }
    }
    return undefined;
  }
});

describe('collection view contracts', () => {
  it('narrows persisted views and filter trees', () => {
    expect(isCollectionView(collectionViewFixture)).toBe(true);
    expect(isCollectionView({ id: 'x' })).toBe(false);
    expect(isFilterGroup(viewFilterFixture)).toBe(true);
    expect(isFilterGroup(viewFilterFixture.clauses[0]!)).toBe(false);
    expect(viewTypesFixture).toHaveLength(6);
  });
});

describe('transaction contracts', () => {
  it('builds typed operations', () => {
    expect(operationsFixture).toHaveLength(6);
    expect(operationsFixture.every(isOperation)).toBe(true);
    expect(operationsFixture.map((operation) => operation.command)).toEqual([
      'set',
      'update',
      'listAfter',
      'listBefore',
      'listRemove',
      'keyedObjectSet',
    ]);
  });

  it('validates transactions and derives touched pointers', () => {
    expect(isTransaction(transactionFixture)).toBe(true);
    expect(isTransaction({ id: 'tx' })).toBe(false);
    expect(getTransactionPointers(transactionFixture)).toEqual([pointerFixture]);
  });

  it('merges operation batches', () => {
    const merged = mergeTransactions('tx-merged', SPACE_ID, [
      transactionFixture,
      transactionFixture,
    ]);
    expect(merged.operations).toHaveLength(12);
    expect(merged.spaceId).toBe(SPACE_ID);
  });
});

describe('websocket contracts', () => {
  it('narrows envelopes', () => {
    const recordUpdated = {
      type: 'record_updated',
      table: 'block',
      id: BLOCK_ID,
      version: 43,
      patch: { properties: { title: [['Updated Document Title']] } },
    } satisfies RecordUpdatedEnvelope;

    expect(isRecordUpdatedEnvelope(recordUpdated)).toBe(true);
    expect(
      isPresenceEnvelope({
        type: 'presence',
        pageId: PAGE_ID,
        userId: 'user-uuid-1',
        cursor: { x: 320, y: 485 },
        activeBlockId: BLOCK_ID,
        selectedRange: { start: 0, end: 14 },
      }),
    ).toBe(true);
    expect(
      isSubscribeEnvelope({
        action: 'subscribe',
        subscriptions: [{ table: 'collection', id: 'coll-uuid-1' }],
      }),
    ).toBe(true);
  });
});

describe('permission contracts', () => {
  it('ranks workspace roles', () => {
    expect(roleSatisfies('owner', 'admin')).toBe(true);
    expect(roleSatisfies('guest', 'member')).toBe(false);
  });
});
