/**
 * Meilisearch index configuration for `votion_blocks`.
 *
 * The schema is declared as plain data ({@link BLOCKS_INDEX_SETTINGS}) and then
 * applied by {@link MeiliSearchClient}. Keeping it as a value (instead of
 * imperative calls scattered across the client) means:
 *
 *  - provisioning is idempotent and diffable;
 *  - the exact contract can be asserted in unit tests without a live cluster;
 *  - the edge worker and the CI `setup` script apply the same settings.
 *
 * The ranking rules follow the harness contract:
 * `words → typo → proximity → attribute → sort → exactness`.
 * `sort` sits above `exactness` so "recent pages" ordering (`sort:
 * last_edited_time:desc`) is stable, while typos still rank below exact words.
 */

import {
  FILTERABLE_ATTRIBUTES,
  RANKING_RULES,
  SEARCH_PRIMARY_KEY,
  SEARCHABLE_ATTRIBUTES,
} from '../types.js';

/** UID of the single blocks index. */
export const BLOCKS_INDEX_UID = 'votion_blocks';

/** Primary key of the blocks index. */
export const BLOCKS_INDEX_PRIMARY_KEY = SEARCH_PRIMARY_KEY;

/** Attributes Meilisearch tokenises and ranks on. */
export const INDEX_SEARCHABLE_ATTRIBUTES: readonly string[] = [
  ...SEARCHABLE_ATTRIBUTES,
];

/** Attributes usable in `filter` expressions. */
export const INDEX_FILTERABLE_ATTRIBUTES: readonly string[] = [
  ...FILTERABLE_ATTRIBUTES,
];

/** Attributes usable in `sort` expressions. */
export const INDEX_SORTABLE_ATTRIBUTES: readonly string[] = [
  'last_edited_time',
  'type',
];

/** Attributes stored and returned. */
export const INDEX_DISPLAYED_ATTRIBUTES: readonly string[] = [
  'id',
  'space_id',
  'parent_id',
  'root_page_id',
  'ancestor_ids',
  'type',
  'title',
  'plain_text',
  'created_by',
  'last_edited_time',
  'breadcrumb',
  'alive',
];

/** Ranking rules, in evaluation order. */
export const INDEX_RANKING_RULES: readonly string[] = [...RANKING_RULES];

/**
 * Typo tolerance: one typo from 4 characters, two from 8 — Meilisearch's
 * defaults, pinned explicitly so an index rebuild cannot drift. Ids and
 * timestamps are typo-sensitive by nature, so numeric typos are disabled.
 */
export const INDEX_TYPO_TOLERANCE = {
  enabled: true,
  disableOnAttributes: ['type', 'breadcrumb'],
  disableOnNumbers: true,
  minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
} as const;

/**
 * Prefix search is enabled at indexing time, which is what makes a 1–3
 * character query useful: `"roa"` matches `"Roadmap"` without a per-query
 * prefix scan, keeping keystroke latency well under the 50 ms budget.
 */
export const INDEX_PREFIX_SEARCH = 'indexingTime' as const;

/** Faceting: enough values for a usable filter pill list, no more. */
export const INDEX_FACETING = {
  maxValuesPerFacet: 100,
  sortFacetValuesBy: { '*': 'count' as const },
};

/** Pagination: Quick Find pages 20 at a time; cap deep pagination. */
export const INDEX_PAGINATION = {
  maxTotalHits: 1000,
};

/** Hard ceiling on a single query (Meilisearch cancels anything slower). */
export const INDEX_SEARCH_CUTOFF_MS = 150;

/** Synonyms that make Quick Find feel "smart" in a workspace context. */
export const INDEX_SYNONYMS: readonly (readonly string[])[] = [
  ['todo', 'to-do', 'task', 'checklist'],
  ['db', 'database', 'collection'],
  ['doc', 'document', 'page'],
  ['meeting', 'standup', 'sync'],
  ['roadmap', 'plan', 'milestones'],
];

/** Filler tokens dropped from queries before ranking. */
export const INDEX_STOP_WORDS: readonly string[] = [
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'and',
];

