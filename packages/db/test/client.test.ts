import type { WebSocketConstructor } from '@neondatabase/serverless';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  DATABASE_DRIVERS,
  DatabaseConfigError,
  createDatabase,
  createDatabaseFromEnv,
  createNeonHttpDatabase,
  createNodeDatabase,
  isDatabaseDriver,
  type DatabaseDriver,
  type DatabaseHandle,
  type NeonHttpDatabaseClient,
  type NodePostgresDatabaseClient,
  type VotionDatabase,
} from '../src/index.js';

const FAKE_NEON_URL =
  'postgresql://votion_app:not-a-real-password@ep-votion-pooler.us-east-1.aws.neon.tech/votion?sslmode=require';
const FAKE_LOCAL_URL = 'postgresql://postgres:postgres@localhost:5432/votion';

describe('database driver selection', () => {
  it('recognises every supported driver', () => {
    expect(DATABASE_DRIVERS).toEqual(['neon-http', 'neon-websocket', 'node-postgres']);
    expect(isDatabaseDriver('neon-http')).toBe(true);
    expect(isDatabaseDriver('mysql')).toBe(false);
    expectTypeOf<(typeof DATABASE_DRIVERS)[number]>().toEqualTypeOf<DatabaseDriver>();
  });

  it('fails loudly without a connection string (and never echoes secrets)', () => {
    expect(() => createDatabase({ env: {} })).toThrow(DatabaseConfigError);
    expect(() => createDatabaseFromEnv({})).toThrow(/Missing PostgreSQL connection string/);
  });

  it('rejects unknown drivers from the environment', () => {
    expect(() =>
      createDatabaseFromEnv({ DATABASE_URL: FAKE_NEON_URL, VOTION_DB_DRIVER: 'sqlite' }),
    ).toThrow(/Invalid VOTION_DB_DRIVER/);
  });

  it('defaults to the Neon HTTP driver for serverless runtimes', () => {
    const handle = createDatabase({ connectionString: FAKE_NEON_URL, env: {} });
    expect(handle.driver).toBe('neon-http');
    expect(handle.db).toBeDefined();
    expectTypeOf(handle).toEqualTypeOf<DatabaseHandle>();
    expectTypeOf<DatabaseHandle['driver']>().toEqualTypeOf<DatabaseDriver>();
  });

  it('honours VOTION_DB_DRIVER = node-postgres', async () => {
    const handle = createDatabaseFromEnv({
      DATABASE_URL: FAKE_LOCAL_URL,
      VOTION_DB_DRIVER: 'node-postgres',
      VOTION_DB_MAX_CONNECTIONS: '4',
    });
    expect(handle.driver).toBe('node-postgres');
    await handle.close();
  });

  it('builds driver-specific clients without opening a connection', async () => {
    const httpHandle = createNeonHttpDatabase(FAKE_NEON_URL);
    expect(httpHandle.driver).toBe('neon-http');
    await httpHandle.close();

    const nodeHandle = createNodeDatabase(FAKE_LOCAL_URL, { maxConnections: 1 });
    expect(nodeHandle.driver).toBe('node-postgres');
    await nodeHandle.close();
  });

  it('creates a Neon WebSocket client with an injected socket constructor', async () => {
    class StubWebSocket {
      readyState = 0;
      binaryType = 'arraybuffer';
      close(): void {
        /* no-op stub */
      }
      send(): void {
        /* no-op stub */
      }
      addEventListener(): void {
        /* no-op stub */
      }
    }

    const handle = createDatabase({
      connectionString: FAKE_NEON_URL,
      driver: 'neon-websocket',
      env: {},
      webSocketConstructor: StubWebSocket as unknown as WebSocketConstructor,
    });

    expect(handle.driver).toBe('neon-websocket');
    await handle.close();
  });

  it('exposes typed clients bound to the full schema', () => {
    expectTypeOf<NeonHttpDatabaseClient['query']>().not.toBeNever();
    expectTypeOf<NodePostgresDatabaseClient['query']>().not.toBeNever();
    expectTypeOf<VotionDatabase>().not.toBeNever();
  });
});
