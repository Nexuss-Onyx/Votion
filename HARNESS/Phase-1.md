# Autonomous Agent Harness Prompt: Phase 1 (Core Contracts & Database Tier)

> **File Location**: `HARNESS/Phase-1.md`  
> **Target Subsystem**: Phase 1 — Shared Core Contracts & Database Tier (`@votion/types`, `@votion/db`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-1 Implementation & Verification Agent**.

Your objective is to independently implement, verify, and complete all deliverables defined in **Phase 1** of `TODO.md`. You will build the foundational TypeScript contracts (`@votion/types`) and the complete PostgreSQL relational & JSONB database schema layer (`@votion/db`) with Drizzle ORM and Neon Serverless driver support.

### Operational Guardrails
1. **Zero-Docker Rule**: Use cloud serverless PostgreSQL (Neon / Supabase) configurations or in-memory pg-mem / direct connection tests. Do not create Docker containers.
2. **Type Purity**: All types in `@votion/types` must be strictly typed without `any` wherever possible.
3. **Verification Before Checkbox**: You **MUST NOT** check off tasks in `TODO.md` until all verification tests exit with code `0`.
4. **No Secrets**: Never commit real database connection strings or tokens.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-1-core-contracts-db
```

### Step 1: Core Type Definitions (`packages/types`)
Implement comprehensive, production-grade TypeScript definitions in `packages/types/src/`:
* `rich-text.ts`:
  - `TextModifier`: Tuples for `b`, `i`, `s`, `_`, `c`, `['h', string]`, `['a', string]`, `['e', string]`, `['u', string]`, `['p', string]`, `['d', DateMetadata]`.
  - `RichTextSegment = [string, TextModifier[]?]`
  - `RichText = RichTextSegment[]`
* `block.ts`:
  - `BlockType` enum/union covering all 20+ Notion block types (`page`, `text`, `heading_1/2/3`, `to_do`, `toggle`, `quote`, `callout`, `divider`, `column_list`, `column`, `table`, `collection_view`, `code`, `math`, `synced_block`, media types).
  - `Block` interface: `id`, `space_id`, `version`, `type`, `properties`, `format`, `content: UUID[]`, `parent_id`, `parent_table`, `alive`, audit fields.
* `collection.ts`:
  - `PropertyType` union (`title`, `text`, `number`, `select`, `multi_select`, `status`, `date`, `person`, `checkbox`, `url`, `email`, `phone_number`, `formula`, `relation`, `rollup`, audit types).
  - `Collection` & `CollectionProperty` interfaces with option maps and relation pointers.
* `collection-view.ts`:
  - `ViewType` union (`table`, `board`, `calendar`, `timeline`, `gallery`, `list`).
  - `CollectionView` interface with `query2` (filters, sorts, aggregations) and `format` settings.
* `transaction.ts`:
  - `OperationCommand` (`set`, `update`, `listAfter`, `listBefore`, `listRemove`, `keyedObjectSet`).
  - `OperationPointer`, `Operation`, `Transaction` interfaces.
* `websocket.ts`:
  - Socket payload envelopes: `subscribe`, `presence`, `record_updated`.
* `index.ts`: Re-export all type modules.

### Step 2: Database Schema & Client (`packages/db`)
Implement Drizzle ORM schema and database client in `packages/db/`:
* Configure `package.json` with `@neondatabase/serverless`, `drizzle-orm`, `drizzle-kit`, and `pg`.
* `src/schema/workspaces.ts`: `workspaces` table (UUID primary key, domain, name, icon).
* `src/schema/users.ts`: `users` table and `workspace_members` junction table with roles (`owner`, `admin`, `member`, `guest`).
* `src/schema/blocks.ts`: `blocks` table with JSONB `properties`, JSONB `format`, UUID[] `content`, parent pointers, and GIN indexes.
* `src/schema/collections.ts`: `collections` and `collection_views` tables with JSONB schemas.
* `src/schema/permissions.ts`: `permissions` table for explicit role overrides.
* `src/schema/transactions.ts`: `transaction_records` table (WAL log).
* `src/client.ts`: Connection pool factory supporting Neon Serverless WebSocket / HTTP connection and standard node-pg connection.
* `drizzle.config.ts`: Drizzle Kit configuration for migrations.

### Step 3: Automated Unit & Type Verification Tests
* In `packages/types/test/types.test.ts`: Compile-time and runtime type validation tests.
* In `packages/db/test/schema.test.ts`: Verify that table definitions, column types, and relations compile cleanly.

---

## 3. Strict Verification & Gate Checklist

Run the following commands sequentially. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/types run build` | Builds TypeScript declaration files (`dist/index.d.ts`). Exit 0. |
| **V-02** | `pnpm --filter @votion/types run test` | Type validation unit tests pass. Exit 0. |
| **V-03** | `pnpm --filter @votion/db run build` | Compiles database client and schemas without type errors. Exit 0. |
| **V-04** | `pnpm --filter @votion/db drizzle-kit check` | Drizzle Kit validates schema definitions and relationships. Exit 0. |
| **V-05** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once all checks pass, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 1: Core Contracts & Database** | `@votion/types`, `@votion/db` | ✅ Completed | 12 / 12 |
   ```
2. Check off all tasks under `## Phase 1: Shared Core Contracts & Database Tier`.

---

## 5. Pull Request & Delivery Report Template

```bash
git add .
git commit -m "feat(types,db): implement canonical data contracts and PostgreSQL Drizzle schemas"
git push -u origin feature/phase-1-core-contracts-db
```

Output the delivery report using this format:
```markdown
# 🚀 Phase 1 Delivery Report & Pull Request

### PR Title
`feat(types,db): implement canonical data contracts and PostgreSQL Drizzle schemas`

### Branch
`feature/phase-1-core-contracts-db` ➡️ `main`

### Summary of Changes
- Implemented `@votion/types`: RichText tuples, canonical Block, Collection, CollectionView, and Transaction operations.
- Implemented `@votion/db`: PostgreSQL Drizzle schemas for workspaces, users, blocks, collections, views, permissions, and WAL transaction records.
- Configured composite B-tree and GIN indexes on JSONB fields.
- Verified Neon Serverless compatibility and export contracts.

### Verification Evidence
- [x] `@votion/types` build & test passed (Exit 0)
- [x] `@votion/db` build & schema validation passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
