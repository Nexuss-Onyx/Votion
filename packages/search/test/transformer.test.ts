/**
 * V-02 — DocumentTransformer / BatchIndexer verification.
 *
 * Proves that rich-text tuples and every text-bearing block family strip down
 * to clean search tokens: no modifier tags, no UUIDs, no JSON punctuation, no
 * leading/trailing whitespace, and stable output for identical input.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Block, RichText } from '@votion/types';

import {
  BatchIndexer,
  collapseWhitespace,
  extractBlockText,
  isIndexableBlockType,
  isUuidLike,
  richTextToSearchText,
  segmentToPlainText,
  stripRichTextMarkup,
  toIndexPayload,
  transformBlock,
  transformBlockTree,
  transformBlocks,
  type DocumentWriter,
} from '../src/indexer/index.js';
import type { SearchDocument } from '../src/types.js';
import {
  BASE_TIME,
  CALLOUT_ID,
  CODE_ID,
  HEADING_ID,
  IMAGE_ID,
  MENTIONED_PAGE_ID,
  PROJECTS_PAGE_ID,
  ROADMAP_PAGE_ID,
  SPACE_ID,
  TEXT_BLOCK_ID,
  TODO_ID,
  USER_ID,
  makeBlock,
  roadmapTree,
} from './fixtures/blocks.js';

/* -------------------------------------------------------------------------- */
/* Rich text flattening                                                       */
/* -------------------------------------------------------------------------- */

describe('richTextToSearchText', () => {
  it('rejoins words split across styled segments', () => {
    const richText: RichText = [
      ['Road', [['b']]],
      ['map', [['i']]],
    ];
    expect(richTextToSearchText(richText)).toBe('Roadmap');
  });

  it('drops modifier tags entirely', () => {
    const text = richTextToSearchText([
      ['Bold', [['b']]],
      [' ', []],
      ['italic', [['i']]],
      [' ', []],
      ['code', [['c']]],
      [' ', []],
      ['link', [['a', 'https://votion.dev']]],
      [' ', []],
      ['painted', [['h', 'yellow']]],
    ]);
    expect(text).toBe('Bold italic code link painted');
    for (const tag of ['"b"', '"i"', '"c"', '"h"', '[[', ']]']) {
      expect(text).not.toContain(tag);
    }
  });

  it('keeps a hyperlink URL out of the index', () => {
    const text = richTextToSearchText([
      ['docs', [['a', 'https://example.com/private?token=secret']]],
    ]);
    expect(text).toBe('docs');
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('secret');
  });

  it('renders date mentions as readable ISO tokens', () => {
    expect(
      richTextToSearchText([
        ['Due ', []],
        ['2026-12-01', [['d', { type: 'date', start_date: '2026-12-01' }]]],
      ]),
    ).toBe('Due 2026-12-01');

    expect(
      richTextToSearchText([
        ['Sprint ', []],
        [
          'range',
          [
            [
              'd',
              {
                type: 'date',
                start_date: '2026-11-01',
                end_date: '2026-11-14',
              },
            ],
          ],
        ],
      ]),
    ).toBe('Sprint 2026-11-01 → 2026-11-14');
  });

  it('indexes inline equations from their LaTeX payload', () => {
    expect(
      richTextToSearchText([
        ['Area: ', []],
        ['pi r squared', [['e', 'pi r^2']]],
      ]),
    ).toBe('Area: pi r^2');
  });

  it('drops raw UUIDs from user and page mentions', () => {
    const text = richTextToSearchText([
      ['Ping ', []],
      [USER_ID, [['u', USER_ID]]],
      [' about ', []],
      [MENTIONED_PAGE_ID, [['p', MENTIONED_PAGE_ID]]],
    ]);
    expect(text).toBe('Ping about');
    expect(text).not.toContain(USER_ID);
    expect(text).not.toContain(MENTIONED_PAGE_ID);
  });

  it('keeps human-readable mention content', () => {
    expect(richTextToSearchText([['@Ada Lovelace', [['u', USER_ID]]]])).toBe(
      '@Ada Lovelace',
    );
  });

  it('collapses whitespace, newlines and control characters', () => {
    expect(
      richTextToSearchText([
        ['  leading', []],
        ['\n\ttabbed\u0000', []],
        ['   trailing  ', []],
      ]),
    ).toBe('leading tabbed trailing');
  });

  it('handles empty, null and malformed payloads defensively', () => {
    expect(richTextToSearchText([])).toBe('');
    expect(richTextToSearchText(undefined)).toBe('');
    expect(richTextToSearchText(null)).toBe('');
    // Structurally invalid tuples must not throw.
    expect(richTextToSearchText([[] as unknown as ['']])).toBe('');
  });

  it('is idempotent and deterministic', () => {
    const input: RichText = [
      ['Quarterly ', [['b']]],
      ['goals', [['i']]],
    ];
    const once = richTextToSearchText(input);
    expect(richTextToSearchText(input)).toBe(once);
    expect(richTextToSearchText([[once]])).toBe(once);
    expect(stripRichTextMarkup).toBe(richTextToSearchText);
  });

  it('handles unicode, emoji and non-latin scripts', () => {
    expect(
      richTextToSearchText([
        ['ሰላም ', []],
        ['世界', [['b']]],
        [' 🚀', []],
      ]),
    ).toBe('ሰላም 世界 🚀');
  });
});

