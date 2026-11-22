import 'dotenv/config';

export interface TaskWorkerConfig {
  /** Redis connection URL (`redis://` or `rediss://`) used by BullMQ queues and workers. */
  redisUrl: string;
  /** Key prefix for BullMQ queues in Redis. */
  queuePrefix: string;
  /** Optional PostgreSQL connection string. */
  databaseUrl?: string;
  /** Optional Meilisearch host URL. */
  meilisearchHost?: string;
  /** Optional Meilisearch admin/indexing API key. */
  meilisearchApiKey?: string;
  /** S3 / Cloudflare R2 bucket name for thumbnails and export bundles. */
  s3Bucket: string;
  /** Optional S3 / Cloudflare R2 endpoint URL. */
  s3Endpoint?: string;
  /** S3 region (defaults to `auto` for R2 compatibility). */
  s3Region: string;
  /** Optional S3 access key id. */
  s3AccessKeyId?: string;
  /** Optional S3 secret access key. */
  s3SecretAccessKey?: string;
  /** Public base URL used to construct time-limited download links and asset URLs. */
  s3PublicBaseUrl: string;
  /** Default worker concurrency per BullMQ worker instance. */
  workerConcurrency: number;
  /** Batch size for hierarchy cascade traversal (defaults to 500 per Phase 9 spec). */
  cascadeBatchSize: number;
  /** Expiration window (in seconds) for exported bundle download links. */
  exportUrlExpiresInSeconds: number;
  /** Optional path to headless Chromium / Chrome binary for Puppeteer PDF rendering. */
  chromiumExecutablePath?: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): TaskWorkerConfig {
  const redisUrl = env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const queuePrefix = env.BULLMQ_PREFIX ?? 'votion';
  const s3Bucket = env.S3_BUCKET ?? 'votion-media';
  const s3Region = env.S3_REGION ?? 'auto';
  const s3Endpoint = env.S3_ENDPOINT?.trim() || undefined;
  const s3PublicBaseUrl = (
    env.S3_PUBLIC_BASE_URL?.trim() ||
    (s3Endpoint ? `${s3Endpoint.replace(/\/+$/, '')}/${s3Bucket}` : `https://${s3Bucket}.r2.cloudflarestorage.com`)
  ).replace(/\/+$/, '');

  const config: TaskWorkerConfig = {
    redisUrl,
    queuePrefix,
    s3Bucket,
    s3Region,
    s3PublicBaseUrl,
    workerConcurrency: parsePositiveInt(env.WORKER_CONCURRENCY, 4),
    cascadeBatchSize: parsePositiveInt(env.CASCADE_BATCH_SIZE, 500),
    exportUrlExpiresInSeconds: parsePositiveInt(
      env.EXPORT_URL_EXPIRES_IN_SECONDS,
      3600,
    ),
  };

  if (env.DATABASE_URL?.trim()) {
    config.databaseUrl = env.DATABASE_URL.trim();
  }
  if (env.MEILISEARCH_HOST?.trim()) {
    config.meilisearchHost = env.MEILISEARCH_HOST.trim();
  }
  if (env.MEILISEARCH_API_KEY?.trim()) {
    config.meilisearchApiKey = env.MEILISEARCH_API_KEY.trim();
  }
  if (s3Endpoint) {
    config.s3Endpoint = s3Endpoint;
  }
  if (env.S3_ACCESS_KEY_ID?.trim()) {
    config.s3AccessKeyId = env.S3_ACCESS_KEY_ID.trim();
  }
  if (env.S3_SECRET_ACCESS_KEY?.trim()) {
    config.s3SecretAccessKey = env.S3_SECRET_ACCESS_KEY.trim();
  }
  if (env.CHROMIUM_EXECUTABLE_PATH?.trim()) {
    config.chromiumExecutablePath = env.CHROMIUM_EXECUTABLE_PATH.trim();
  }

  return config;
}
