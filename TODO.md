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
| **Phase 3: Block Editor & Canvas** | `@votion/editor` | ✅ Completed | 22 / 22 |
| **Phase 4: Database & Collection Engine** | `@votion/database-engine` | ✅ Completed | 20 / 20 |
| **Phase 5: Backend API & Transactions** | `apps/server` | ✅ Completed | 14 / 14 |
| **Phase 6: Real-Time Gateway & Collab** | `apps/sync-worker` | ✅ Completed | 9 / 9 |
| **Phase 7: Access Control & Permissions** | `@votion/acl` | ✅ Completed | 8 / 8 |
| **Phase 8: Search & Discovery Engine** | `@votion/search` | ✅ Completed | 7 / 7 |
| **Phase 9: Background Worker Fleet** | `apps/task-worker` | ✅ Completed | 11 / 11 |
| **Phase 10: Web Application Shell** | `apps/web` | ⬜ Not Started | 0 / 16 |
| **Phase 11: Developer API & Webhooks** | `apps/server/v1` | ✅ Completed | 8 / 8 |
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
- [x] Build `BlockCanvas` component to recursively render block trees from `page.content`.
- [x] Implement `BlockWrapper` component with hover action controls:
- [x] 6-dot drag handle button.
- [x] Quick `+` block insertion button.
- [x] Delete / Duplicate / Copy link context menu.
- [x] Implement `ColumnLayout`:
- [x] `column_list` flex container.
- [x] Draggable percentage-based resize dividers between columns.
- [x] Convert single blocks into horizontal columns on drag-and-drop.

### 3.2 Block Renderers
- [x] Text Block (`TextBlock.tsx`) with contenteditable and rich-text spans.
- [x] Heading Blocks (`HeadingBlock.tsx` for H1, H2, H3 with toggle-collapse toggle).
- [x] To-Do Block (`TodoBlock.tsx`) with checkbox toggle and strikethrough styling.
- [x] List Blocks (`bulleted_list_item`, `numbered_list_item` with auto-increment numbers).
- [x] Toggle Block (`ToggleBlock.tsx`) with expandable child block container.
- [x] Quote Block (`QuoteBlock.tsx`) with accent left border.
- [x] Callout Block (`CalloutBlock.tsx`) with emoji picker and background tint palette.
- [x] Divider Block (`DividerBlock.tsx` `<hr />`).
- [x] Code Block (`CodeBlock.tsx`) with Prism/Highlight.js syntax highlighting, language selector, line numbers, and copy button.
- [x] Math Block (`MathBlock.tsx`) with inline/block KaTeX equation editing.
- [x] Media Blocks:
- [x] Image block with upload preview, URL loader, and width resize handles.
- [x] Video/Audio block with custom media player controls.
- [x] File attachment block with download link and file size metadata.
- [x] Web Bookmark block with auto OpenGraph scraping card.
- [x] Sandboxed Embed block (YouTube, Figma, GitHub, CodePen).
- [x] Synced Block (`SyncedBlock.tsx`) pointing to master block ID.

