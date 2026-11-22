import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import { buildServer } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { InMemoryStore } from '../src/store/memory.js';
import type { BlockRecord, UserRecord, WorkspaceRecord } from '../src/store/types.js';

export const config = loadConfig({ NODE_ENV: 'test' });

export async function makeApp(store = new InMemoryStore()): Promise<FastifyInstance> {
  return buildServer({ config, store, logger: false });
}

export async function registerUser(app: FastifyInstance, email = `user-${randomUUID()}@example.test`) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'test-password-123', fullName: 'Test User' },
  });
  return { response, body: response.json() as {
    user: UserRecord;
    workspace: WorkspaceRecord;
    accessToken: string;
    refreshToken: string;
  } };
}

export async function addBlock(
  store: InMemoryStore,
  spaceId: string,
  input: { id?: string; parentId?: string; content?: string[]; properties?: Record<string, unknown> } = {},
): Promise<BlockRecord> {
  return store.createBlock({
    id: input.id,
    spaceId,
    type: 'page',
    parentId: input.parentId ?? spaceId,
    parentTable: 'space',
    content: input.content ?? [],
    properties: input.properties ?? {},
    createdById: null,
  });
}
