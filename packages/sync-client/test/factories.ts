/**
 * Test fixtures: canonical record + transaction factories.
 *
 * Fixtures are built from the real `@votion/types` contracts so a drift in the
 * data model fails the typecheck layer of `pnpm test` before any assertion runs.
 */

import type {
  Block,
  Collection,
  CollectionView,
  Operation,
  RichText,
  Transaction,
  UUID,
} from '@votion/types';

export const SPACE_ID: UUID = '38a8e10b-47e4-4d89-b14e-b86a8ff35df1';
export const SPACE_ID_B: UUID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
export const USER_ID: UUID = '9b2f4c6d-1e3a-4b5c-8d7e-6f5a4b3c2d1e';
export const PAGE_ID: UUID = '76ef2b14-8c8f-402a-9e12-32b036ca6d5f';

/** Monotonic counter so fixture timestamps are deterministic and ordered. */
let clock = 1_700_000_000_000;

/** Advances and returns the fixture clock (epoch ms). */
export function tick(step = 1): number {
  clock += step;
  return clock;
}

/** Resets the fixture clock. */
export function resetClock(): void {
  clock = 1_700_000_000_000;
}

/** Deterministic UUID-shaped id generator (stable across runs). */
export function id(n: number): UUID {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

/** Builds a `page` block, optionally with children. */
export function makePage(
  overrides: Partial<Block> & { id?: UUID; children?: UUID[] } = {},
): Block {
  const { children, ...rest } = overrides;
  const timestamp = tick();
  return {
    id: rest.id ?? id(1),
    space_id: SPACE_ID,
    version: 1,
    type: 'page',
    properties: { title: [['Untitled']] },
    format: {},
    content: children ?? [],
    parent_id: rest.parent_id ?? SPACE_ID,
    parent_table: 'space',
    alive: true,
    created_time: timestamp,
    last_edited_time: timestamp,
    created_by_id: USER_ID,
    last_edited_by_id: USER_ID,
    ...rest,
  };
}

/** Builds a text block. */
export function makeTextBlock(overrides: Partial<Block> = {}): Block {
  const timestamp = tick();
  return {
    id: overrides.id ?? id(2),
    space_id: SPACE_ID,
    version: 1,
    type: 'text',
    properties: { title: [['Hello world']] },
    format: {},
    content: [],
    parent_id: PAGE_ID,
    parent_table: 'block',
    alive: true,
    created_time: timestamp,
    last_edited_time: timestamp,
    created_by_id: USER_ID,
    last_edited_by_id: USER_ID,
    ...overrides,
  };
}

/** Builds a `to_do` block. */
export function makeTodoBlock(overrides: Partial<Block> = {}): Block {
  return makeTextBlock({
    type: 'to_do',
    properties: { title: [['Ship Phase 2']], checked: [['no']] },
    ...overrides,
  });
}

/** Builds a collection record. */
export function makeCollection(
  overrides: Partial<Collection> = {},
): Collection {
  return {
    id: overrides.id ?? id(100),
    space_id: SPACE_ID,
    parent_id: PAGE_ID,
    name: [['Tasks']],
    schema: {
      title: { name: 'Name', type: 'title' },
      status: {
        name: 'Status',
        type: 'status',
        options: [
          { id: 'opt_todo', value: 'To do', color: 'gray' },
          { id: 'opt_done', value: 'Done', color: 'green' },
        ],
      },
    },
    alive: true,
    version: 1,
    ...overrides,
  };
}

/** Builds a collection view record. */
export function makeCollectionView(
  overrides: Partial<CollectionView> = {},
): CollectionView {
  return {
    id: overrides.id ?? id(200),
    space_id: SPACE_ID,
    collection_id: overrides.collection_id ?? id(100),
    type: 'table',
    name: 'All tasks',
    format: {},
    query2: {},
    alive: true,
    version: 1,
    ...overrides,
  };
}

/** Builds a rich text value from plain text. */
export function richText(text: string): RichText {
  return [[text]];
}

/** Builds a transaction wrapping pre-built operations. */
export function makeTransaction(
  operations: Operation[],
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: overrides.id ?? id(900),
    spaceId: overrides.spaceId ?? SPACE_ID,
    operations,
    createdAt: overrides.createdAt ?? tick(),
    ...overrides,
  };
}
