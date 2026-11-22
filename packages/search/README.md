# `@votion/search`

Meilisearch-backed **search & discovery engine** for Votion: index schema and
provisioning, block → document transformation, the typo-tolerant Quick Find query
builder with strict permission scoping, and the `Cmd+K` React modal.

```
packages/search/
├── src/
│   ├── types.ts                  # SearchDocument, QuickFindQuery, ACL scope, hits
│   ├── highlight.ts              # <mark> parsing (segments, never raw HTML)
│   ├── client/
│   │   ├── indexSchema.ts        # votion_blocks schema (as data) + diffing
│   │   ├── MeiliSearchClient.ts  # connection, provisioning, tenant tokens
│   │   ├── SearchTransport.ts    # SearchExecutor contract + error types
│   │   ├── hitHydration.ts       # RawSearchHit -> QuickFindHit (highlights)
│   │   └── QuickFindSearchService.ts  # build → execute → hydrate → verify ACL
│   ├── indexer/
│   │   ├── DocumentTransformer.ts# rich-text tuples -> clean search tokens
│   │   └── BatchIndexer.ts       # batched upserts/deletes for the worker fleet
│   ├── query/
│   │   ├── FacetFilter.ts        # escaped filter primitives (no injection)
│   │   ├── AccessScopeFilter.ts  # fail-closed ACL filter
│   │   └── QuickFindQueryBuilder.ts
│   ├── components/
│   │   ├── QuickFindModal.tsx    # Cmd+K dialog
│   │   ├── QuickFindController.ts# framework-free debounce/cancel state machine
│   │   ├── useQuickFind.ts       # React adapter (useSyncExternalStore)
│   │   ├── useGlobalShortcut.ts  # Cmd/Ctrl+K, Cmd/Ctrl+P, Escape
│   │   ├── recentPages.ts        # recent-pages history (localStorage)
│   │   ├── HighlightedText.tsx   # segments -> <mark> nodes
│   │   └── format.ts             # relative time, type badges, breadcrumbs
│   └── scripts/provision.ts      # `pnpm provision` (idempotent schema apply)
└── test/                         # 224 tests across 9 files
```

## Index schema (`votion_blocks`)

| Setting        | Value                                                                                                                           |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| Primary key    | `id`                                                                                                                            |
| Searchable     | `title`, `plain_text`                                                                                                           |
| Filterable     | `space_id`, `parent_id`, `root_page_id`, `ancestor_ids`, `access_principals`, `created_by`, `last_edited_time`, `type`, `alive` |
| Sortable       | `last_edited_time`, `type`                                                                                                      |
| Ranking rules  | `words → typo → proximity → attribute → sort → exactness`                                                                       |
| Typo tolerance | 1 typo ≥ 4 chars, 2 typos ≥ 8 chars, numeric typos off                                                                          |
| Prefix search  | `indexingTime` (keeps `"roa"` → `"Roadmap"` under the 50 ms budget)                                                             |
| Search cutoff  | 150 ms (server-side safety net)                                                                                                 |
| Synonyms       | `todo/task`, `db/database/collection`, `doc/page`, `meeting/standup`, `roadmap/plan`                                            |

Search documents look like:

```json
{
  "id": "block-uuid",
  "space_id": "space-uuid",
  "parent_id": "page-uuid-9",
  "root_page_id": "page-uuid-9",
  "type": "text",
  "title": "Q4 Financial Roadmap",
  "plain_text": "Q4 Financial Roadmap …",
  "created_by": "user-uuid",
  "last_edited_time": 1795253400000,
  "ancestor_ids": ["page-uuid-1"],
  "access_principals": ["user:user-uuid"],
  "alive": true,
  "breadcrumb": "Projects"
}
```

`last_edited_time` is **epoch milliseconds**, matching `Timestamp` in
`@votion/types` and `blocks.last_edited_time` in `@votion/db`.

## Provisioning

```bash
export MEILISEARCH_HOST="https://ms-votion.meilisearch.io"
export MEILISEARCH_API_KEY="…"
pnpm --filter @votion/search run provision            # shared index
pnpm --filter @votion/search run provision -- --tenant eu   # votion_blocks_eu
```

