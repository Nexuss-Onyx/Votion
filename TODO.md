# Votion: Master Engineering Implementation Checklist (TODO)

> **Companion Documents**:
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md) — System Architecture, Topology & Protocols
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md) — Engineering Subsystems, Interfaces & Data Contracts

---

## Progress Dashboard

| Subsystem / Phase | Package / App | Status | Tasks Completed |
| :--- | :--- | :---: | :---: |
| **Phase 0: Monorepo & Infrastructure** | `tooling/*`, `wasmer.toml` | ✅ Completed | 8 / 8 |
| **Phase 1: Core Contracts & Database** | `@votion/types`, `@votion/db` | ✅ Completed | 12 / 12 |
| **Phase 2: Client State & Offline Engine**| `@votion/sync-client` | ✅ Completed | 10 / 10 |
| **Phase 3: Block Editor & Canvas** | `@votion/editor` | ⬜ Not Started | 0 / 22 |
| **Phase 4: Database & Collection Engine** | `@votion/database-engine` | ⬜ Not Started | 0 / 20 |
| **Phase 5: Backend API & Transactions** | `apps/server` | ⬜ Not Started | 0 / 14 |
| **Phase 6: Real-Time Gateway & Collab** | `apps/sync-worker` | ✅ Completed | 9 / 9 |
| **Phase 7: Access Control & Permissions** | `@votion/acl` | ✅ Completed | 8 / 8 |
| **Phase 8: Search & Discovery Engine** | `@votion/search` | ⬜ Not Started | 0 / 7 |
| **Phase 9: Background Worker Fleet** | `apps/task-worker` | ⬜ Not Started | 0 / 11 |
| **Phase 10: Web Application Shell** | `apps/web` | ⬜ Not Started | 0 / 16 |
| **Phase 11: Developer API & Webhooks** | `apps/server/v1` | ⬜ Not Started | 0 / 8 |
| **Phase 12: Wasmer Edge Deployment** | `wasmer.toml`, Wasmer CLI | ⬜ Not Started | 0 / 8 |

---

## Phase 0: Monorepo Foundation & Tooling Setup

- [x] Initialize Turborepo monorepo with `pnpm` workspaces (`pnpm-workspace.yaml`).
- [x] Configure root `package.json` with workspace scripts (`build`, `dev`, `lint`, `test`, `typecheck`).
- [x] Set up `turbo.json` with task dependency pipelines and caching configurations.
- [x] Create shared TypeScript configuration package (`tooling/typescript-config` with `base.json`, `nextjs.json`, `node.json`).
- [x] Create shared ESLint & Prettier configuration package (`tooling/eslint-config`).
- [x] Install and verify Wasmer CLI (`~/.wasmer/bin/wasmer`).
- [x] Create root `wasmer.toml` application manifest.
- [x] Configure cloud-managed infrastructure connections:
  - [x] PostgreSQL 16 (Neon Serverless Postgres / Supabase with `uuid-ossp`, `pgcrypto`)
  - [x] Redis 7 (Upstash Serverless Redis / Redis Cloud)
  - [x] Meilisearch Cloud (v1.6+)
  - [x] Cloudflare R2 / AWS S3 (S3-compatible bucket with CORS configured)
- [x] Write `.env.example` defining environment variables and secrets across apps and packages.
- [x] Create automated local development startup script (`pnpm dev`).

---

## Phase 1: Shared Core Contracts & Database Tier (`@votion/types`, `@votion/db`)

### 1.1 Type Definitions (`packages/types`)
- [x] Define Rich Text data model (`RichText`, `RichTextSegment`, `TextModifier`).
- [x] Define canonical `Block` interface with all primitive and container types:
  - [x] `page`, `text`, `heading_1`, `heading_2`, `heading_3`
  - [x] `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`
  - [x] `quote`, `callout`, `divider`, `column_list`, `column`
  - [x] `table`, `collection_view`, `synced_block`, `code`, `math`
  - [x] `image`, `video`, `audio`, `file`, `pdf`, `bookmark`
- [x] Define `Collection` and `CollectionProperty` interfaces (Title, Select, Status, Relation, Rollup, Formula, etc.).
- [x] Define `CollectionView` interface supporting 6 view types (`table`, `board`, `calendar`, `timeline`, `gallery`, `list`).
- [x] Define Transaction operation protocol (`Transaction`, `Operation`, `OperationPointer`, `OperationCommand`).
- [x] Define WebSocket event envelopes (`subscribe`, `presence`, `record_updated`).

