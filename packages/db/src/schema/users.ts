/**
 * `users` & `accounts` — identity records.
 *
 * Passwords are stored as Argon2id/bcrypt digests. OAuth/provider access tokens
 * are intentionally *not* persisted here; providers are re-consulted on demand
 * so that no long-lived secret ever lands in the primary database.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/** Global user identity (one per human, across workspaces). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(),
    /** Argon2id / bcrypt digest — `null` for SSO-only accounts. */
    passwordHash: text('password_hash'),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    avatarUrl: text('avatar_url'),
    locale: varchar('locale', { length: 16 }).notNull().default('en'),
    /** Timestamp of the last successful sign-in. */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('idx_users_email').on(table.email)],
);

/** External authentication account (OAuth / OIDC provider link). */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Identity provider id (`github`, `google`, `saml`, ...). */
    provider: varchar('provider', { length: 64 }).notNull(),
    /** Stable subject identifier returned by the provider. */
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_accounts_provider_account').on(
      table.provider,
      table.providerAccountId,
    ),
    index('idx_accounts_user_id').on(table.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
