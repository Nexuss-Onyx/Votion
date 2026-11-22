/**
 * Runtime configuration for the sync worker, loaded from the environment.
 */

import 'dotenv/config';

/** Fallback secret used for local development only. */
export const DEFAULT_DEV_JWT_SECRET = 'votion-sync-worker-dev-secret-change-me';

export interface SyncWorkerConfig {
  /** Interface the WebSocket server binds to. */
  host: string;
  /** Port the WebSocket server binds to. */
  port: number;
  /** Redis connection URL (e.g. rediss://default:pass@host:6379). */
  redisUrl: string;
  /** Secret used to verify client JWTs. */
  jwtSecret: string;
  /** Ping interval for the heartbeat cycle. */
  heartbeatIntervalMs: number;
  /** TTL for ephemeral presence keys, in seconds. */
  presenceTtlSeconds: number;
}

/** Builds a config from `env` (defaults to `process.env`). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SyncWorkerConfig {
  return {
    host: env.SYNC_WORKER_HOST ?? '0.0.0.0',
    port: Number(env.SYNC_WORKER_PORT ?? env.PORT ?? 8080),
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    jwtSecret: env.WS_JWT_SECRET ?? env.JWT_SECRET ?? DEFAULT_DEV_JWT_SECRET,
    heartbeatIntervalMs: Number(env.WS_HEARTBEAT_INTERVAL_MS ?? 30_000),
    presenceTtlSeconds: Number(env.PRESENCE_TTL_SECONDS ?? 10),
  };
}
