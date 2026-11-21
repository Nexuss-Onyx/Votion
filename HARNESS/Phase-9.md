# Autonomous Agent Harness Prompt: Phase 9 (Background Worker Fleet)

> **File Location**: `HARNESS/Phase-9.md`  
> **Target Subsystem**: Phase 9 — Background Worker Fleet & Media Pipeline (`apps/task-worker`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-9 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 11 deliverables defined in **Phase 9** of `TODO.md`. You will create `apps/task-worker`, which consumes asynchronous background job queues using BullMQ on Redis: cascading soft-deletes down deep page trees, updating search indexes in Meilisearch, recalculating dependent database rollups, resizing media images with Sharp, scraping OpenGraph link previews, and processing Markdown/CSV/PDF export and import tasks.

### Operational Guardrails
1. **Asynchronous Decoupling**: Heavy tasks (PDF rendering, large sub-tree cascading, batch indexing) must never block HTTP transaction endpoints.
2. **Idempotence**: Every worker job must be idempotent so that automatic retries do not produce duplicate records or inconsistent states.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-9-background-worker-fleet
```

### Step 1: Application Setup (`apps/task-worker`)
* Create `apps/task-worker/package.json` with dependencies: `bullmq`, `ioredis` (or `@upstash/redis`), `sharp`, `puppeteer-core`, `archiver`, `open-graph-scraper`, `@votion/types`, `@votion/db`, `@votion/search`.
* Configure worker runners with graceful shutdown on `SIGTERM`.

### Step 2: Queue Definitions (`src/queues/`)
* Configure BullMQ queues:
  - `search-indexing.queue`: Block insertion and modification indexing.
  - `hierarchy-cascade.queue`: Sub-tree soft deletes and permission inheritance updates.
  - `rollup-calculator.queue`: Recalculating cross-collection rollups.
  - `media-processor.queue`: Image thumbnailing and OpenGraph metadata fetching.
  - `export.queue`: Asynchronous Markdown, CSV, and PDF bundle creation.
  - `import.queue`: Ingestion and AST parsing of uploaded files.

### Step 3: Core Worker Implementations (`src/workers/`)
* `HierarchyCascadeWorker.ts`:
  - When a parent page is marked `alive: false`, traverses all child blocks in batches of 500 and marks them `alive: false`.
* `SearchIndexingWorker.ts`:
  - Receives block modification events, transforms rich text into search tokens via `@votion/search`, and updates Meilisearch.
* `RollupWorker.ts`:
  - Finds all database rows referencing an edited page through a Relation property and recomputes the Rollup values.
* `MediaProcessorWorker.ts`:
  - For image attachments: Generates WebP thumbnails (small, medium, large) using Sharp and uploads them to Cloudflare R2 / AWS S3.
  - For bookmark blocks: Calls `open-graph-scraper` to extract title, description, and preview image URL.
* `ExportWorker.ts`:
  - Packages page sub-trees into Markdown and CSV files.
  - Compresses into a `.zip` archive using `archiver`, uploads to S3, and generates a time-limited download URL.
* `ImportWorker.ts`:
  - Parses Markdown and HTML files into Notion block trees, preserving headings, lists, code blocks, and formatting.

---

## 3. Strict Verification & Gate Checklist

Run unit and job execution tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/task-worker run build` | Compiles worker fleet application. Exit 0. |
| **V-02** | `pnpm --filter @votion/task-worker run test:cascade` | Verifies recursive soft-delete cascades down 100 nested blocks. Exit 0. |
| **V-03** | `pnpm --filter @votion/task-worker run test:media` | Verifies image thumbnail generation and WebP compression with Sharp. Exit 0. |
| **V-04** | `pnpm --filter @votion/task-worker run test:import-export` | Markdown import $\rightarrow$ Block tree $\rightarrow$ Markdown export round-trip verification passes. Exit 0. |
| **V-05** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 9: Background Worker Fleet** | `apps/task-worker` | ✅ Completed | 11 / 11 |
   ```
2. Check off all tasks under `## Phase 9: Background Worker Fleet`.

---

## 5. Pull Request & Delivery Report Template

```bash
git add .
git commit -m "feat(task-worker): implement BullMQ worker fleet for cascade deletes, indexing, media, and export/import"
git push -u origin feature/phase-9-background-worker-fleet
```

Output format:
```markdown
# 🚀 Phase 9 Delivery Report & Pull Request

### PR Title
`feat(task-worker): implement BullMQ worker fleet for cascade deletes, indexing, media, and export/import`

### Branch
`feature/phase-9-background-worker-fleet` ➡️ `main`

### Summary of Changes
- Built `apps/task-worker` with BullMQ queue architecture on Redis.
- Implemented `HierarchyCascadeWorker` for batch soft-deleting and permission cascading on deep sub-trees.
- Implemented `SearchIndexingWorker` for asynchronous Meilisearch document updates.
- Implemented `MediaProcessorWorker` generating WebP thumbnails with Sharp and scraping OpenGraph link previews.
- Implemented `ExportWorker` generating Markdown/CSV zip archives and `ImportWorker` converting Markdown into Notion block ASTs.

### Verification Evidence
- [x] Recursive sub-tree cascade worker test passed (Exit 0)
- [x] Sharp image WebP resizing test passed (Exit 0)
- [x] Markdown import/export round-trip test passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
