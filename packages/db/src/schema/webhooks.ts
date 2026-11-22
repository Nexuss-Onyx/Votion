/**
 * `webhook_subscriptions` & `webhook_deliveries` — outbound automation hooks.
 *
 * A subscription registers an HTTPS endpoint plus the event names it cares
 * about. Every delivery is HMAC-SHA256 signed with the subscription secret and
 * persisted (with attempt count and response status) so failures are auditable
 * and retry behaviour is testable end to end.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { workspaces } from './workspaces.js';

/** Event names a webhook subscription may subscribe to. */
export const WEBHOOK_EVENTS = [
  'page.created',
  'page.updated',
  'page.deleted',
  'block.updated',
  'block.created',
  'database.created',
  'database.updated',
] as const;

/** A single webhook event name. */
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** HTTPS endpoint that receives the signed JSON POST. */
    url: text('url').notNull(),
    /** Signing secret used for the `X-Votion-Signature` HMAC header. */
    secret: text('secret').notNull(),
    events: jsonb('events')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    alive: boolean('alive').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_webhook_subscriptions_space').on(table.workspaceId),
    index('idx_webhook_subscriptions_alive').on(table.workspaceId, table.alive),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    event: varchar('event', { length: 128 }).notNull(),
    payload: jsonb('payload').notNull(),
    /** Hex HMAC-SHA256 digest sent in `X-Votion-Signature`. */
    signature: text('signature').notNull(),
    /** Number of HTTP attempts made (initial attempt counts as 1). */
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_webhook_deliveries_subscription').on(table.subscriptionId),
    index('idx_webhook_deliveries_created').on(table.createdAt),
  ],
);

export type WebhookSubscriptionRow = typeof webhookSubscriptions.$inferSelect;
export type NewWebhookSubscriptionRow = typeof webhookSubscriptions.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveryRow = typeof webhookDeliveries.$inferInsert;