Provisioning is idempotent: `ensureIndex()` creates the index when missing and
pushes only the settings that drifted, so it is safe on every deploy.

## Indexing (worker fleet)

```ts
import { BatchIndexer, createMeiliSearchClient } from '@votion/search';

const indexer = new BatchIndexer(createMeiliSearchClient(), { batchSize: 500 });
indexer.queueBlockTree(pageId, blocksById); // soft-deletes become deletions
await indexer.flush();
```

`transformBlock()` returns `document: null` with a `reason` (`deleted`, `empty`,
`not-indexable`, `missing-space`). `BatchIndexer` turns `deleted`/`empty` into
delete tasks so a page removed while offline stops matching immediately.

## Querying

```ts
import {
  QuickFindSearchService,
  createMeiliSearchClient,
} from '@votion/search';

const service = new QuickFindSearchService(createMeiliSearchClient());
const result = await service.search({ term: 'q4 roa', limit: 20 }, scope);
```

`scope` is a `QuickFindAccessScope` resolved by the ACL layer (`@votion/acl`,
Phase 7):

```ts
{
  userId,
  spaceIds: ['…'],                 // required: workspace membership
  readableRootPageIds: ['…'],      // readable sub-trees
  readableSubtreeIds: ['…'],       // individually shared pages
  principals: ['user:…', 'public'],// optional explicit grants
}
```

Resulting filter (ACL first, then user facets):

```
alive = true
  AND space_id = "…"
  AND (root_page_id IN ["…", "…"] OR ancestor_ids = "…" OR root_page_id = "…")
  AND access_principals = "user:…"
  AND type IN ["page", "heading_1"]
  AND last_edited_time >= 1790000000000
```

**Fail-closed guarantees**

1. An empty `spaceIds` (or an explicitly empty `readableRootPageIds`) yields
   `hasAccess: false`; the service returns an empty result **without calling
   Meilisearch**.
2. Every value passes through `escapeFilterValue()` — quotes and backslashes are
   escaped, control characters rejected, so a page title cannot inject a filter.
3. Hydrated hits are re-checked against the scope (`isQuickFindHitInScope`), so a
   stale or mis-configured index cannot leak a document.
4. The browser can be given a **tenant token** whose `searchRules` embed the same
   filter, so even a tampered client cannot widen its own access:

```ts
const token = await client.createScopedSearchToken({
  apiKeyUid,
  scopeFilter, // buildAccessScopeFilter(scope).filter
  expiresAt: new Date(Date.now() + 3_600_000),
});
```

## `Cmd+K` modal

```tsx
import {
  QuickFindModal,
  createMeiliSearchClient,
  QuickFindSearchService,
} from '@votion/search';

const service = new QuickFindSearchService(createMeiliSearchClient());

export function AppShell() {
  return (
    <QuickFindModal
      service={service}
      scope={scope}
      onSelect={(hit) => router.push(`/${hit.rootPageId}#${hit.id}`)}
    />
  );
}
```

- `Cmd+K` / `Ctrl+K` (also `Cmd/Ctrl+P`) toggles the dialog from anywhere.
- 150 ms debounce; superseded requests are aborted and stale responses dropped.
- `↑`/`↓` navigate, `Home`/`End` jump, `Enter` opens, `Escape` closes.
- Matches render as `<mark>` **React nodes** — never `dangerouslySetInnerHTML`.
- Breadcrumbs (`Projects › Q4`) and block-type badges on every row.
- Empty input shows recent pages (local history + server refresh), scoped to the
  active workspace.

## Verification

```bash
pnpm --filter @votion/search run build            # V-01  tsc emits dist/
pnpm --filter @votion/search run test:transformer # V-02  54 tests
pnpm --filter @votion/search run test:query       # V-03  50 tests
pnpm turbo run typecheck                          # V-04  whole monorepo
pnpm --filter @votion/search run test             # all 224 tests
```

Each script first builds `@votion/types` (its `dist/` is what `@votion/search`
compiles against), so the gates pass on a clean checkout without a prior
`turbo run build`.

Runtime dependencies: `meilisearch`, `react`, `lucide-react`, `@votion/types`.
No `any`, no DOM-only imports in the pure layers (the query/indexer/client code
builds and tests in Node without jsdom).
