/**
 * Zod request schemas for the `/v1` Developer API.
 *
 * Bodies mirror Notion's public API shapes: rich text arrays, discriminated
 * parent unions, property maps keyed by property name, and cursor paging.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

/** Notion rich text array (accepts both rich and minimal items). */
export const richTextSchema = z
  .array(
    z.object({
      type: z.string().max(32).optional(),
      text: z
        .object({
          content: z.string().max(20000),
          link: z.object({ url: z.string().url() }).nullable().optional(),
        })
        .optional(),
      plain_text: z.string().max(20000).optional(),
      annotations: z.record(z.string(), z.unknown()).optional(),
      href: z.string().url().nullable().optional(),
    }),
  )
  .max(10000);

/** Title input accepted as a rich text array or a plain string. */
export const titleSchema = z.union([richTextSchema, z.string().max(20000)]);

/** Emoji / external-file icon or cover. */
export const iconSchema = z.union([
  z.object({ type: z.literal('emoji'), emoji: z.string().min(1).max(128) }),
  z.object({
    type: z.literal('external'),
    external: z.object({ url: z.string().url().max(2048) }),
  }),
  z.object({
    type: z.literal('file'),
    file: z.object({ url: z.string().url().max(2048) }),
  }),
]);

/** Page parent union. */
export const pageParentSchema = z.union([
  z.object({ database_id: uuid, type: z.literal('database_id').optional() }),
  z.object({ page_id: uuid, type: z.literal('page_id').optional() }),
  z.object({ workspace: z.literal(true), type: z.literal('workspace').optional() }),
]);

/** `POST /v1/pages`. */
export const createPageSchema = z.object({
  parent: pageParentSchema,
  properties: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
  icon: iconSchema.nullable().optional(),
  cover: iconSchema.nullable().optional(),
});

/** `PATCH /v1/pages/:id`. */
export const updatePageSchema = z.object({
  properties: z.record(z.string(), z.unknown()).optional(),
  icon: iconSchema.nullable().optional(),
  cover: iconSchema.nullable().optional(),
  archived: z.boolean().optional(),
});

/** `POST /v1/databases`. */
export const createDatabaseSchema = z.object({
  parent: z.object({ page_id: uuid, type: z.literal('page_id').optional() }),
  title: titleSchema.optional(),
  description: titleSchema.optional(),
  properties: z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one property is required.',
    }),
  icon: iconSchema.nullable().optional(),
  is_inline: z.boolean().optional(),
});

/** `PATCH /v1/databases/:id`. */
export const updateDatabaseSchema = z.object({
  title: titleSchema.optional(),
  description: titleSchema.optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/** `POST /v1/databases/:id/query`. */
export const queryDatabaseSchema = z.object({
  filter: z.unknown().optional(),
  sorts: z.array(z.unknown()).max(100).optional(),
  start_cursor: z.string().max(500).optional(),
  page_size: z.number().int().min(1).max(100).optional(),
});

/** `POST /v1/search`. */
export const searchSchema = z.object({
  query: z.string().max(500).optional(),
  sort: z
    .object({
      direction: z.enum(['ascending', 'descending']).optional(),
      timestamp: z.literal('last_edited_time').optional(),
    })
    .optional(),
  filter: z
    .object({
      property: z.literal('object'),
      value: z.enum(['page', 'database']),
    })
    .optional(),
  start_cursor: z.string().max(500).optional(),
  page_size: z.number().int().min(1).max(100).optional(),
});

/** `PATCH /v1/blocks/:id/children`. */
export const appendChildrenSchema = z.object({
  children: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  after: uuid.optional(),
});

/** `PATCH /v1/blocks/:id` — Notion sends the type payload directly. */
export const updateBlockSchema = z.record(z.string(), z.unknown());

/** `POST /v1/webhooks`. */
export const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.string().min(1).max(128)).min(1).max(100).optional(),
  name: z.string().min(1).max(255).optional(),
});

/** `GET /v1/webhooks` query string. */
export const listWebhooksSchema = z.object({
  page_size: z.number().int().min(1).max(100).optional(),
  start_cursor: z.string().max(500).optional(),
});

export type CreatePageBody = z.infer<typeof createPageSchema>;
export type UpdatePageBody = z.infer<typeof updatePageSchema>;
export type CreateDatabaseBody = z.infer<typeof createDatabaseSchema>;
export type QueryDatabaseBody = z.infer<typeof queryDatabaseSchema>;
export type SearchBody = z.infer<typeof searchSchema>;
export type AppendChildrenBody = z.infer<typeof appendChildrenSchema>;
