/**
 * Object-storage presigned upload URLs (Cloudflare R2 / AWS S3).
 *
 * The client uploads file bytes directly to the bucket with the returned
 * presigned `PUT` URL; the API server never proxies file content. When no
 * credentials are configured, a deterministic HMAC-signed placeholder URL is
 * returned so the route contract can be tested offline.
 */

import { createHmac, randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { hasObjectStorage, type ServerConfig } from '../config.js';

/** MIME types accepted for uploads. */
export const ALLOWED_CONTENT_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/zip',
  'application/octet-stream',
];

/** Presigned upload result returned to the client. */
export interface UploadUrlResult {
  uploadUrl: string;
  /** Public CDN URL the client can reference after uploading. */
  publicUrl: string;
  /** Object key inside the bucket. */
  key: string;
  bucket: string;
  expiresIn: number;
}

/** Input for {@link UploadSigner.getUploadUrl}. */
export interface UploadUrlInput {
  fileName: string;
  contentType: string;
  fileSize: number;
  spaceId?: string;
}

/** Thrown when an upload request fails validation. */
export class UploadValidationError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'UploadValidationError';
    this.statusCode = statusCode;
  }
}

/** Minimal signer contract used by routes. */
export interface UploadSigner {
  getUploadUrl(input: UploadUrlInput): Promise<UploadUrlResult>;
  close(): Promise<void>;
}

/** Sanitizes a client-supplied file name into a safe object key segment. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split('/').pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned : 'file';
}

/** Builds the object key for an upload. */
export function buildObjectKey(input: UploadUrlInput): string {
  const scope = input.spaceId ? `spaces/${input.spaceId}/` : '';
  return `${scope}uploads/${randomUUID()}/${sanitizeFileName(input.fileName)}`;
}

/** Validates an upload request against the allowlist and size limit. */
export function validateUploadInput(config: ServerConfig, input: UploadUrlInput): void {
  if (!ALLOWED_CONTENT_TYPES.includes(input.contentType)) {
    throw new UploadValidationError(
      `Content type "${input.contentType}" is not allowed. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}.`,
    );
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    throw new UploadValidationError('fileSize must be a positive number of bytes.');
  }
  if (input.fileSize > config.MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      `File size ${input.fileSize} exceeds the ${config.MAX_UPLOAD_BYTES}-byte limit.`,
      413,
    );
  }
  if (!input.fileName || input.fileName.trim().length === 0) {
    throw new UploadValidationError('fileName is required.');
  }
}

/** Offline signer: deterministic HMAC-signed URLs (tests / local dev). */
export class OfflineUploadSigner implements UploadSigner {
  private readonly config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  async getUploadUrl(input: UploadUrlInput): Promise<UploadUrlResult> {
    validateUploadInput(this.config, input);
    const key = buildObjectKey(input);
    const bucket = this.config.S3_BUCKET_NAME;
    const expiresIn = 900;
    const signature = createHmac('sha256', this.config.JWT_SECRET ?? 'offline')
      .update(`${bucket}/${key}/${input.contentType}`)
      .digest('hex');
    const publicBase = this.config.S3_PUBLIC_DOMAIN ?? `https://${bucket}.example.test`;
    return {
      uploadUrl: `${publicBase}/${key}?X-Offline-Signature=${signature}&expires=${expiresIn}`,
      publicUrl: `${publicBase}/${key}`,
      key,
      bucket,
      expiresIn,
    };
  }

  async close(): Promise<void> {
    /* No resources to release. */
  }
}

/** Real S3/R2 signer using `@aws-sdk/s3-request-presigner`. */
export class S3UploadSigner implements UploadSigner {
  private readonly config: ServerConfig;
  private readonly client: S3Client;

  constructor(config: ServerConfig) {
    this.config = config;
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? '',
      },
      forcePathStyle: Boolean(config.S3_ENDPOINT),
    });
  }

  async getUploadUrl(input: UploadUrlInput): Promise<UploadUrlResult> {
    validateUploadInput(this.config, input);
    const key = buildObjectKey(input);
    const bucket = this.config.S3_BUCKET_NAME;
    const expiresIn = 900;
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.fileSize,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    const publicBase =
      this.config.S3_PUBLIC_DOMAIN ??
      (this.config.S3_ENDPOINT
        ? `${this.config.S3_ENDPOINT}/${bucket}`
        : `https://${bucket}.s3.${this.config.S3_REGION}.amazonaws.com`);
    return {
      uploadUrl,
      publicUrl: `${publicBase}/${key}`,
      key,
      bucket,
      expiresIn,
    };
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}

/** Creates the signer selected by the server configuration. */
export function createUploadSigner(config: ServerConfig): UploadSigner {
  if (hasObjectStorage(config)) {
    return new S3UploadSigner(config);
  }
  return new OfflineUploadSigner(config);
}