### 1.2 Database Migrations & Models (`packages/db`)
- [x] Select ORM/Query builder (Drizzle ORM or Kysely with PostgreSQL driver).
- [x] Create SQL migration for `workspaces` and `workspace_members`.
- [x] Create SQL migration for `users` and authentication accounts.
- [x] Create SQL migration for `blocks` with JSONB `properties`, `format`, and UUID array `content`.
- [x] Create SQL migration for `collections` and `collection_views`.
- [x] Create SQL migration for `permissions` (entity-level ACL overrides).
- [x] Create SQL migration for `transaction_records` (Write-Ahead Log for sync).
- [x] Create composite database indexes:
  - [x] `idx_blocks_space_id`, `idx_blocks_parent_id`, `idx_blocks_alive`
  - [x] GIN index on `blocks.properties`
  - [x] GIN index on `collections.schema`

---

## Phase 2: Client-Side State, Cache & Offline Engine (`@votion/sync-client`)

- [x] Set up normalized in-memory record store (Zustand):
  - [x] `Record<UUID, Block>`
  - [x] `Record<UUID, Collection>`
  - [x] `Record<UUID, CollectionView>`
- [x] Build IndexedDB persistent cache using Dexie.js:
  - [x] IndexedDB schema for `blocks`, `collections`, `views`, `outbox`.
  - [x] Hydrate in-memory Zustand store from IndexedDB on application launch.
- [x] Build `TransactionBuilder`:
  - [x] Helper methods to generate atomic `set`, `update`, `listAfter`, `listBefore`, `listRemove`.
- [x] Build `OptimisticPatcher`:
  - [x] Synchronously apply transactions to client Zustand memory before network confirmation.
- [x] Build persistent `OutboxStorage` queue:
  - [x] Queue unsent transactions during network offline events.
  - [x] Listen to browser `online` events and flush queued transactions in sequential batches.
- [x] Implement `SyncManager` & `Reconciler`:
  - [x] Batch outbound operations to `POST /api/v3/saveTransactions`.
  - [x] Apply inbound remote WebSocket record updates to Zustand and IndexedDB.
  - [x] Detect version conflicts and reconcile state.
- [x] Implement `PresenceClient`:
  - [x] Throttle and emit local mouse coordinates and active block ID.
  - [x] Store peer presence in ephemeral state.

---

## Phase 3: Block Editor & Canvas Engine (`@votion/editor`)

### 3.1 Core Canvas & Layout
- [ ] Build `BlockCanvas` component to recursively render block trees from `page.content`.
- [ ] Implement `BlockWrapper` component with hover action controls:
  - [ ] 6-dot drag handle button.
  - [ ] Quick `+` block insertion button.
  - [ ] Delete / Duplicate / Copy link context menu.
- [ ] Implement `ColumnLayout`:
  - [ ] `column_list` flex container.
  - [ ] Draggable percentage-based resize dividers between columns.
  - [ ] Convert single blocks into horizontal columns on drag-and-drop.

### 3.2 Block Renderers
- [ ] Text Block (`TextBlock.tsx`) with contenteditable and rich-text spans.
- [ ] Heading Blocks (`HeadingBlock.tsx` for H1, H2, H3 with toggle-collapse toggle).
- [ ] To-Do Block (`TodoBlock.tsx`) with checkbox toggle and strikethrough styling.
- [ ] List Blocks (`bulleted_list_item`, `numbered_list_item` with auto-increment numbers).
- [ ] Toggle Block (`ToggleBlock.tsx`) with expandable child block container.
- [ ] Quote Block (`QuoteBlock.tsx`) with accent left border.
- [ ] Callout Block (`CalloutBlock.tsx`) with emoji picker and background tint palette.
- [ ] Divider Block (`DividerBlock.tsx` `<hr />`).
- [ ] Code Block (`CodeBlock.tsx`) with Prism/Highlight.js syntax highlighting, language selector, line numbers, and copy button.
- [ ] Math Block (`MathBlock.tsx`) with inline/block KaTeX equation editing.
- [ ] Media Blocks:
  - [ ] Image block with upload preview, URL loader, and width resize handles.
  - [ ] Video/Audio block with custom media player controls.
  - [ ] File attachment block with download link and file size metadata.
  - [ ] Web Bookmark block with auto OpenGraph scraping card.
  - [ ] Sandboxed Embed block (YouTube, Figma, GitHub, CodePen).