/**
 * Complete settings payload applied to `votion_blocks`.
 *
 * Typed structurally (rather than with `Settings` from the SDK) so the pure
 * layer builds without the `meilisearch` runtime.
 */
export interface BlocksIndexSettings {
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
  displayedAttributes: string[];
  rankingRules: string[];
  typoTolerance: {
    enabled: boolean;
    disableOnAttributes: string[];
    disableOnNumbers: boolean;
    minWordSizeForTypos: { oneTypo: number; twoTypos: number };
  };
  prefixSearch: 'indexingTime' | 'disabled';
  faceting: {
    maxValuesPerFacet: number;
    sortFacetValuesBy: Record<string, 'count' | 'alpha'>;
  };
  pagination: { maxTotalHits: number };
  searchCutoffMs: number;
  synonyms: Record<string, string[]>;
  stopWords: string[];
}

/** Expands the `[['a','b'], ['c']]` synonym list into Meilisearch's map form. */
export function buildSynonyms(
  groups: readonly (readonly string[])[] = INDEX_SYNONYMS,
): Record<string, string[]> {
  const synonyms: Record<string, string[]> = {};
  for (const group of groups) {
    const members = group.filter(
      (member) => typeof member === 'string' && member.length > 0,
    );
    for (const member of members) {
      const others = members.filter((other) => other !== member);
      const existing = synonyms[member] ?? [];
      synonyms[member] = [...new Set([...existing, ...others])];
    }
  }
  return synonyms;
}

/** The canonical settings object applied to the blocks index. */
export const BLOCKS_INDEX_SETTINGS: BlocksIndexSettings = {
  searchableAttributes: [...INDEX_SEARCHABLE_ATTRIBUTES],
  filterableAttributes: [...INDEX_FILTERABLE_ATTRIBUTES],
  sortableAttributes: [...INDEX_SORTABLE_ATTRIBUTES],
  displayedAttributes: [...INDEX_DISPLAYED_ATTRIBUTES],
  rankingRules: [...INDEX_RANKING_RULES],
  typoTolerance: {
    enabled: INDEX_TYPO_TOLERANCE.enabled,
    disableOnAttributes: [...INDEX_TYPO_TOLERANCE.disableOnAttributes],
    disableOnNumbers: INDEX_TYPO_TOLERANCE.disableOnNumbers,
    minWordSizeForTypos: { ...INDEX_TYPO_TOLERANCE.minWordSizeForTypos },
  },
  prefixSearch: INDEX_PREFIX_SEARCH,
  faceting: {
    maxValuesPerFacet: INDEX_FACETING.maxValuesPerFacet,
    sortFacetValuesBy: { ...INDEX_FACETING.sortFacetValuesBy },
  },
  pagination: { ...INDEX_PAGINATION },
  searchCutoffMs: INDEX_SEARCH_CUTOFF_MS,
  synonyms: buildSynonyms(),
  stopWords: [...INDEX_STOP_WORDS],
};

/**
 * Returns a copy of the settings for a tenant-specific index.
 *
 * Wasmer Edge deployments may shard one Meilisearch project per region/tenant;
 * the UID is composed so clean-up jobs can enumerate indices by prefix.
 */
export function blocksIndexUid(prefix?: string): string {
  if (!prefix || prefix.trim().length === 0) {
    return BLOCKS_INDEX_UID;
  }
  const safe = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  return `${BLOCKS_INDEX_UID}_${safe}`;
}

/**
 * Computes the minimum set of settings that differ between the live index and
 * the canonical schema, so a provision run does not rewrite everything.
 */
export function diffIndexSettings(
  current: Partial<BlocksIndexSettings> | null | undefined,
): Partial<BlocksIndexSettings> {
  if (!current) {
    return { ...BLOCKS_INDEX_SETTINGS };
  }
  const diff: Partial<BlocksIndexSettings> = {};
  const keys = Object.keys(
    BLOCKS_INDEX_SETTINGS,
  ) as (keyof BlocksIndexSettings)[];
  for (const key of keys) {
    const desired = BLOCKS_INDEX_SETTINGS[key];
    const actual = current[key];
    if (JSON.stringify(desired) !== JSON.stringify(actual)) {
      Object.assign(diff, { [key]: desired });
    }
  }
  return diff;
}