### 3.3 Editor Interactions & Shortcuts
- [x] Build Slash Command Popover (`/`):
- [x] Filterable block catalog list.
- [x] Keyboard navigation (Arrow Up/Down, Enter to insert, Escape to close).
- [x] Build Inline Floating Formatting Toolbar (appears on text selection):
- [x] Bold, Italic, Strikethrough, Underline, Code, Color highlight, Link insertion, Comment anchor.
- [x] Implement Markdown auto-formatting shortcuts:
- [x] `# ` $\rightarrow$ Heading 1, `## ` $\rightarrow$ Heading 2, `### ` $\rightarrow$ Heading 3
- [x] `- ` or `* ` $\rightarrow$ Bulleted List
- [x] `1. ` $\rightarrow$ Numbered List
- [x] `[] ` $\rightarrow$ To-Do Checkbox
- [x] `> ` $\rightarrow$ Quote
- [x] `---` $\rightarrow$ Divider
- [x] ` ``` ` $\rightarrow$ Code Block
- [x] Implement Drag-and-Drop system:
- [x] Visual blue drop line indicators (above, below, left, right).
- [x] Relative list reordering math (`listAfter`, `listBefore`).
- [x] Implement Multi-Block Selection:
- [x] Click-and-drag bounding box (lasso selection).
- [x] Shift + Arrow block range selection.
- [x] Bulk block actions (indent/outdent with Tab/Shift+Tab, bulk delete, bulk move).

---

## Phase 4: Database & Collection Engine (`@votion/database-engine`)

### 4.1 Schema & Properties
- [x] Property Registry & Schema Manager:
  - [x] Primitive properties: Text, Number (format as currency/percent/progress), Select, Multi-select, Status, Date (with time & reminder), Checkbox, URL, Email, Phone.
  - [x] Audit properties: Created time, Created by, Last edited time, Last edited by, Unique ID.
  - [x] Add, rename, hide, duplicate, and delete properties in collection schema.

### 4.2 Projections & Views
- [x] **Table View**:
  - [x] Virtualized spreadsheet grid.
  - [x] Draggable, resizable column headers.
  - [x] In-cell editing for all property types.
  - [x] Footer aggregations (Sum, Avg, Min, Max, Count).
- [x] **Board View (Kanban)**:
  - [x] Column groupings by Select, Status, or Date.
  - [x] Drag-and-drop card movement between columns (updates record property).
  - [x] Collapsible board columns and swimlanes.
- [x] **Calendar View**:
  - [x] Month and week grid projections based on Date property.
  - [x] Drag-and-drop rescheduling.
- [x] **Timeline View (Gantt)**:
  - [x] Visual duration bars based on Date ranges (start/end).
  - [x] Zoom scale controller (hours, days, weeks, months).
  - [x] Dependency lines connecting related cards.
- [x] **Gallery View**:
  - [x] Responsive card grid.
  - [x] Card cover picker (Page cover, Content preview, Custom file).
- [x] **List View**:
  - [x] High-density document list view with toggleable visible properties.

### 4.3 Query, Filter & Sort Engine
- [x] Build recursive `FilterEvaluator`:
  - [x] Compound `AND` / `OR` clause tree.
  - [x] Type-specific operators (`equals`, `contains`, `is_empty`, `greater_than`, `is_checked`).
- [x] Build `SortEngine`:
  - [x] Multi-level ascending/descending property sorts.
- [x] Implement Grouping Engine (group records into sections with counts).
- [x] Implement Sub-Items (parent-child nested hierarchy within databases).

### 4.4 Formulas & Relational Graph
- [x] Build **Formula 2.0 Engine**:
  - [x] Lexer & Tokenizer.
  - [x] Recursive Descent Parser producing AST.
  - [x] AST Evaluator with runtime type checking.
  - [x] Standard library functions (math, string manipulation, date math, list `map`/`filter`).
- [x] Implement **Relation Properties**:
  - [x] Two-way foreign key linking between collections.
  - [x] Linked record picker modal.
- [x] Implement **Rollup Engine**:
  - [x] Look through Relation to target property.
  - [x] Execute aggregation function (`Count all`, `Sum`, `Average`, `Percent checked`).

---

## Phase 5: Backend API & Transaction Server (`apps/server`)

- [x] Bootstrap Fastify server with CORS, Helmet, and Compression plugins.
- [x] Implement authentication & session management:
  - [x] User signup, login, password hashing (Argon2 / bcrypt).
  - [x] JWT issuance and refresh token rotation.
- [x] Implement `POST /api/v3/saveTransactions`:
  - [x] Validate request body and transaction schema.
  - [x] Verify user permission on target entity records.
  - [x] Execute PostgreSQL transaction applying operations (`set`, `update`, `listAfter`, etc.).
  - [x] Increment record versions and update audit fields.
  - [x] Append entry to `transaction_records` (WAL).
  - [x] Publish event to Redis channel `space:<space_id>:events`.
- [x] Implement `POST /api/v3/loadPageChunk`:
  - [x] Fetch root page block and recursively fetch all descendants up to depth limit.
  - [x] Return records normalized into `{ recordMap: { block, collection, collection_view } }`.
- [x] Implement `POST /api/v3/queryCollection`:
  - [x] Server-side execution of database queries, filters, and pagination.
- [x] Implement `POST /api/v3/getUploadFileUrl`:
  - [x] Generate Cloudflare R2 / AWS S3 presigned PUT URLs for client-side uploads.
- [x] Implement workspace and teamspace management endpoints.

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

- [x] Set up Meilisearch index schemas for `blocks` and `pages`.
  - `votion_blocks` index: searchable `title`/`plain_text`; filterable `space_id`, `parent_id`,
    `root_page_id`, `ancestor_ids`, `access_principals`, `created_by`, `last_edited_time`, `type`,
    `alive`; ranking `words → typo → proximity → attribute → sort → exactness`; prefix search at
    indexing time; idempotent provisioning (`pnpm --filter @votion/search run provision`).
- [x] Build `DocumentTransformer` to strip rich-text markup and produce searchable plain-text tokens.
  - Rejoins mid-word styling splits, drops modifier tuples/URLs/UUID mentions, renders date mentions
    and inline equations, and walks page trees (breadcrumbs + `ancestor_ids` + `root_page_id`).
- [x] Build `QuickFindQueryBuilder`:
  - [x] Prefix matching and typo-tolerant search.
  - [x] Scoped search filters (by workspace, creator, date, page sub-tree).
  - ACL scoping is fail-closed: empty scope ⇒ no request; every filter value is escaped.
- [x] Build `Cmd+K` Quick Find frontend modal:
  - [x] Instant search-as-you-type results (150 ms debounce, abort + stale-response guard).
  - [x] Highlight matched query text in previews (`<mark>` React nodes, never raw HTML).
  - [x] Recent pages history list (localStorage cache, workspace-scoped, server-refreshable).
  - Keyboard navigation (`↑`/`↓`, `Home`/`End`, `Enter`, `Escape`) and ARIA listbox semantics.

---

## Phase 9: Background Worker Fleet (`apps/task-worker`)

- [x] Configure BullMQ job queues connected to Redis.
- [x] Implement `HierarchyCascadeWorker`:
  - [x] Cascade soft-deletion (`alive: false`) across entire nested sub-trees.
  - [x] Cascade permission overrides down descendant blocks.
- [x] Implement `SearchIndexingWorker`:
  - [x] Listen to transaction changes and update Meilisearch records asynchronously.
- [x] Implement `RollupWorker`:
  - [x] Recalculate dependent rollups when linked collection items change.
- [x] Implement `MediaProcessorWorker`:
  - [x] Generate image thumbnails (Sharp).
  - [x] Extract OpenGraph metadata for bookmark blocks.
- [x] Implement `ExportWorker`:
  - [x] Generate Markdown + CSV zip archives.
  - [x] Generate PDF exports via headless Chromium (Puppeteer).
- [x] Implement `ImportWorker`:
  - [x] Parse uploaded Markdown, HTML, and CSV files into Notion block trees.

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

- [x] Implement REST API conforming to Notion OpenAPI specification:
  - [x] `GET /v1/blocks/:id`, `PATCH /v1/blocks/:id`, `DELETE /v1/blocks/:id`
  - [x] `GET /v1/blocks/:id/children`, `PATCH /v1/blocks/:id/children`
  - [x] `POST /v1/pages`, `GET /v1/pages/:id`, `PATCH /v1/pages/:id`, `DELETE /v1/pages/:id`
  - [x] `POST /v1/databases`, `GET /v1/databases/:id`, `PATCH /v1/databases/:id`, `POST /v1/databases/:id/query`
  - [x] `POST /v1/search`
- [x] Implement API Key management (Internal integration tokens):
  - [x] `api_keys` table storing SHA-256 token digests + capability scopes.
  - [x] `Authorization: Bearer secret_...` middleware attaching workspace/bot capabilities.
  - [x] `POST /v1/api-keys`, `GET /v1/api-keys`, `DELETE /v1/api-keys/:id`.
- [x] Build Webhook Dispatcher:
  - [x] Emit signed HTTP requests on database mutations with retry backoff.
  - [x] HMAC-SHA256 `X-Votion-Signature` header and `webhook_deliveries` audit log.
  - [x] `POST /v1/webhooks`, `GET /v1/webhooks`, `DELETE /v1/webhooks/:id`.
- [x] Implement In-Database Automations:
  - [x] Triggers: `Page added`, `Property edited`.
  - [x] Actions: `Update property`, `Add page`, `Send webhook`.
  - [x] `POST /v1/automations`, `GET /v1/automations`, `DELETE /v1/automations/:id`.

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
