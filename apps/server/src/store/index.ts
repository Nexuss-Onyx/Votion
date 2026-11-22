/**
 * Store factory: PostgreSQL when `DATABASE_URL` is configured, in-memory
 * otherwise (tests, local development without a database).
 */

import type { ServerConfig } from '../config.js';
import { hasDatabase } from '../config.js';
import { InMemoryStore } from './memory.js';
import { createPostgresStore } from './postgres.js';
import type { DataStore } from './types.js';

export * from './types.js';
export { InMemoryStore } from './memory.js';
export { PostgresStore, createPostgresStore } from './postgres.js';

/** Creates the store selected by the server configuration. */
export function createStore(config: ServerConfig): DataStore {
  if (hasDatabase(config)) {
    return createPostgresStore({
      DATABASE_URL: config.DATABASE_URL,
      // Pooled Neon WebSocket transport is the safe default for transaction
      // batches; neon-http is stateless and must never partially apply writes.
      VOTION_DB_DRIVER: config.VOTION_DB_DRIVER ?? 'neon-websocket',
    });
  }
  return new InMemoryStore();
}
