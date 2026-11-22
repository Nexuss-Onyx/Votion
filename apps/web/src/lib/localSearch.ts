/**
 * Local in-memory search executor.
 *
 * Implements the `SearchExecutor` contract from `@votion/search` so the
 * Quick Find modal can run against the local record store (no Meilisearch
 * cluster required). The workspace shell seeds its fixture synchronously on
 * mount, so a pure scan over cached blocks is fast enough for instant
 * results.
 */

import type { Block, UUID } from '@votion/types';
import type { SearchExecutor, RawSearchResponse, RawSearchHit } from '@votion/search';
import { richTextToPlainText } from '@votion/types';
import type { RecordStoreApi } from '@votion/sync-client';

/** Derives the plain-text body of a block (text content + page title). */
function blockPlainText(block: Block): string {
  const title = richTextToPlainText(block.properties.title);
  return title;
}

function blockBreadcrumb(
  store: RecordStoreApi,
  block: Block,
): string | undefined {
  const chain: string[] = [];
  const seen = new Set<UUID>();
  let cursor: Block | undefined = block;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const title = richTextToPlainText(cursor.properties?.title);
    if (title) chain.push(title);
    if (cursor.parent_table !== 'block') break;
    cursor = store.getState().blocks[cursor.parent_id];
  }
  chain.reverse();
  if (chain.length <= 1) return undefined;
  return chain.join(' / ');
}

/** Scores a block against a lower-cased term. Higher is better. */
function scoreBlock(block: Block, term: string): number {
  if (term.length === 0) return 0;
  const title = richTextToPlainText(block.properties.title).toLowerCase();
  if (title.startsWith(term)) return 100;
  if (title.includes(term)) return 80;
  const body = blockPlainText(block).toLowerCase();
  if (body.includes(term)) return 40;
  // Page id / emoji fallback: exact id match is rare but useful for tests.
  if (block.id.toLowerCase() === term) return 10;
  return 0;
}

/** Walks to the ancestor page whose parent_table is `space`. */
function rootPageId(store: RecordStoreApi, block: Block): UUID {
  let cursor: Block | undefined = block;
  const seen = new Set<UUID>();
  while (cursor && cursor.parent_table === 'block' && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    cursor = store.getState().blocks[cursor.parent_id];
  }
  return cursor && cursor.parent_table === 'space' ? cursor.id : block.id;
}

/** Builds a `RawSearchHit` for a block record. */
function toRawHit(
  store: RecordStoreApi,
  block: Block,
  term: string,
  score: number,
): RawSearchHit {
  const title = richTextToPlainText(block.properties.title);
  const breadcrumb = blockBreadcrumb(store, block);
  return {
    id: block.id,
    space_id: block.space_id,
    parent_id: block.parent_id,
    root_page_id: rootPageId(store, block),
    type: block.type,
    title,
    plain_text: title,
    created_by: block.created_by_id,
    last_edited_time: block.last_edited_time,
    ancestor_ids: [],
    access_principals: [],
    alive: block.alive,
    breadcrumb: breadcrumb ?? (block.parent_table === 'space' ? title : undefined),
    _formatted: {
      title: title.replace(new RegExp(`(${term})`, 'ig'), '<mark>$1</mark>'),
    },
    _rankingScore: score,
  };
}

const INDEX_UID = 'votion_local';

/** In-memory executor backed by the normalized record store. */
export class LocalSearchExecutor implements SearchExecutor {
  readonly indexUid: string = INDEX_UID;

  constructor(private readonly store: RecordStoreApi) {}

  async execute(
    query: string,
    _options: unknown,
  ): Promise<RawSearchResponse> {
    const started = Date.now();
    const term = query.trim().toLowerCase();
    const state = this.store.getState();
    const candidates: Array<{ block: Block; score: number }> = [];

    for (const block of Object.values(state.blocks)) {
      if (!block.alive) continue;
      if (block.type !== 'page' && block.type !== 'collection_view' && block.type !== 'text') continue;
      const score = scoreBlock(block, term);
      if (score > 0) candidates.push({ block, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    const limited = candidates.slice(0, 20);

    const hits: RawSearchHit[] = limited.map(({ block, score }) =>
      toRawHit(this.store, block, term, score),
    );

    return {
      hits,
      estimatedTotalHits: candidates.length,
      totalHits: candidates.length,
      processingTimeMs: Date.now() - started,
    };
  }
}

