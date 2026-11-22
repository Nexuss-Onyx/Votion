/**
 * Notion-compatible error envelope helpers.
 *
 * Every `/v1` failure is returned as `{ object: 'error', status, code,
 * message }` so generic Notion SDK error handling works unchanged.
 */

import type { FastifyReply } from 'fastify';

/** Canonical Notion API error body. */
export interface NotionErrorBody {
  object: 'error';
  status: number;
  code: string;
  message: string;
}

/** Builds a Notion error body. */
export function notionError(status: number, code: string, message: string): NotionErrorBody {
  return { object: 'error', status, code, message };
}

/** Sends a Notion error envelope with the matching HTTP status. */
export function sendNotionError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.code(status).send(notionError(status, code, message));
}

/** 401 — missing or invalid integration token. */
export const UNAUTHORIZED = (message = 'API key is invalid or missing.') =>
  notionError(401, 'unauthorized', message);

/** 403 — authenticated but lacking the required capability. */
export const RESTRICTED_RESOURCE = (message = 'API key does not have access to this resource.') =>
  notionError(403, 'restricted_resource', message);

/** 404 — resource missing or outside the token workspace. */
export const OBJECT_NOT_FOUND = (message = 'Object not found.') =>
  notionError(404, 'object_not_found', message);

/** 400 — malformed request body or unsupported API version. */
export const INVALID_REQUEST = (message = 'The request body is invalid.') =>
  notionError(400, 'invalid_request', message);

/** 429 — rate limited. */
export const RATE_LIMITED = (message = 'Rate limit exceeded.') =>
  notionError(429, 'rate_limited', message);

/** 500 — unexpected failure. */
export const INTERNAL_ERROR = (message = 'An unexpected error occurred.') =>
  notionError(500, 'internal_server_error', message);
