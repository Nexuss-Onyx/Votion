import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  BlockProperties,
  BlockType,
  CollectionSchema,
  CollectionViewFormat,
  CollectionViewQuery,
  Operation,
  ParentTable,
  PermissionRole,
  PrincipalType,
  RichText,
  ViewType,
  WorkspaceRole,
} from '@votion/types';

import {
  PARENT_TABLES,
  PERMISSION_ROLES,
  PRINCIPAL_TYPES,
  VIEW_TYPES,
  WORKSPACE_ROLES,
  accounts,
  blockParentTableEnum,
  blocks,
  collectionViewTypeEnum,
  collectionViews,
  collections,
  permissionRoleEnum,
  permissions,
  principalTypeEnum,
  transactionRecords,
  users,
  workspaceMembers,
  workspaceRoleEnum,
  workspaces,
  type BlockRow,
  type CollectionRow,
  type CollectionViewRow,
  type NewBlockRow,
  type NewUserRow,
  type PermissionRow,
  type TransactionRecordRow,
  type WorkspaceRow,
} from '../src/index.js';

// =============================================================
// Helpers
// =============================================================

function indexNames(table: PgTable): string[] {
  return getTableConfig(table).indexes.map((entry) => entry.config.name ?? '');
}

function requireIndex(table: PgTable, name: string) {
  const found = getTableConfig(table).indexes.find((entry) => entry.config.name === name);
  if (!found) {
    throw new Error(`Missing index ${name} on ${getTableName(table)}`);
  }
  return found;
}

function indexColumns(table: PgTable, name: string): string[] {
  return requireIndex(table, name).config.columns.map((column) =>
    'name' in column && typeof column.name === 'string' ? column.name : '<expression>',
  );
}

