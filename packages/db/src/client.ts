/**
 * Database client factory.
 *
 * Votion runs on three PostgreSQL transports depending on the runtime:
 *
 * | Driver             | Runtime                                    | Transport        |
 * | :----------------- | :----------------------------------------- | :--------------- |
 * | `neon-http`        | Wasmer Edge / serverless / edge functions  | HTTPS fetch      |
 * | `neon-websocket`   | Node long-running servers, migrations      | WebSockets       |
 * | `node-postgres`    | Local dev, CI, self-hosted Postgres        | TCP (`pg`)       |
 *
 * No connection string is ever hard-coded: every factory takes it explicitly (or
 * reads `DATABASE_URL`), so no secret can leak into the repository.
 */

import {
  Pool as NeonPool,
  neon,
  neonConfig,
  type WebSocketConstructor,
} from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { drizzle as drizzleNeonHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
  drizzle as drizzleNeonWebSocket,
  type NeonDatabase,
} from 'drizzle-orm/neon-serverless';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool as NodePgPool } from 'pg';

import * as schema from './schema/index.js';

/** Fully-typed Drizzle schema namespace (tables, enums, relations). */
export type DatabaseSchema = typeof schema;

/** Drizzle database bound to Neon's HTTP (fetch) driver. */
export type NeonHttpDatabaseClient = NeonHttpDatabase<DatabaseSchema>;

/** Drizzle database bound to Neon's WebSocket (Pool) driver. */
export type NeonWebSocketDatabaseClient = NeonDatabase<DatabaseSchema>;

/** Drizzle database bound to the standard `pg` (node-postgres) driver. */
export type NodePostgresDatabaseClient = NodePgDatabase<DatabaseSchema>;

/** Any Drizzle client produced by this package. */
export type VotionDatabase =
  | NeonHttpDatabaseClient
  | NeonWebSocketDatabaseClient
  | NodePostgresDatabaseClient;

/** Supported PostgreSQL transports. */
export type DatabaseDriver = 'neon-http' | 'neon-websocket' | 'node-postgres';

/** Every supported driver, in preference order. */
export const DATABASE_DRIVERS: readonly DatabaseDriver[] = [
  'neon-http',
  'neon-websocket',
  'node-postgres',
];

/** Configuration accepted by {@link createDatabase}. */
export interface DatabaseOptions {
  /** PostgreSQL connection string (defaults to `DATABASE_URL`). */
  connectionString?: string;
  /** Transport to use (defaults to `VOTION_DB_DRIVER` or `neon-http`). */
  driver?: DatabaseDriver;
  /** Maximum pool size for pooled drivers. */
  maxConnections?: number;
  /** Custom WebSocket implementation for the Neon WebSocket driver. */
  webSocketConstructor?: WebSocketConstructor;
  /** Log every executed statement (development only). */
  logger?: boolean;
  /** Environment source (defaults to `process.env` when available). */
  env?: Readonly<Record<string, string | undefined>>;
}

/** Connected database handle: the client plus a deterministic teardown. */
export interface DatabaseHandle<TDatabase extends VotionDatabase = VotionDatabase> {
  db: TDatabase;
  driver: DatabaseDriver;
  /** Ends pooled connections (no-op for the stateless HTTP driver). */
  close(): Promise<void>;
}

/** Thrown when the database is misconfigured (never contains the URL). */
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/** Narrows an arbitrary string to a supported {@link DatabaseDriver}. */
export function isDatabaseDriver(value: string): value is DatabaseDriver {
  return (DATABASE_DRIVERS as readonly string[]).includes(value);
}

const DEFAULT_MAX_CONNECTIONS = 10;

function readProcessEnv(): Readonly<Record<string, string | undefined>> {
  if (typeof process === 'undefined' || !process.env) {
    return {};
  }
  return process.env;
}

function resolveEnv(
  options: Pick<DatabaseOptions, 'env'>,
): Readonly<Record<string, string | undefined>> {
  return options.env ?? readProcessEnv();
}

function resolveConnectionString(options: DatabaseOptions): string {
  const connectionString = options.connectionString ?? resolveEnv(options).DATABASE_URL;
  if (!connectionString || connectionString.trim().length === 0) {
    throw new DatabaseConfigError(
      'Missing PostgreSQL connection string: pass `connectionString` or set DATABASE_URL.',
    );
  }
  return connectionString;
}

function resolveLogger(logger: boolean | undefined): boolean {
  return logger ?? false;
}

