import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';

import type { UUID } from '@votion/types';

import type { ThumbnailVariantName } from '../storage.js';
import type { CreateQueueConfig } from './search-indexing.queue.js';

export const MEDIA_PROCESSOR_QUEUE_NAME = 'media-processor' as const;

export interface ThumbnailSpec {
  variant: ThumbnailVariantName;
  width: number;
  height?: number;
  quality?: number;
}

export interface ImageThumbnailJobData {
  kind: 'image-thumbnail';
  spaceId: UUID;
  blockId: UUID;
  /**
   * Raw image bytes (Buffer or base64 string) or object storage key
   * pointing to the uploaded source image.
   */
  sourceImage?: Buffer | Uint8Array | string;
  sourceObjectKey?: string;
  /** Optional custom variant dimensions (defaults to small=320, medium=800, large=1600). */
  variants?: ThumbnailSpec[];
  /** WebP compression quality (1–100, default 82). */
  quality?: number;
}

export interface OpenGraphScrapeJobData {
  kind: 'opengraph-bookmark';
  spaceId: UUID;
  blockId: UUID;
  url: string;
  /** Optional pre-fetched HTML document for offline/deterministic parsing. */
  html?: string;
}

export type MediaProcessorJobData =
  | ImageThumbnailJobData
  | OpenGraphScrapeJobData;

export interface GeneratedThumbnailArtifact {
  variant: ThumbnailVariantName;
  key: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  format: 'webp';
}

export interface OpenGraphMetadata {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  faviconUrl?: string;
}

export type MediaProcessorJobResult =
  | {
      kind: 'image-thumbnail';
      blockId: UUID;
      thumbnails: Record<ThumbnailVariantName, GeneratedThumbnailArtifact>;
    }
  | {
      kind: 'opengraph-bookmark';
      blockId: UUID;
      metadata: OpenGraphMetadata;
    };

export const DEFAULT_MEDIA_PROCESSOR_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1500,
  },
  removeOnComplete: { count: 250 },
  removeOnFail: { count: 500 },
};

export function buildMediaProcessorJobId(data: MediaProcessorJobData): string {
  if (data.kind === 'image-thumbnail') {
    return `media:thumb:${data.spaceId}:${data.blockId}`;
  }
  return `media:og:${data.spaceId}:${data.blockId}:${data.url}`;
}

export function createMediaProcessorQueue(
  config: CreateQueueConfig,
): Queue<MediaProcessorJobData, MediaProcessorJobResult, string> {
  const queueOptions: QueueOptions = {
    connection: config.connection,
    prefix: config.prefix ?? 'votion',
    defaultJobOptions: {
      ...DEFAULT_MEDIA_PROCESSOR_JOB_OPTIONS,
      ...config.defaultJobOptions,
    },
  };
  return new Queue<MediaProcessorJobData, MediaProcessorJobResult, string>(
    MEDIA_PROCESSOR_QUEUE_NAME,
    queueOptions,
  );
}
