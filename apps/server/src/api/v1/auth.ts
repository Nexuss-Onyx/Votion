/**
 * Developer API authentication (Phase 11).
 *
 * Integration tokens use Notion's `secret_...` shape. Only the SHA-256 digest
 * is stored; verification hashes the presented token and looks up the digest.
 * The pre-handler attaches workspace + bot capability metadata to the request.
 */

import { createHash, randomBytes } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { UUID } from '@votion/types';

import type { ApiKeyRecord, DataStore } from '../../store/types.js';
import { sendNotionError } from './errors.js';

/** Prefix carried by every Votion integration token. */
export const API_TOKEN_PREFIX = 'secret_';

/** Minimum entropy of the token body (48 URL-safe characters by default). */
const TOKEN_BODY_LENGTH = 48;

const API_TOKEN_PATTERN = /^secret_[A-Za-z0-9_-]+$/;

/** Generates a new plaintext integration token (shown once to the user). */
export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url').slice(0, TOKEN_BODY_LENGTH)}`;
}

/** SHA-256 hex digest used for at-rest token storage. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Returns the display-safe prefix of a token (`secret_abcd1234`). */
export function apiTokenPrefix(token: string): string {
  return token.slice(0, 16);
}

/** Whether a presented token has the expected `secret_...` shape. */
export function isApiTokenFormat(token: string): boolean {
  return API_TOKEN_PATTERN.test(token);
}

/** Authentication metadata attached to every `/v1` request. */
export interface ApiKeyAuth {
  apiKeyId: UUID;
  workspaceId: UUID;
  capabilities: string[];
  integration: { id: UUID; name: string; type: 'bot' };
}

/** Verifies a plaintext token against the store, enforcing revocation/expiry. */
export async function verifyApiToken(
  store: DataStore,
  token: string,
): Promise<ApiKeyRecord | null> {
  if (!isApiTokenFormat(token)) {
    return null;
  }
  const record = await store.findApiKeyByTokenHash(hashApiToken(token));
  if (!record || record.revokedAt !== null) {
    return null;
  }
  if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return record;
}

/**
 * Fastify pre-handler that authenticates `Authorization: Bearer secret_...`
 * and populates `request.apiKeyAuth`.
 */
export function createApiKeyAuth(store: DataStore) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      await sendNotionError(reply, 401, 'unauthorized', 'Missing bearer token.');
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    const record = await verifyApiToken(store, token);
    if (!record) {
      await sendNotionError(reply, 401, 'unauthorized', 'API key is invalid or missing.');
      return;
    }
    request.apiKeyAuth = {
      apiKeyId: record.id,
      workspaceId: record.workspaceId,
      capabilities: [...record.capabilities],
      integration: { id: record.id, name: record.name, type: 'bot' },
    };
    // Audit stamp; authentication must never fail because of it.
    try {
      await store.touchApiKeyLastUsed(record.id);
    } catch {
      /* best-effort */
    }
  };
}

/**
 * Capability guard. `manage` is the administrative super-scope and satisfies
 * any other capability.
 */
export function capabilityGuard(...required: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const auth = request.apiKeyAuth;
    if (!auth) {
      await sendNotionError(reply, 401, 'unauthorized', 'Missing bearer token.');
      return;
    }
    const granted = required.every(
      (capability) =>
        auth.capabilities.includes(capability) || auth.capabilities.includes('manage'),
    );
    if (!granted) {
      await sendNotionError(
        reply,
        403,
        'restricted_resource',
        `API key lacks the required capability: ${required.join(', ')}.`,
      );
    }
  };
}

/** Returns the authenticated workspace id or `null`. */
export function authedWorkspace(request: FastifyRequest): UUID | null {
  return request.apiKeyAuth?.workspaceId ?? null;
}
