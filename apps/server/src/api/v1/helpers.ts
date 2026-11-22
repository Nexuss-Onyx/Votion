/**
 * Shared helpers for `/v1` route handlers: authentication lookup, workspace
 * scoping, and Zod body parsing with Notion-shaped error responses.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import type { UUID } from '@votion/types';

import type { ApiKeyAuth } from './auth.js';
import { INVALID_REQUEST, OBJECT_NOT_FOUND, sendNotionError } from './errors.js';
import type { BlockRecord, CollectionRecord, DataStore } from '../../store/types.js';

/** Returns the authenticated API-key metadata, or `null`. */
export function requireAuth(request: FastifyRequest): ApiKeyAuth | null {
  return request.apiKeyAuth ?? null;
}

/** Returns the authenticated workspace id, or `null`. */
export function requireWorkspaceId(request: FastifyRequest): UUID | null {
  return request.apiKeyAuth?.workspaceId ?? null;
}

/**
 * Loads a block and enforces workspace scoping. Archived blocks are returned
 * (so PATCH/DELETE can operate on them); callers decide visibility.
 */
export async function loadBlockInWorkspace(
  store: DataStore,
  workspaceId: UUID,
  id: UUID,
): Promise<BlockRecord | null> {
  const block = await store.findBlockById(id);
  if (!block || block.spaceId !== workspaceId) {
    return null;
  }
  return block;
}

/** Loads a collection and enforces workspace scoping. */
export async function loadCollectionInWorkspace(
  store: DataStore,
  workspaceId: UUID,
  id: UUID,
): Promise<CollectionRecord | null> {
  const collection = await store.findCollectionById(id);
  if (!collection || collection.spaceId !== workspaceId) {
    return null;
  }
  return collection;
}

/** Resolves the collection a block belongs to (when it is a database row). */
export async function collectionForBlock(
  store: DataStore,
  block: BlockRecord,
): Promise<CollectionRecord | null> {
  if (block.parentTable !== 'collection') {
    return null;
  }
  return store.findCollectionById(block.parentId);
}

/** Parses a request body, replying `400` with a Notion error on failure. */
export function parseBody<S extends ZodType>(
  reply: FastifyReply,
  schema: S,
  body: unknown,
): { success: true; data: S['_output'] } | { success: false } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    sendNotionError(reply, 400, 'invalid_request', `Invalid request body: ${issues}`);
    return { success: false };
  }
  return { success: true, data: parsed.data };
}

/** Replies `404` for a missing/foreign resource. */
export function sendNotFound(reply: FastifyReply, message = 'Object not found.'): FastifyReply {
  return sendNotionError(reply, 404, 'object_not_found', message) as FastifyReply;
}

/** Replies `401` when no API key is attached. */
export function sendUnauthorized(reply: FastifyReply): FastifyReply {
  return sendNotionError(reply, 401, 'unauthorized', 'Missing bearer token.') as FastifyReply;
}

/** Re-exports for convenience. */
export { INVALID_REQUEST, OBJECT_NOT_FOUND };