/**
 * Global WebSocket constructor (Node >= 21 / browsers / edge runtimes).
 * Cast through a structural type so the package never depends on DOM typings.
 */
const globalScope = globalThis as typeof globalThis & {
  WebSocket?: WebSocketConstructor;
};

function defaultWebSocketConstructor(): WebSocketConstructor | undefined {
  return globalScope.WebSocket;
}

/** Creates a stateless Neon HTTP (fetch) database client. */
export function createNeonHttpDatabase(
  connectionString: string,
  options: Pick<DatabaseOptions, 'logger'> = {},
): DatabaseHandle<NeonHttpDatabaseClient> {
  const db = drizzleNeonHttp(neon(connectionString), {
    schema,
    logger: resolveLogger(options.logger),
  });

  return {
    db,
    driver: 'neon-http',
    close: () => Promise.resolve(),
  };
}

/** Creates a Neon WebSocket (pooled) database client. */
export function createNeonWebSocketDatabase(
  connectionString: string,
  options: Pick<
    DatabaseOptions,
    'logger' | 'maxConnections' | 'webSocketConstructor'
  > = {},
): DatabaseHandle<NeonWebSocketDatabaseClient> {
  const webSocketConstructor =
    options.webSocketConstructor ?? defaultWebSocketConstructor();

  if (!webSocketConstructor) {
    throw new DatabaseConfigError(
      'The Neon WebSocket driver requires a WebSocket implementation on Node < 22: pass `webSocketConstructor`.',
    );
  }

  neonConfig.webSocketConstructor = webSocketConstructor;

  const pool = new NeonPool({
    connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
  });

  const db = drizzleNeonWebSocket(pool, {
    schema,
    logger: resolveLogger(options.logger),
  });

  return {
    db,
    driver: 'neon-websocket',
    close: async () => {
      await pool.end();
    },
  };
}

/** Creates a standard node-postgres (`pg`) pooled database client. */
export function createNodeDatabase(
  connectionString: string,
  options: Pick<DatabaseOptions, 'logger' | 'maxConnections'> = {},
): DatabaseHandle<NodePostgresDatabaseClient> {
  const pool = new NodePgPool({
    connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
  });

  const db = drizzleNodePg(pool, {
    schema,
    logger: resolveLogger(options.logger),
  });

  return {
    db,
    driver: 'node-postgres',
    close: async () => {
      await pool.end();
    },
  };
}

/** Creates a database handle using the requested (or environment) transport. */
export function createDatabase(options: DatabaseOptions = {}): DatabaseHandle {
  const connectionString = resolveConnectionString(options);
  const configuredDriver = resolveEnv(options).VOTION_DB_DRIVER;
  const driver: DatabaseDriver =
    options.driver ??
    (configuredDriver && isDatabaseDriver(configuredDriver) ? configuredDriver : 'neon-http');

  switch (driver) {
    case 'neon-http':
      return createNeonHttpDatabase(connectionString, options);
    case 'neon-websocket':
      return createNeonWebSocketDatabase(connectionString, options);
    case 'node-postgres':
      return createNodeDatabase(connectionString, options);
  }
}

/** Creates a database handle from `process.env` (or an injected environment). */
export function createDatabaseFromEnv(
  env: Readonly<Record<string, string | undefined>> = readProcessEnv(),
): DatabaseHandle {
  const configuredDriver = env.VOTION_DB_DRIVER;

  if (configuredDriver !== undefined && !isDatabaseDriver(configuredDriver)) {
    throw new DatabaseConfigError(
      `Invalid VOTION_DB_DRIVER "${configuredDriver}". Expected one of: ${DATABASE_DRIVERS.join(', ')}.`,
    );
  }

  const maxConnections = env.VOTION_DB_MAX_CONNECTIONS
    ? Number.parseInt(env.VOTION_DB_MAX_CONNECTIONS, 10)
    : undefined;

  return createDatabase({
    connectionString: env.DATABASE_URL,
    driver: configuredDriver,
    maxConnections:
      maxConnections !== undefined && Number.isFinite(maxConnections)
        ? maxConnections
        : undefined,
    env,
  });
}

/** Cheap liveness probe used by readiness endpoints and CI smoke tests. */
export async function pingDatabase(database: VotionDatabase): Promise<void> {
  await database.execute(sql`select 1`);
}

/**
 * Typed `db.query` surface of the schema (relational query builder), useful for
 * services that want to accept a schema-bound database without repeating the
 * generic argument.
 */
export type DatabaseQuery = VotionDatabase['query'];