- [ ] Synced Block (`SyncedBlock.tsx`) pointing to master block ID.

### 3.3 Editor Interactions & Shortcuts
- [ ] Build Slash Command Popover (`/`):
  - [ ] Filterable block catalog list.
  - [ ] Keyboard navigation (Arrow Up/Down, Enter to insert, Escape to close).
- [ ] Build Inline Floating Formatting Toolbar (appears on text selection):
  - [ ] Bold, Italic, Strikethrough, Underline, Code, Color highlight, Link insertion, Comment anchor.
- [ ] Implement Markdown auto-formatting shortcuts:
  - [ ] `# ` $\rightarrow$ Heading 1, `## ` $\rightarrow$ Heading 2, `### ` $\rightarrow$ Heading 3
  - [ ] `- ` or `* ` $\rightarrow$ Bulleted List
  - [ ] `1. ` $\rightarrow$ Numbered List
  - [ ] `[] ` $\rightarrow$ To-Do Checkbox
  - [ ] `> ` $\rightarrow$ Quote
  - [ ] `---` $\rightarrow$ Divider
  - [ ] ` ``` ` $\rightarrow$ Code Block
- [ ] Implement Drag-and-Drop system:
  - [ ] Visual blue drop line indicators (above, below, left, right).
  - [ ] Relative list reordering math (`listAfter`, `listBefore`).
- [ ] Implement Multi-Block Selection:
  - [ ] Click-and-drag bounding box (lasso selection).
  - [ ] Shift + Arrow block range selection.
  - [ ] Bulk block actions (indent/outdent with Tab/Shift+Tab, bulk delete, bulk move).

---

## Phase 4: Database & Collection Engine (`@votion/database-engine`)

### 4.1 Schema & Properties
- [ ] Property Registry & Schema Manager:
  - [ ] Primitive properties: Text, Number (format as currency/percent/progress), Select, Multi-select, Status, Date (with time & reminder), Checkbox, URL, Email, Phone.
  - [ ] Audit properties: Created time, Created by, Last edited time, Last edited by, Unique ID.
  - [ ] Add, rename, hide, duplicate, and delete properties in collection schema.

### 4.2 Projections & Views
- [ ] **Table View**:
  - [ ] Virtualized spreadsheet grid.
  - [ ] Draggable, resizable column headers.
  - [ ] In-cell editing for all property types.
  - [ ] Footer aggregations (Sum, Avg, Min, Max, Count).
- [ ] **Board View (Kanban)**:
  - [ ] Column groupings by Select, Status, or Date.
  - [ ] Drag-and-drop card movement between columns (updates record property).
  - [ ] Collapsible board columns and swimlanes.
- [ ] **Calendar View**:
  - [ ] Month and week grid projections based on Date property.
  - [ ] Drag-and-drop rescheduling.
- [ ] **Timeline View (Gantt)**:
  - [ ] Visual duration bars based on Date ranges (start/end).
  - [ ] Zoom scale controller (hours, days, weeks, months).
  - [ ] Dependency lines connecting related cards.
- [ ] **Gallery View**:
  - [ ] Responsive card grid.
  - [ ] Card cover picker (Page cover, Content preview, Custom file).
- [ ] **List View**:
  - [ ] High-density document list view with toggleable visible properties.

### 4.3 Query, Filter & Sort Engine
- [ ] Build recursive `FilterEvaluator`:
  - [ ] Compound `AND` / `OR` clause tree.
  - [ ] Type-specific operators (`equals`, `contains`, `is_empty`, `greater_than`, `is_checked`).
- [ ] Build `SortEngine`:
  - [ ] Multi-level ascending/descending property sorts.
- [ ] Implement Grouping Engine (group records into sections with counts).
- [ ] Implement Sub-Items (parent-child nested hierarchy within databases).

### 4.4 Formulas & Relational Graph
- [ ] Build **Formula 2.0 Engine**:
  - [ ] Lexer & Tokenizer.
  - [ ] Recursive Descent Parser producing AST.
  - [ ] AST Evaluator with runtime type checking.
  - [ ] Standard library functions (math, string manipulation, date math, list `map`/`filter`).
- [ ] Implement **Relation Properties**:
  - [ ] Two-way foreign key linking between collections.
  - [ ] Linked record picker modal.
- [ ] Implement **Rollup Engine**:
  - [ ] Look through Relation to target property.
  - [ ] Execute aggregation function (`Count all`, `Sum`, `Average`, `Percent checked`).

---

## Phase 5: Backend API & Transaction Server (`apps/server`)

- [ ] Bootstrap Fastify server with CORS, Helmet, and Compression plugins.
- [ ] Implement authentication & session management:
  - [ ] User signup, login, password hashing (Argon2 / bcrypt).
  - [ ] JWT issuance and refresh token rotation.
- [ ] Implement `POST /api/v3/saveTransactions`:
  - [ ] Validate request body and transaction schema.
  - [ ] Verify user permission on target entity records.
  - [ ] Execute PostgreSQL transaction applying operations (`set`, `update`, `listAfter`, etc.).
  - [ ] Increment record versions and update audit fields.
  - [ ] Append entry to `transaction_records` (WAL).
  - [ ] Publish event to Redis channel `space:<space_id>:events`.
- [ ] Implement `POST /api/v3/loadPageChunk`:
  - [ ] Fetch root page block and recursively fetch all descendants up to depth limit.
  - [ ] Return records normalized into `{ recordMap: { block, collection, collection_view } }`.
- [ ] Implement `POST /api/v3/queryCollection`:
  - [ ] Server-side execution of database queries, filters, and pagination.
- [ ] Implement `POST /api/v3/getUploadFileUrl`:
  - [ ] Generate Cloudflare R2 / AWS S3 presigned PUT URLs for client-side uploads.
- [ ] Implement workspace and teamspace management endpoints.

---

## Phase 6: Real-Time Sync & WebSocket Collaboration Gateway (`apps/sync-worker`)

- [x] Bootstrap WebSocket server (using `ws` or `Socket.io`).
- [x] Implement client authentication handshake over WebSocket.
- [x] Build `SubscriptionManager`:
  - [x] Track subscribed rooms (`space:<space_id>`, `page:<page_id>`).
  - [x] Clean up subscriptions on client disconnect.
- [x] Build `RedisSubscriber`:
  - [x] Subscribe to Redis channel `space:*:events`.
  - [x] Broadcast `record_updated` patches to clients subscribed to that space.
- [x] Build Ephemeral Presence Engine:
  - [x] Relay client cursor positions (`x`, `y`) and focused block IDs.
  - [x] Set 10-second TTL in Redis for active user presence.
  - [x] Emit peer join/leave/move events to room members.

---

## Phase 7: Access Control & Permissions (`@votion/acl`)

- [x] Implement Workspace RBAC (Owner, Admin, Member, Guest).
- [x] Build Recursive Hierarchy Graph Traverser:
  - [x] Walk up `parent_id` chain from Block to Root Page to Workspace.
  - [x] Resolve inherited permissions (`read`, `comment`, `write`, `admin`).
- [x] Build Permission Override Engine:
  - [x] Explicit user/teamspace access rules stored in `permissions` table.
- [x] Implement Redis-backed ACL cache with invalidation hooks on permission edits.
- [x] Implement Public Web Publishing Gateway:
  - [x] Custom domain or public slug router.
  - [x] Anonymous read-only permissions with optional `noindex` header.

---

## Phase 8: Search & Discovery Engine (`@votion/search`)

- [ ] Set up Meilisearch index schemas for `blocks` and `pages`.
- [ ] Build `DocumentTransformer` to strip rich-text markup and produce searchable plain-text tokens.
- [ ] Build `QuickFindQueryBuilder`:
  - [ ] Prefix matching and typo-tolerant search.
  - [ ] Scoped search filters (by workspace, creator, date, page sub-tree).
- [ ] Build `Cmd+K` Quick Find frontend modal:
  - [ ] Instant search-as-you-type results.
  - [ ] Highlight matched query text in previews.
  - [ ] Recent pages history list.

---

## Phase 9: Background Worker Fleet (`apps/task-worker`)

- [ ] Configure BullMQ job queues connected to Redis.
- [ ] Implement `HierarchyCascadeWorker`:
  - [ ] Cascade soft-deletion (`alive: false`) across entire nested sub-trees.
  - [ ] Cascade permission overrides down descendant blocks.
- [ ] Implement `SearchIndexingWorker`:
  - [ ] Listen to transaction changes and update Meilisearch records asynchronously.
- [ ] Implement `RollupWorker`:
  - [ ] Recalculate dependent rollups when linked collection items change.
- [ ] Implement `MediaProcessorWorker`:
  - [ ] Generate image thumbnails (Sharp).
  - [ ] Extract OpenGraph metadata for bookmark blocks.
- [ ] Implement `ExportWorker`:
  - [ ] Generate Markdown + CSV zip archives.
  - [ ] Generate PDF exports via headless Chromium (Puppeteer).
- [ ] Implement `ImportWorker`:
  - [ ] Parse uploaded Markdown, HTML, and CSV files into Notion block trees.

---

## Phase 10: Web Application Shell & Workspace UX (`apps/web`)

- [ ] Build collapsible Sidebar navigation:
  - [ ] Workspace switcher dropdown.
  - [ ] Quick Find (`Cmd+K`) button.
  - [ ] Recursive nested page tree with expandable chevron toggles.
  - [ ] Favorites / Pinned pages section.
  - [ ] Teamspaces section.
  - [ ] Private pages section.
  - [ ] Trash modal (view soft-deleted pages, restore, permanent purge).
- [ ] Build Top Navigation Bar:
  - [ ] Interactive breadcrumb path.
  - [ ] Page cover and icon customizer (emoji picker + image upload).
  - [ ] Share / Permissions modal (invite members, copy public link).
  - [ ] Live presence user avatar badges.
  - [ ] Page options menu (Export, Full width toggle, Font toggle, Delete).
- [ ] Build Discussion & Comment System:
  - [ ] Page-level discussion thread.
  - [ ] Text-anchored inline comments with resolve/unresolve workflows.
- [ ] Build Notification Inbox (`@` mentions, comment replies).

---

## Phase 11: Developer API & Automations (`apps/server/v1`)

- [ ] Implement REST API conforming to Notion OpenAPI specification:
  - [ ] `GET /v1/blocks/:id`, `PATCH /v1/blocks/:id`, `DELETE /v1/blocks/:id`
  - [ ] `GET /v1/blocks/:id/children`, `PATCH /v1/blocks/:id/children`
  - [ ] `POST /v1/pages`, `GET /v1/pages/:id`, `PATCH /v1/pages/:id`
  - [ ] `POST /v1/databases`, `GET /v1/databases/:id`, `POST /v1/databases/:id/query`
  - [ ] `POST /v1/search`
- [ ] Implement API Key management (Internal integration tokens).
- [ ] Build Webhook Dispatcher:
  - [ ] Emit signed HTTP requests on database mutations with retry backoff.
- [ ] Implement In-Database Automations:
  - [ ] Triggers: `Page added`, `Property edited`.
  - [ ] Actions: `Update property`, `Add page`, `Send webhook`.

---

## Phase 12: Wasmer Edge Deployment Pipeline & Production Release

- [ ] Configure `wasmer.toml` package manifest, capabilities, and HTTP service bindings.
- [ ] Configure deployment authentication token (`WASMER_TOKEN` via environment variable or secret).
- [ ] Implement and test zero-Docker remote build and deployment command:
  - [ ] `export WASMER_TOKEN="<YOUR_WASMER_TOKEN>" && ~/.wasmer/bin/wasmer deploy --build-remote`
- [ ] Configure Wasmer Edge environment secrets (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`).
- [ ] Set up GitHub Actions CI/CD workflows:
  - [ ] Automated linting, typechecking, and unit tests on pull requests.
  - [ ] Automated Wasmer Edge deployment on push to `main` using `WASMER_TOKEN`.
- [ ] Perform edge security hardening:
  - [ ] Rate limiting on API routes.
  - [ ] Strict CORS policies and CSP headers for sandboxed iframes.
  - [ ] Input sanitization on Rich Text and KaTeX expressions.
- [ ] Write user and developer documentation (`README.md`, `CONTRIBUTING.md`, Wasmer Deployment Guide).
