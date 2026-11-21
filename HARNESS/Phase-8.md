# Autonomous Agent Harness Prompt: Phase 8 (Search & Discovery Engine)

> **File Location**: `HARNESS/Phase-8.md`  
> **Target Subsystem**: Phase 8 — Search & Discovery Engine (`@votion/search`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-8 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 7 deliverables defined in **Phase 8** of `TODO.md`. You will create `@votion/search`, which powers Notion's instant `Cmd+K` Quick Find modal: setting up Meilisearch Cloud index schemas, building the `DocumentTransformer` to strip rich-text tuples into clean search tokens, building the `QuickFindQueryBuilder` with typo-tolerance and scoped filters, and implementing the frontend search modal.

### Operational Guardrails
1. **Typo Tolerance & Latency**: Quick Find queries must execute in under 50ms with prefix matching and typo tolerance.
2. **Permission Scoping**: Search results must be strictly scoped to workspaces and sub-trees where the querying user has `read` access.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-8-search-discovery-engine
```

### Step 1: Package Scaffolding (`packages/search`)
* Create `packages/search/package.json` with dependencies: `meilisearch`, `@votion/types`, `react`, `lucide-react`.

### Step 2: Index Schema & Client Configuration (`src/client/`)
* `MeiliSearchClient.ts`:
  - Connects to Meilisearch using `MEILISEARCH_HOST` and `MEILISEARCH_API_KEY`.
  - Configures index `votion_blocks`:
    - Searchable attributes: `["title", "plain_text"]`.
    - Filterable attributes: `["space_id", "parent_id", "root_page_id", "created_by", "last_edited_time", "type"]`.
    - Ranking rules: `["words", "typo", "proximity", "attribute", "sort", "exactness"]`.

### Step 3: Document Ingestion Transformer (`src/indexer/`)
* `DocumentTransformer.ts`:
  - Converts rich-text array `[string, modifier[]][]` into a plain searchable string.
  - Extracts searchable text from diverse block types (Text, Headings, Todo, Callout, Code, Table cells).
  - Produces clean search document:
    ```typescript
    interface SearchDocument {
      id: string;
      space_id: string;
      parent_id: string;
      root_page_id: string;
      type: string;
      title: string;
      plain_text: string;
      created_by: string;
      last_edited_time: number;
    }
    ```

### Step 4: Query Builder & Facets (`src/query/`)
* `QuickFindQueryBuilder.ts`:
  - Builds Meilisearch search options:
    - Prefix search enabled on the last term.
    - Facet filters: `space_id = :currentSpace AND (root_page_id = :filterPage OR ...)`.
    - Highlighting options: `<mark>` tags around matching query terms in title and snippet previews.

### Step 5: Frontend `Cmd+K` Quick Find Modal (`src/components/`)
* `QuickFindModal.tsx`:
  - Triggered globally by `Cmd+K` or `Ctrl+K`.
  - Instant search-as-you-type with debouncing (150ms).
  - Displays breadcrumb context for matched results.
  - Recent pages history view when query input is empty.
  - Keyboard navigation (Arrow keys to navigate, Enter to jump to page, Escape to close).

---

## 3. Strict Verification & Gate Checklist

Run unit and search transformation tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/search run build` | Compiles search library and React components. Exit 0. |
| **V-02** | `pnpm --filter @votion/search run test:transformer` | Verifies rich-text tuples and complex blocks strip down to clean text tokens. Exit 0. |
| **V-03** | `pnpm --filter @votion/search run test:query` | Query builder generates valid Meilisearch facet syntax. Exit 0. |
| **V-04** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 8: Search & Discovery Engine** | `@votion/search` | ✅ Completed | 7 / 7 |
   ```
2. Check off all tasks under `## Phase 8: Search & Discovery Engine`.

---

## 5. Pull Request & Delivery Report Template

```bash
git add .
git commit -m "feat(search): implement Meilisearch schema, document transformer, and Cmd+K Quick Find modal"
git push -u origin feature/phase-8-search-discovery-engine
```

Output format:
```markdown
# 🚀 Phase 8 Delivery Report & Pull Request

### PR Title
`feat(search): implement Meilisearch schema, document transformer, and Cmd+K Quick Find modal`

### Branch
`feature/phase-8-search-discovery-engine` ➡️ `main`

### Summary of Changes
- Built `@votion/search` integrating with Meilisearch Cloud.
- Configured index schemas with typo tolerance, prefix matching, and ranking rules.
- Built `DocumentTransformer` to extract clean text from rich-text tuples and block trees.
- Built `QuickFindQueryBuilder` with workspace scoping and highlighted snippets.
- Implemented `Cmd+K` Quick Find modal with keyboard navigation and recent pages history.

### Verification Evidence
- [x] Document text extractor & transformer tests passed (Exit 0)
- [x] Query builder syntax tests passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
