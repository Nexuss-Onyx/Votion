/**
 * Environment-driven server configuration.
 *
 * Every secret is read from the environment (Neon `DATABASE_URL`, Upstash
 * `REDIS_URL`, R2/S3 credentials, JWT signing secret). Nothing is hard-coded,
 * so the same build runs locally, in CI, and on Wasmer Edge.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  /** Signing secret for JWT access tokens. Required outside tests. */
  JWT_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  DATABASE_URL: z.string().optional(),
  VOTION_DB_DRIVER: z.enum(['neon-http', 'neon-websocket', 'node-postgres']).optional(),
  REDIS_URL: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET_NAME: z.string().default('votion-media'),
  S3_PUBLIC_DOMAIN: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  /** Maximum accepted upload size (bytes). Default 100 MiB. */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  CORS_ORIGIN: z.string().default('*'),
});

export type ServerConfig = z.infer<typeof envSchema>;

const TEST_JWT_SECRET = 'votion-test-jwt-secret-not-for-production';

/** Parses and validates configuration from an environment source. */
export function loadConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid server configuration:\n${issues}`);
  }
  const config = parsed.data;
  if (!config.JWT_SECRET) {
    if (config.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required in production (min 16 characters).');
    }
    return { ...config, JWT_SECRET: TEST_JWT_SECRET };
  }
  return config;
}

/** Whether a real PostgreSQL connection string is configured. */
export function hasDatabase(config: ServerConfig): boolean {
  return Boolean(config.DATABASE_URL && config.DATABASE_URL.trim().length > 0);
}

/** Whether a real Redis connection string is configured. */
export function hasRedis(config: ServerConfig): boolean {
  return Boolean(config.REDIS_URL && config.REDIS_URL.trim().length > 0);
}

/** Whether real S3/R2 credentials are configured. */
export function hasObjectStorage(config: ServerConfig): boolean {
  return Boolean(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY);
}
