# `@votion/db`

PostgreSQL 16 schema, generated SQL migrations and Drizzle ORM client factories
for Votion. Runs on **Neon Serverless** (HTTP or WebSocket) and on plain
`node-postgres` — no Docker, no local daemon.

## Layout

```
packages/db/
├── src/
│   ├── schema/
│   │   ├── enums.ts          # workspace_role, permission_role, principal_type, ...
│   │   ├── workspaces.ts     # workspaces + workspace_members (RBAC)
│   │   ├── users.ts          # users + accounts (OAuth/provider links)
│   │   ├── blocks.ts         # unified block table (JSONB properties/format, UUID[] content)
│   │   ├── collections.ts    # collections + collection_views (JSONB schema/format/query2)
│   │   ├── permissions.ts    # entity-level ACL overrides
│   │   ├── transactions.ts   # transaction_records (durable WAL)
│   │   └── relations.ts      # Drizzle relational mappings (db.query.*)
│   ├── client.ts             # createDatabase / createDatabaseFromEnv
│   └── index.ts
├── drizzle/                  # generated migrations + journal (committed)
├── test/                     # schema, index, migration & client contract tests
└── drizzle.config.ts
```

## Client selection

`createDatabase()` picks a transport from `driver` / `VOTION_DB_DRIVER`:

| Driver | Runtime | Notes |
| :-- | :-- | :-- |
| `neon-http` (default) | Wasmer Edge, serverless, edge functions | Stateless `fetch`, zero connection management |
| `neon-websocket` | Long-running Node servers, migrations | Pooled WebSocket (`ws`/global `WebSocket`) |
| `node-postgres` | Local dev, CI, self-hosted PG | TCP pool via `pg` |

```ts
import { eq } from 'drizzle-orm';
import { blocks, createDatabaseFromEnv } from '@votion/db';

const { db, close } = createDatabaseFromEnv();
const page = await db.select().from(blocks).where(eq(blocks.id, pageId)).limit(1);
await close();
```

The connection string is always supplied by the environment (`DATABASE_URL`);
no credential is ever committed to the repository.

## Migrations

```bash
pnpm --filter @votion/db db:generate   # regenerate SQL from src/schema
pnpm --filter @votion/db db:check      # validate journal + schema drift (offline)
pnpm --filter @votion/db db:migrate    # apply to DATABASE_URL
pnpm --filter @votion/db db:studio     # inspect the live database
```

`pnpm --filter @votion/db drizzle-kit check` is equivalent to `db:check` and is
the gate used by `HARNESS/Phase-1.md` (V-04).

## Index strategy

* B-tree: `idx_blocks_space_id`, `idx_blocks_parent_id`, `idx_blocks_alive`,
  `idx_blocks_type`, `idx_blocks_space_parent (space_id, parent_table, parent_id)`,
  `idx_blocks_last_edited (space_id, last_edited_time)`.
* GIN: `idx_blocks_properties_gin`, `idx_blocks_format_gin`,
  `idx_collections_schema_gin`, `idx_collection_views_query2_gin`.
* WAL: `idx_tx_records_space_created (space_id, created_at)`,
  unique `idx_tx_records_transaction_id` for idempotent replay.

## Verification

```bash
pnpm --filter @votion/db run build
pnpm --filter @votion/db run test        # tsc (tests) + vitest
pnpm --filter @votion/db drizzle-kit check
```