describe('segmentToPlainText', () => {
  it('returns plain content for unstyled segments', () => {
    expect(segmentToPlainText(['plain'])).toBe('plain');
  });

  it('keeps text for styling-only modifiers', () => {
    expect(segmentToPlainText(['x', [['b'], ['i'], ['s'], ['_']]])).toBe('x');
  });

  it('falls back to content when a date modifier is malformed', () => {
    expect(
      segmentToPlainText(['literal', [['d', { type: 'date' } as never]]]),
    ).toBe('literal');
  });
});

describe('collapseWhitespace / isUuidLike', () => {
  it('normalises every whitespace flavour', () => {
    expect(collapseWhitespace(' a \n\t b \r\n c ')).toBe('a b c');
  });

  it('recognises canonical UUIDs only', () => {
    expect(isUuidLike(TEXT_BLOCK_ID)).toBe(true);
    expect(isUuidLike('not-a-uuid')).toBe(false);
    expect(isUuidLike('Q4 Roadmap')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Per-block-family extraction                                                */
/* -------------------------------------------------------------------------- */

describe('extractBlockText', () => {
  it('extracts headings with mid-word styling rejoined', () => {
    const { title } = extractBlockText(
      makeBlock({
        type: 'heading_1',
        properties: {
          title: [
            ['Q4 ', [['b']]],
            ['Roadmap', [['_']]],
          ],
        },
      }),
    );
    expect(title).toBe('Q4 Roadmap');
  });

  it('extracts to-do text plus its date mention', () => {
    const { title } = extractBlockText(
      makeBlock({
        type: 'to_do',
        properties: {
          title: [
            ['Ship it by ', []],
            ['2026-12-01', [['d', { type: 'date', start_date: '2026-12-01' }]]],
          ],
          checked: [['no']],
        },
      }),
    );
    expect(title).toBe('Ship it by 2026-12-01');
  });

  it('extracts callout text without mention ids', () => {
    const { title } = extractBlockText(
      makeBlock({
        type: 'callout',
        properties: {
          title: [
            ['Ask ', []],
            ['@Ada', [['u', USER_ID]]],
          ],
        },
      }),
    );
    expect(title).toBe('Ask @Ada');
  });

  it('keeps code verbatim, newlines normalised, plus the language', () => {
    const { title, body } = extractBlockText(
      makeBlock({
        type: 'code',
        properties: {
          title: [['function add(a, b) {\n  return a + b;\n}', []]],
          language: [['typescript']],
        },
      }),
    );
    expect(title).toBe('function add(a, b) { return a + b; }');
    expect(body).toBe('function add(a, b) { return a + b; } typescript');
  });

  it('extracts math (LaTeX) blocks', () => {
    const { title } = extractBlockText(
      makeBlock({
        type: 'math',
        properties: { title: [['\\int_0^1 x^2 dx', []]] },
      }),
    );
    expect(title).toBe('\\int_0^1 x^2 dx');
  });

  it('extracts media captions but never the file URL', () => {
    const { title, body } = extractBlockText(
      makeBlock({
        type: 'image',
        properties: {
          source: [['https://media.votion.dev/q4.png']],
          caption: [['Q4 chart', [['i']]]],
        },
      }),
    );
    expect(title).toBe('');
    expect(body).toBe('Q4 chart');
    expect(body).not.toContain('media.votion.dev');
  });

  it('extracts bookmark captions with the URL (links are searchable content)', () => {
    const { body } = extractBlockText(
      makeBlock({
        type: 'bookmark',
        properties: {
          source: [['https://meilisearch.com/docs']],
          caption: [['Meili docs', []]],
        },
      }),
    );
    expect(body).toContain('Meili docs');
    expect(body).toContain('meilisearch.com');
  });

  it('contributes no text for structural containers', () => {
    for (const type of [
      'divider',
      'column',
      'column_list',
      'template',
    ] as const) {
      const { title, body } = extractBlockText(makeBlock({ type }));
      expect(title).toBe('');
      expect(body).toBe('');
    }
  });

  it('extracts table cell text through the generic text path', () => {
    const { title } = extractBlockText(
      makeBlock({
        type: 'text',
        properties: { title: [['Revenue 4.2M', []]] },
      }),
    );
    expect(title).toBe('Revenue 4.2M');
  });

  it('extracts collection view titles', () => {
    const { title } = extractBlockText(
      makeBlock({
        type: 'collection_view',
        properties: { title: [['Project Tracker', []]] },
      }),
    );
    expect(title).toBe('Project Tracker');
  });
});

/* -------------------------------------------------------------------------- */
/* Document assembly                                                          */
/* -------------------------------------------------------------------------- */

describe('transformBlock', () => {
  it('produces the canonical SearchDocument shape', () => {
    const block = makeBlock({
      id: ROADMAP_PAGE_ID,
      type: 'page',
      properties: {
        title: [
          ['Q4 Financial ', [['b']]],
          ['Roadmap', [['_']]],
        ],
      },
      parentId: PROJECTS_PAGE_ID,
      spaceId: SPACE_ID,
      createdBy: USER_ID,
      lastEditedTime: BASE_TIME,
    });

    const result = transformBlock(block, {
      rootPageId: ROADMAP_PAGE_ID,
      ancestorIds: [PROJECTS_PAGE_ID],
      breadcrumb: 'Projects',
      accessPrincipals: [`user:${USER_ID}`, 'public'],
    });

    expect(result.skipped).toBe(false);
    const document = result.document as SearchDocument;

    expectTypeOf(document).toMatchTypeOf<SearchDocument>();
    expect(Object.keys(document).sort()).toEqual(
      [
        'access_principals',
        'alive',
        'ancestor_ids',
        'breadcrumb',
        'created_by',
        'id',
        'last_edited_time',
        'parent_id',
        'plain_text',
        'root_page_id',
        'space_id',
        'title',
        'type',
      ].sort(),
    );
    expect(document).toMatchObject({
      id: ROADMAP_PAGE_ID,
      space_id: SPACE_ID,
      parent_id: PROJECTS_PAGE_ID,
      root_page_id: ROADMAP_PAGE_ID,
      type: 'page',
      title: 'Q4 Financial Roadmap',
      created_by: USER_ID,
      last_edited_time: BASE_TIME,
      ancestor_ids: [PROJECTS_PAGE_ID],
      access_principals: [`user:${USER_ID}`, 'public'],
      alive: true,
      breadcrumb: 'Projects',
    });
    // The title is repeated in plain_text so phrase queries spanning title and
    // body still match, but never duplicated more than once.
    expect(document.plain_text).toBe('Q4 Financial Roadmap');
  });

  it('is JSON-serialisable (index payload carries no class instances)', () => {
    const { document } = transformBlock(
      makeBlock({ type: 'text', properties: { title: [['Hello', []]] } }),
    );
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it('skips soft-deleted blocks (so the indexer can delete them)', () => {
    const result = transformBlock(
      makeBlock({ alive: false, properties: { title: [['gone', []]] } }),
    );
    expect(result.document).toBeNull();
    expect(result.reason).toBe('deleted');
  });

  it('skips empty blocks', () => {
    expect(
      transformBlock(makeBlock({ type: 'text', properties: {} })).reason,
    ).toBe('empty');
    expect(
      transformBlock(
        makeBlock({ type: 'text', properties: { title: [['   ', []]] } }),
      ).reason,
    ).toBe('empty');
  });

  it('skips structurally non-textual blocks', () => {
    expect(transformBlock(makeBlock({ type: 'divider' })).reason).toBe(
      'not-indexable',
    );
    expect(transformBlock(makeBlock({ type: 'column' })).reason).toBe(
      'not-indexable',
    );
  });

  it('flags blocks without a workspace', () => {
    const block = makeBlock({
      type: 'text',
      properties: { title: [['x', []]] },
    });
    // @ts-expect-error - simulate a corrupt row from the database.
    block.space_id = undefined;
    const result = transformBlock(block);
    expect(result.document).toBeNull();
    expect(result.reason).toBe('missing-space');
  });

  it('normalises ISO timestamps to epoch milliseconds', () => {
    const block = makeBlock({
      type: 'text',
      properties: { title: [['x', []]] },
    });
    (block as unknown as { last_edited_time: unknown }).last_edited_time =
      '2026-11-21T09:30:00Z';
    const { document } = transformBlock(block);
    expect(document?.last_edited_time).toBe(BASE_TIME);
  });

  it('defaults missing authors to a sentinel instead of undefined', () => {
    const block = makeBlock({
      type: 'text',
      properties: { title: [['x', []]] },
    });
    (block as unknown as { created_by_id: unknown }).created_by_id = '';
    expect(transformBlock(block).document?.created_by).toBe('unknown');
  });

  it('never emits undefined/NaN into a payload', () => {
    const { document } = transformBlock(
      makeBlock({ type: 'text', properties: { title: [['payload', []]] } }),
    );
    const payload = toIndexPayload(document as SearchDocument);
    for (const [key, value] of Object.entries(payload)) {
      expect(value, `payload.${key}`).not.toBeUndefined();
    }
    expect(Number.isFinite(payload.last_edited_time as number)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Tree traversal                                                             */
/* -------------------------------------------------------------------------- */

describe('transformBlockTree', () => {
  it('walks a page tree depth-first and inherits workspace + breadcrumb', () => {
    const documents = transformBlockTree(ROADMAP_PAGE_ID, roadmapTree());
    const ids = documents.map((document) => document.id);

    expect(ids[0]).toBe(ROADMAP_PAGE_ID);
    expect(ids).toContain(HEADING_ID);
    expect(ids).toContain(TODO_ID);
    expect(ids).toContain(CODE_ID);
    expect(ids).toContain(CALLOUT_ID);
    expect(ids).toContain(IMAGE_ID);
    // Structural blocks never become documents.
    expect(documents.some((document) => document.type === 'divider')).toBe(
      false,
    );
    expect(documents.some((document) => document.type === 'column')).toBe(
      false,
    );

    const heading = documents.find((document) => document.id === HEADING_ID);
    expect(heading?.root_page_id).toBe(ROADMAP_PAGE_ID);
    expect(heading?.ancestor_ids).toEqual([ROADMAP_PAGE_ID]);
    expect(heading?.space_id).toBe(SPACE_ID);

    const root = documents.find((document) => document.id === ROADMAP_PAGE_ID);
    expect(root?.root_page_id).toBe(ROADMAP_PAGE_ID);
    expect(root?.ancestor_ids).toEqual([]);
  });

  it('propagates the breadcrumb trail to descendants', () => {
    const tree = roadmapTree();
    const documents = transformBlockTree(PROJECTS_PAGE_ID, tree);
    const roadmap = documents.find(
      (document) => document.id === ROADMAP_PAGE_ID,
    );
    expect(roadmap?.breadcrumb).toBe('Projects');
    expect(roadmap?.ancestor_ids).toEqual([PROJECTS_PAGE_ID]);

    const heading = documents.find((document) => document.id === HEADING_ID);
    expect(heading?.breadcrumb).toBe('Projects / Q4 Financial Roadmap');
  });

  it('honours a custom breadcrumb separator', () => {
    const documents = transformBlockTree(PROJECTS_PAGE_ID, roadmapTree(), {
      breadcrumbSeparator: ' › ',
    });
    const heading = documents.find((document) => document.id === HEADING_ID);
    expect(heading?.breadcrumb).toBe('Projects › Q4 Financial Roadmap');
  });

  it('accepts a block array as well as a map', () => {
    const tree = roadmapTree();
    const documents = transformBlockTree(ROADMAP_PAGE_ID, [...tree.values()]);
    expect(documents.length).toBe(
      transformBlockTree(ROADMAP_PAGE_ID, tree).length,
    );
  });

  it('tolerates partially loaded trees and cycles', () => {
    const cyclic = new Map<string, Block>();
    const a = makeBlock({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      type: 'page',
      properties: { title: [['A', []]] },
      content: ['bbbbbbbb-0000-4000-8000-000000000002', 'missing-child-id'],
    });
    const b = makeBlock({
      id: 'bbbbbbbb-0000-4000-8000-000000000002',
      type: 'text',
      properties: { title: [['B', []]] },
      content: [a.id],
      parentId: a.id,
    });
    cyclic.set(a.id, a);
    cyclic.set(b.id, b);

    const documents = transformBlockTree(a.id, cyclic);
    expect(documents.map((document) => document.id)).toEqual([a.id, b.id]);
  });

  it('returns nothing for an unknown root', () => {
    expect(
      transformBlockTree('00000000-0000-4000-8000-000000000000', roadmapTree()),
    ).toEqual([]);
  });

  it('makes descendants match a search-in-page query by parent title', () => {
    const documents = transformBlockTree(ROADMAP_PAGE_ID, roadmapTree());
    const heading = documents.find((document) => document.id === HEADING_ID);
    expect(heading?.plain_text).toContain('Q4 Financial Roadmap');
  });
});

describe('transformBlocks', () => {
  it('filters skipped blocks and keeps order', () => {
    const blocks = [
      makeBlock({
        id: 'a',
        type: 'text',
        properties: { title: [['one', []]] },
      }),
      makeBlock({ id: 'b', type: 'divider' }),
      makeBlock({
        id: 'c',
        type: 'heading_1',
        properties: { title: [['two', []]] },
      }),
    ];
    const documents = transformBlocks(blocks, { rootPageId: PROJECTS_PAGE_ID });
    expect(documents.map((document) => document.id)).toEqual(['a', 'c']);
    expect(
      documents.every((document) => document.root_page_id === PROJECTS_PAGE_ID),
    ).toBe(true);
  });
});

describe('isIndexableBlockType', () => {
  it('agrees with transformBlock for the structural types', () => {
    expect(isIndexableBlockType('text')).toBe(true);
    expect(isIndexableBlockType('page')).toBe(true);
    expect(isIndexableBlockType('collection_view')).toBe(true);
    expect(isIndexableBlockType('divider')).toBe(false);
    expect(isIndexableBlockType('column')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* BatchIndexer                                                               */
/* -------------------------------------------------------------------------- */

class FakeWriter implements DocumentWriter {
  readonly upserts: Record<string, unknown>[][] = [];
  readonly deletions: string[][] = [];
  failNext = false;
  private taskUid = 100;

  async upsertDocuments(
    documents: readonly Record<string, unknown>[],
  ): Promise<number | null> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('meilisearch unavailable');
    }
    this.upserts.push([...documents]);
    return this.taskUid++;
  }

  async deleteDocuments(ids: readonly string[]): Promise<number | null> {
    this.deletions.push([...ids]);
    return this.taskUid++;
  }
}

describe('BatchIndexer', () => {
  const document = (id: string, title = 'doc'): SearchDocument => ({
    id,
    space_id: SPACE_ID,
    parent_id: ROADMAP_PAGE_ID,
    root_page_id: ROADMAP_PAGE_ID,
    type: 'text',
    title,
    plain_text: title,
    created_by: USER_ID,
    last_edited_time: BASE_TIME,
    ancestor_ids: [ROADMAP_PAGE_ID],
    access_principals: [],
    alive: true,
  });

  it('flushes in batches and reports counts', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer, { batchSize: 2 });

    indexer.addMany([document('1'), document('2'), document('3')]);
    expect(indexer.pending).toBe(3);

    const result = await indexer.flush();
    expect(result.added).toBe(3);
    expect(result.deleted).toBe(0);
    expect(result.taskUids).toHaveLength(2);
    expect(writer.upserts.map((batch) => batch.length)).toEqual([2, 1]);
    expect(indexer.pending).toBe(0);
  });

  it('deduplicates upserts by id (last write wins)', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer);
    indexer.add(document('1', 'old')).add(document('1', 'new'));
    await indexer.flush();
    expect(writer.upserts).toHaveLength(1);
    expect(writer.upserts[0]).toHaveLength(1);
    expect(writer.upserts[0]?.[0]?.title).toBe('new');
  });

  it('turns deletions into delete tasks and drops queued upserts', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer);
    indexer.add(document('1')).remove('1').remove('2');
    await indexer.flush();
    expect(writer.upserts).toHaveLength(0);
    expect(writer.deletions).toEqual([['1', '2']]);
  });

  it('an upsert after a delete wins', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer);
    indexer.remove('1').add(document('1', 'restored'));
    await indexer.flush();
    expect(writer.deletions).toHaveLength(0);
    expect(writer.upserts[0]?.[0]?.title).toBe('restored');
  });

  it('queues soft-deleted blocks as deletions', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer);
    indexer.queueBlock(
      makeBlock({
        id: 'dead',
        alive: false,
        properties: { title: [['x', []]] },
      }),
    );
    indexer.queueBlock(
      makeBlock({
        id: 'live',
        type: 'text',
        properties: { title: [['y', []]] },
      }),
    );
    await indexer.flush();
    expect(writer.deletions).toEqual([['dead']]);
    expect(writer.upserts[0]?.map((payload) => payload.id)).toEqual(['live']);
  });

  it('ignores non-indexable blocks entirely', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer);
    indexer.queueBlock(makeBlock({ id: 'divider', type: 'divider' }));
    expect(indexer.pending).toBe(0);
  });

  it('queues a whole tree', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer, { batchSize: 100 });
    indexer.queueBlockTree(ROADMAP_PAGE_ID, roadmapTree());
    const result = await indexer.flush();
    expect(result.added).toBeGreaterThan(5);
  });

  it('surfaces writer failures without losing the buffer', async () => {
    const writer = new FakeWriter();
    const indexer = new BatchIndexer(writer, { batchSize: 1 });
    indexer.addMany([document('1'), document('2')]);
    writer.failNext = true;
    await expect(indexer.flush()).rejects.toThrow('meilisearch unavailable');
    // The failing chunk is gone, the rest is still pending and retryable.
    expect(indexer.pending).toBe(1);
    const retry = await indexer.flush();
    expect(retry.added).toBe(1);
  });

  it('discard() drops pending work', () => {
    const indexer = new BatchIndexer(new FakeWriter());
    indexer.add(document('1')).remove('2');
    indexer.discard();
    expect(indexer.pending).toBe(0);
  });

  it('auto-flushes at the pending threshold', async () => {
    const writer = new FakeWriter();
    const flushes: number[] = [];
    const indexer = new BatchIndexer(writer, {
      batchSize: 2,
      maxPending: 2,
      onFlush: (result) => flushes.push(result.added),
    });
    indexer.addMany([document('1'), document('2')]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flushes).toEqual([2]);
    expect(indexer.pending).toBe(0);
  });
});
