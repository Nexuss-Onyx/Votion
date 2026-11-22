import { createHmac } from 'node:crypto';

import type { UUID } from '@votion/types';

export interface StoredObjectMetadata {
  key: string;
  bucket: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  etag?: string;
}

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface ObjectStorageAdapter {
  readonly bucket: string;
  putObject(input: PutObjectInput): Promise<StoredObjectMetadata>;
  getObject(key: string): Promise<Buffer | null>;
  getPresignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface InMemoryObjectRecord {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  updatedAt: number;
}

export interface InMemoryObjectStorageOptions {
  bucket?: string;
  publicBaseUrl?: string;
  signingSecret?: string;
}

/**
 * Deterministic in-memory S3/R2 storage adapter used for local execution,
 * testing, and environments without external object storage credentials.
 * Operations are idempotent by object key.
 */
export class InMemoryObjectStorage implements ObjectStorageAdapter {
  readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly signingSecret: string;
  private readonly objects = new Map<string, InMemoryObjectRecord>();

  constructor(options: InMemoryObjectStorageOptions = {}) {
    this.bucket = options.bucket ?? 'votion-media';
    this.publicBaseUrl = (
      options.publicBaseUrl ?? `https://${this.bucket}.r2.cloudflarestorage.com`
    ).replace(/\/+$/, '');
    this.signingSecret = options.signingSecret ?? 'votion-task-worker-storage-secret';
  }

  async putObject(input: PutObjectInput): Promise<StoredObjectMetadata> {
    const key = sanitizeObjectKey(input.key);
    const body = Buffer.isBuffer(input.body)
      ? Buffer.from(input.body)
      : Buffer.from(input.body.buffer, input.body.byteOffset, input.body.byteLength);

    const etag = createHmac('sha256', this.signingSecret)
      .update(body)
      .digest('hex')
      .slice(0, 32);

    const record: InMemoryObjectRecord = {
      key,
      body,
      contentType: input.contentType,
      updatedAt: Date.now(),
    };
    if (input.cacheControl !== undefined) {
      record.cacheControl = input.cacheControl;
    }
    if (input.metadata !== undefined) {
      record.metadata = { ...input.metadata };
    }
    this.objects.set(key, record);

    return {
      key,
      bucket: this.bucket,
      contentType: input.contentType,
      sizeBytes: body.byteLength,
      url: `${this.publicBaseUrl}/${encodeKeyPath(key)}`,
      etag,
    };
  }

  async getObject(key: string): Promise<Buffer | null> {
    const normalized = sanitizeObjectKey(key);
    const record = this.objects.get(normalized);
    return record ? Buffer.from(record.body) : null;
  }

  async getPresignedDownloadUrl(
    key: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    const normalized = sanitizeObjectKey(key);
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, expiresInSeconds);
    const signature = createHmac('sha256', this.signingSecret)
      .update(`${this.bucket}:${normalized}:${expiresAt}`)
      .digest('hex');
    const url = new URL(`${this.publicBaseUrl}/${encodeKeyPath(normalized)}`);
    url.searchParams.set('X-Amz-Expires', String(Math.max(1, expiresInSeconds)));
    url.searchParams.set('X-Votion-Expires-At', String(expiresAt));
    url.searchParams.set('X-Votion-Signature', signature);
    return url.toString();
  }

  /** Inspection helpers for tests. */
  hasObject(key: string): boolean {
    return this.objects.has(sanitizeObjectKey(key));
  }

  getRecord(key: string): InMemoryObjectRecord | undefined {
    return this.objects.get(sanitizeObjectKey(key));
  }

  listKeys(prefix = ''): string[] {
    const normalizedPrefix = prefix ? sanitizeObjectKey(prefix) : '';
    return [...this.objects.keys()].filter((key) =>
      normalizedPrefix ? key.startsWith(normalizedPrefix) : true,
    );
  }
}

export function sanitizeObjectKey(key: string): string {
  const cleaned = key
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
  if (!cleaned) {
    throw new Error('Object storage key must not be empty.');
  }
  return cleaned;
}

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export type ThumbnailVariantName = 'small' | 'medium' | 'large';

/**
 * Deterministic object key for a block's WebP thumbnail variant so retries
 * overwrite the exact same key idempotently.
 */
export function buildThumbnailObjectKey(
  spaceId: UUID,
  blockId: UUID,
  variant: ThumbnailVariantName,
): string {
  return sanitizeObjectKey(
    `spaces/${spaceId}/thumbnails/${blockId}/${variant}.webp`,
  );
}

/**
 * Deterministic object key for an export archive or PDF artifact.
 */
export function buildExportObjectKey(
  spaceId: UUID,
  exportId: string,
  extension: 'zip' | 'pdf',
): string {
  return sanitizeObjectKey(
    `spaces/${spaceId}/exports/${exportId}/export.${extension}`,
  );
}
