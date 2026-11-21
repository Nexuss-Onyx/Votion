/**
 * `transaction_records` — durable write-ahead log of the sync engine.
 *
 * Every accepted `saveTransactions` batch is appended here inside the same SQL
 * transaction that mutates the affected records. The log powers audit trails,
 * offline replay, and cross-node cache invalidation.
 */

import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type { Operation, UUID } from '@votion/types';

import { users } from './users.js';
import { workspaces } from './workspaces.js';

export const transactionRecords = pgTable(
  'transaction_records',
  {
    /** Monotonic WAL sequence (BIGSERIAL). */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Client-generated transaction id (idempotency key). */
    transactionId: uuid('transaction_id').notNull(),
    /** Enclosing HTTP batch id, shared by every transaction in one request. */
    requestId: uuid('request_id'),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Ordered operations applied by the transaction. */
    operations: jsonb('operations').$type<Operation[]>().notNull(),
    /** Record versions after the batch was applied. */
    versions: jsonb('versions')
      .$type<Record<UUID, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_tx_records_transaction_id').on(table.transactionId),
    index('idx_tx_records_space_created').on(table.spaceId, table.createdAt),
    index('idx_tx_records_user_created').on(table.userId, table.createdAt),
    index('idx_tx_records_request_id').on(table.requestId),
  ],
);

export type TransactionRecordRow = typeof transactionRecords.$inferSelect;
export type NewTransactionRecordRow = typeof transactionRecords.$inferInsert;