function columnNames(table: PgTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

// =============================================================
// Table inventory
// =============================================================

describe('postgres table inventory', () => {
  it('declares every Phase 1 table', () => {
    expect([
      getTableName(workspaces),
      getTableName(users),
      getTableName(accounts),
      getTableName(workspaceMembers),
      getTableName(blocks),
      getTableName(collections),
      getTableName(collectionViews),
      getTableName(permissions),
      getTableName(transactionRecords),
    ]).toEqual([
      'workspaces',
      'users',
      'accounts',
      'workspace_members',
      'blocks',
      'collections',
      'collection_views',
      'permissions',
      'transaction_records',
    ]);
  });

  it('maps block columns to the canonical snake_case layout', () => {
    expect(columnNames(blocks)).toEqual([
      'id',
      'space_id',
      'version',
      'type',
      'properties',
      'format',
      'content',
      'parent_id',
      'parent_table',
      'alive',
      'created_time',
      'last_edited_time',
      'created_by_id',
      'last_edited_by_id',
    ]);
  });

  it('maps collection and view columns', () => {
    expect(columnNames(collections)).toEqual([
      'id',
      'space_id',
      'parent_id',
      'name',
      'description',
      'schema',
      'icon',
      'cover',
      'alive',
      'version',
      'created_at',
      'updated_at',
    ]);
    expect(columnNames(collectionViews)).toEqual([
      'id',
      'space_id',
      'collection_id',
      'type',
      'name',
      'format',
      'query2',
      'alive',
      'version',
      'created_at',
      'updated_at',
    ]);
  });
});

// =============================================================
// Column types
// =============================================================

describe('column type contracts', () => {
  it('stores block payloads as JSONB and child ids as UUID[]', () => {
    expect(blocks.properties.dataType).toBe('json');
    expect(blocks.format.dataType).toBe('json');
    expect(blocks.content.dataType).toBe('array');
    expect(blocks.content.columnType).toBe('PgArray');
    expect(blocks.id.columnType).toBe('PgUUID');
    expect(blocks.type.columnType).toBe('PgVarchar');
    expect(blocks.version.dataType).toBe('number');
  });

  it('stores collection schemas and view queries as JSONB', () => {
    expect(collections.schema.dataType).toBe('json');
    expect(collections.name.dataType).toBe('json');
    expect(collections.description.dataType).toBe('json');
    expect(collectionViews.format.dataType).toBe('json');
    expect(collectionViews.query2.dataType).toBe('json');
  });

  it('exposes typed JSONB payloads through $inferSelect', () => {
    expectTypeOf<BlockRow['properties']>().toEqualTypeOf<BlockProperties>();
    expectTypeOf<BlockRow['type']>().toEqualTypeOf<BlockType>();
    expectTypeOf<BlockRow['content']>().toEqualTypeOf<string[]>();
    expectTypeOf<BlockRow['parentTable']>().toEqualTypeOf<ParentTable>();
    expectTypeOf<BlockRow['alive']>().toEqualTypeOf<boolean>();
    expectTypeOf<BlockRow['createdTime']>().toEqualTypeOf<Date>();
    expectTypeOf<CollectionRow['schema']>().toEqualTypeOf<CollectionSchema>();
    expectTypeOf<CollectionRow['name']>().toEqualTypeOf<RichText>();
    expectTypeOf<CollectionViewRow['format']>().toEqualTypeOf<CollectionViewFormat>();
    expectTypeOf<CollectionViewRow['query2']>().toEqualTypeOf<CollectionViewQuery>();
    expectTypeOf<CollectionViewRow['type']>().toEqualTypeOf<ViewType>();
    expectTypeOf<PermissionRow['role']>().toEqualTypeOf<PermissionRole>();
    expectTypeOf<PermissionRow['principalType']>().toEqualTypeOf<PrincipalType>();
    expectTypeOf<TransactionRecordRow['operations']>().toEqualTypeOf<Operation[]>();
    expectTypeOf<WorkspaceRow['createdAt']>().toEqualTypeOf<Date>();
  });

  it('keeps insert payloads strict', () => {
    const minimalBlock: NewBlockRow = {
      spaceId: '38a8e10b-47e4-4d89-b14e-b86a8ff35df1',
      type: 'text',
      parentId: '76ef2b14-8c8f-402a-9e12-32b036ca6d5f',
      parentTable: 'block',
    };
    expect(minimalBlock.type).toBe('text');

    const minimalUser: NewUserRow = { email: 'ada@votion.dev', fullName: 'Ada Lovelace' };
    expect(minimalUser.email).toBe('ada@votion.dev');

    const invalidBlock: NewBlockRow = {
      spaceId: 'space',
      // @ts-expect-error - block type must be part of the canonical union
      type: 'paragraph',
      parentId: 'parent',
      parentTable: 'block',
    };
    expect(invalidBlock).toBeDefined();
  });
});

// =============================================================
// Indexes
// =============================================================

describe('index strategy', () => {
  it('declares the required block indexes', () => {
    expect(indexNames(blocks)).toEqual(
      expect.arrayContaining([
        'idx_blocks_space_id',
        'idx_blocks_parent_id',
        'idx_blocks_alive',
        'idx_blocks_type',
        'idx_blocks_space_parent',
        'idx_blocks_properties_gin',
      ]),
    );
    expect(indexColumns(blocks, 'idx_blocks_space_id')).toEqual(['space_id']);
    expect(indexColumns(blocks, 'idx_blocks_parent_id')).toEqual(['parent_id']);
    expect(indexColumns(blocks, 'idx_blocks_alive')).toEqual(['alive']);
    expect(indexColumns(blocks, 'idx_blocks_space_parent')).toEqual([
      'space_id',
      'parent_table',
      'parent_id',
    ]);
  });

  it('uses GIN indexes on JSONB columns', () => {
    expect(requireIndex(blocks, 'idx_blocks_properties_gin').config.method).toBe('gin');
    expect(indexColumns(blocks, 'idx_blocks_properties_gin')).toEqual(['properties']);
    expect(requireIndex(collections, 'idx_collections_schema_gin').config.method).toBe('gin');
    expect(indexColumns(collections, 'idx_collections_schema_gin')).toEqual(['schema']);
    expect(requireIndex(collectionViews, 'idx_collection_views_query2_gin').config.method).toBe(
      'gin',
    );
  });

  it('declares collection, permission and WAL indexes', () => {
    expect(indexNames(collections)).toEqual(
      expect.arrayContaining([
        'idx_collections_space_id',
        'idx_collections_parent_id',
        'idx_collections_schema_gin',
      ]),
    );
    expect(indexColumns(collectionViews, 'idx_collection_views_coll_id')).toEqual([
      'collection_id',
    ]);
    expect(indexColumns(permissions, 'idx_permissions_entity')).toEqual([
      'entity_table',
      'entity_id',
    ]);
    expect(indexColumns(transactionRecords, 'idx_tx_records_space_created')).toEqual([
      'space_id',
      'created_at',
    ]);
    expect(requireIndex(transactionRecords, 'idx_tx_records_transaction_id').config.unique).toBe(
      true,
    );
  });

  it('declares membership and identity uniqueness', () => {
    expect(requireIndex(workspaces, 'idx_workspaces_domain').config.unique).toBe(true);
    expect(requireIndex(users, 'idx_users_email').config.unique).toBe(true);
    expect(indexColumns(accounts, 'idx_accounts_provider_account')).toEqual([
      'provider',
      'provider_account_id',
    ]);
  });
});

// =============================================================
// Enums & foreign keys
// =============================================================

describe('enum contracts', () => {
  it('mirrors the @votion/types unions', () => {
    expect(workspaceRoleEnum.enumValues).toEqual([...WORKSPACE_ROLES]);
    expect(permissionRoleEnum.enumValues).toEqual([...PERMISSION_ROLES]);
    expect(principalTypeEnum.enumValues).toEqual([...PRINCIPAL_TYPES]);
    expect(blockParentTableEnum.enumValues).toEqual([...PARENT_TABLES]);
    expect(collectionViewTypeEnum.enumValues).toEqual([...VIEW_TYPES]);

    expectTypeOf<(typeof WORKSPACE_ROLES)[number]>().toEqualTypeOf<WorkspaceRole>();
    expectTypeOf<(typeof PERMISSION_ROLES)[number]>().toEqualTypeOf<PermissionRole>();
    expectTypeOf<(typeof PRINCIPAL_TYPES)[number]>().toEqualTypeOf<PrincipalType>();
    expectTypeOf<(typeof PARENT_TABLES)[number]>().toEqualTypeOf<ParentTable>();
    expectTypeOf<(typeof VIEW_TYPES)[number]>().toEqualTypeOf<ViewType>();
  });

  it('defaults membership to `member`', () => {
    expect(workspaceMembers.role.default).toBe('member');
    expect(workspaceMembers.role.notNull).toBe(true);
  });
});

describe('relations & foreign keys', () => {
  it('cascades workspace deletion to owned content', () => {
    const foreignKeys = getTableConfig(blocks).foreignKeys;
    const spaceFk = foreignKeys.find((fk) => fk.reference().columns[0]?.name === 'space_id');
    expect(spaceFk).toBeDefined();
    expect(spaceFk?.onDelete).toBe('cascade');
  });

  it('cascades collection deletion to its views', () => {
    const foreignKeys = getTableConfig(collectionViews).foreignKeys;
    const collectionFk = foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === 'collection_id',
    );
    expect(collectionFk).toBeDefined();
    expect(collectionFk?.reference().foreignTable).toBe(collections);
  });

  it('keeps block audit authors nullable on user deletion', () => {
    const foreignKeys = getTableConfig(blocks).foreignKeys;
    const authorFk = foreignKeys.find(
      (fk) => fk.reference().columns[0]?.name === 'created_by_id',
    );
    expect(authorFk).toBeDefined();
    expect(authorFk?.onDelete).toBe('set null');
  });
});

