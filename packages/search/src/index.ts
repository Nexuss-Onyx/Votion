/**
 * `@votion/search` — Meilisearch-backed search & discovery engine.
 *
 * Public surface:
 *
 * | Layer       | Exports                                                          |
 * | :---------- | :--------------------------------------------------------------- |
 * | types       | `SearchDocument`, `QuickFindQuery`, `QuickFindHit`, ACL scope     |
 * | client      | `createMeiliSearchClient`, `BLOCKS_INDEX_SETTINGS`, hydrate hits  |
 * | indexer     | `transformBlock`, `transformBlockTree`, `BatchIndexer`            |
 * | query       | `buildQuickFindQuery`, `buildAccessScopeFilter`, filter primitives |
 * | components  | `QuickFindModal`, `useQuickFind`, `HighlightedText` (React)       |
 *
 * ```ts
 * import { createMeiliSearchClient, QuickFindSearchService } from '@votion/search';
 *
 * const client = createMeiliSearchClient();      // reads MEILISEARCH_HOST/API_KEY
 * await client.ensureIndex();
 * const service = new QuickFindSearchService(client);
 * const result = await service.search({ term: 'q4 roa' }, scope);
 * ```
 */

/** Version of the published contract surface. */
export const VOTION_SEARCH_VERSION = '0.1.0';

export * from './types.js';
export * from './highlight.js';
export * from './client/index.js';
export * from './indexer/index.js';
export * from './query/index.js';
export * from './components/index.js';
