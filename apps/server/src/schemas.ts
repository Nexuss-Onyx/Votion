/**
 * Zod request schemas for every route.
 *
 * The transaction schema mirrors the canonical `@votion/types` protocol
 * (`Transaction`, `Operation`, `OperationPointer`) so invalid batches are
 * rejected with `400` before any storage is touched.
 */

import { z } from 'zod';

const uuid = z.string().uuid();

const operationPointerSchema = z.object({
  table: z.enum(['block', 'collection', 'collection_view', 'space']),
  id: uuid,
  spaceId: uuid,
});

const operationPathSchema = z.array(z.union([z.string(), z.number()])).min(1);

const operationSchema = z
  .object({
    pointer: operationPointerSchema,
    path: operationPathSchema,
    command: z.enum([
      'set',
      'update',
      'listAfter',
      'listBefore',
      'listRemove',
      'keyedObjectSet',
    ]),
    args: z.unknown(),
  })
  .superRefine((operation, ctx) => {
    const { command } = operation;
    const rawArgs: unknown = operation.args;
    const isObject = typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs);
    const args = isObject ? (rawArgs as Record<string, unknown>) : {};
    if (command === 'listAfter' && typeof args['id'] !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'listAfter requires args.id (string).',
        path: ['args', 'id'],
      });
    }
    if (command === 'listBefore' && typeof args['id'] !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'listBefore requires args.id (string).',
        path: ['args', 'id'],
      });
    }
    if (command === 'listRemove' && typeof args['id'] !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'listRemove requires args.id (string).',
        path: ['args', 'id'],
      });
    }
    if (command === 'keyedObjectSet' && typeof args['key'] !== 'string') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'keyedObjectSet requires args.key (string).',
        path: ['args', 'key'],
      });
    }
    if (command !== 'set' && !isObject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${command} requires an object payload.`,
        path: ['args'],
      });
    }
  });

const transactionSchema = z.object({
  id: uuid,
  spaceId: uuid,
  operations: z.array(operationSchema).min(1),
  createdAt: z.number().optional(),
  requestId: uuid.optional(),
});

export const saveTransactionsSchema = z.object({
  requestId: uuid,
  transactions: z.array(transactionSchema).min(1).max(100),
});

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(255),
  /** Optional personal workspace name (defaults to "<fullName>'s Workspace"). */
  workspaceName: z.string().min(1).max(255).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const loadPageChunkSchema = z.object({
  pageId: uuid,
  spaceId: uuid.optional(),
  /** Maximum recursion depth for child blocks (default 10, max 50). */
  depth: z.number().int().min(1).max(50).default(10),
  /** Maximum number of blocks returned (default 100, max 1000). */
  limit: z.number().int().min(1).max(1000).default(100),
});

const filterClauseSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.object({
      property: z.string(),
      comparator: z.string(),
      value: z.unknown().optional(),
    }),
    z.object({
      operator: z.enum(['and', 'or']),
      clauses: z.array(filterClauseSchema),
    }),
  ]),
);

export const queryCollectionSchema = z.object({
  collectionId: uuid,
  spaceId: uuid.optional(),
  filter: z
    .object({
      operator: z.enum(['and', 'or']),
      clauses: z.array(filterClauseSchema),
    })
    .optional(),
  sort: z
    .array(
      z.object({
        property: z.string(),
        direction: z.enum(['ascending', 'descending']),
      }),
    )
    .optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
  search: z.string().max(500).optional(),
});

export const getUploadFileUrlSchema = z.object({
  fileName: z.string().min(1).max(512),
  contentType: z.string().min(1).max(128),
  fileSize: z.number().int().positive(),
  spaceId: uuid.optional(),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().min(1).max(64).optional(),
  icon: z.string().max(2048).optional(),
  /** Marks the workspace as a teamspace (grouping of pages). */
  isTeamspace: z.boolean().optional(),
  parentWorkspaceId: uuid.optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  domain: z.string().min(1).max(64).nullable().optional(),
  icon: z.string().max(2048).nullable().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const addMemberSchema = z.object({
  userId: uuid,
  role: z.enum(['owner', 'admin', 'member', 'guest']).default('member'),
});

export type SaveTransactionsBody = z.infer<typeof saveTransactionsSchema>;
export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type LoadPageChunkBody = z.infer<typeof loadPageChunkSchema>;
export type QueryCollectionBody = z.infer<typeof queryCollectionSchema>;
export type GetUploadFileUrlBody = z.infer<typeof getUploadFileUrlSchema>;