// =============================================================
// Generated migrations
// =============================================================

describe('generated SQL migrations', () => {
  const drizzleDir = fileURLToPath(new URL('../drizzle', import.meta.url));
  const sqlFiles = readdirSync(drizzleDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const migrations = sqlFiles.map((file) => ({
    file,
    sql: readFileSync(join(drizzleDir, file), 'utf8'),
  }));
  const migrationSql = migrations.map((migration) => migration.sql).join('\n');
  const journal = JSON.parse(
    readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };

  it('emits a journal entry per migration', () => {
    expect(sqlFiles.length).toBeGreaterThanOrEqual(2);
    expect(journal.entries.map((entry) => entry.tag)).toEqual(
      sqlFiles.map((file) => file.replace(/\.sql$/, '')),
    );
  });

  it('creates every table, JSONB column and UUID array', () => {
    for (const table of [
      'workspaces',
      'users',
      'accounts',
      'workspace_members',
      'blocks',
      'collections',
      'collection_views',
      'permissions',
      'transaction_records',
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migrationSql).toContain('"properties" jsonb');
    expect(migrationSql).toContain('"format" jsonb');
    expect(migrationSql).toContain('"content" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL');
    expect(migrationSql).toContain('"schema" jsonb');
    expect(migrationSql).toContain('"query2" jsonb');
  });

  it('creates GIN and composite indexes in SQL', () => {
    expect(migrationSql).toContain('CREATE INDEX "idx_blocks_properties_gin" ON "blocks" USING gin');
    expect(migrationSql).toContain('CREATE INDEX "idx_collections_schema_gin" ON "collections" USING gin');
    expect(migrationSql).toContain(
      'CREATE INDEX "idx_blocks_space_parent" ON "blocks" USING btree ("space_id","parent_table","parent_id")',
    );
    expect(migrationSql).toContain(
      'CREATE INDEX "idx_tx_records_space_created" ON "transaction_records" USING btree ("space_id","created_at")',
    );
  });

  it('installs the required PostgreSQL extensions', () => {
    expect(migrationSql).toContain('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    expect(migrationSql).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  });
});
