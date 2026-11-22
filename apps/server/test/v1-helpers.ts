/** Shared fixtures for the Phase 11 Developer API test suites. */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { apiTokenPrefix, generateApiToken, hashApiToken } from '../src/api/v1/auth.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { ApiKeyRecord, BlockRecord } from '../src/store/types.js';

export const config = loadConfig({ NODE_ENV: 'test' });

export const ALL_CAPABILITIES = [
  'read',
  'write',
  'manage',
  'webhooks',
  'automations',
] as const;

/** Builds a server backed by a fresh in-memory store. */
export async function makeV1App(store = new InMemoryStore()): Promise<FastifyInstance> {
  return buildServer({ config, store, logger: false });
}

/** Provisions an integration token directly in the store. */
export async function createIntegration(
  store: InMemoryStore,
  workspaceId: string,
  capabilities: string[] = [...ALL_CAPABILITIES],
): Promise<{ record: ApiKeyRecord; token: string }> {
  const token = generateApiToken();
  const record = await store.createApiKey({
    workspaceId,
    name: 'test-integration',
    tokenHash: hashApiToken(token),
    tokenPrefix: apiTokenPrefix(token),
    capabilities: [...capabilities],
  });
  return { record, token };
}

/** Authorization + Notion-Version headers for `/v1` requests. */
export function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'notion-version': '2022-06-28',
    ...extra,
  };
}

/** Seeds a standalone page block. */
export async function seedPage(
  store: InMemoryStore,
  spaceId: string,
  properties: Record<string, unknown> = {},
): Promise<BlockRecord> {
  return store.createBlock({
    spaceId,
    type: 'page',
    parentId: spaceId,
    parentTable: 'space',
    properties,
  });
}

/** Creates a database (collection + collection_view block) directly. */
export async function seedDatabase(
  store: InMemoryStore,
  spaceId: string,
  schema: BlockRecord['properties'] = {},
): Promise<{ collectionId: string; viewBlockId: string }> {
  const viewBlockId = randomUUID();
  const collection = await store.createCollection({
    spaceId,
    parentId: viewBlockId,
    name: [['Test Database']],
    schema: schema as never,
  });
  await store.createBlock({
    id: viewBlockId,
    spaceId,
    type: 'collection_view',
    parentId: spaceId,
    parentTable: 'space',
    properties: { collection_id: collection.id },
  });
  return { collectionId: collection.id, viewBlockId };
}
