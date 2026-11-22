import { Worker, type ConnectionOptions, type Job, type WorkerOptions } from 'bullmq';
import ogs from 'open-graph-scraper';
import sharp from 'sharp';

import type { Block, UUID } from '@votion/types';

import {
  MEDIA_PROCESSOR_QUEUE_NAME,
  type GeneratedThumbnailArtifact,
  type ImageThumbnailJobData,
  type MediaProcessorJobData,
  type MediaProcessorJobResult,
  type OpenGraphMetadata,
  type OpenGraphScrapeJobData,
  type ThumbnailSpec,
} from '../queues/media-processor.queue.js';
import {
  buildThumbnailObjectKey,
  type ObjectStorageAdapter,
  type ThumbnailVariantName,
} from '../storage.js';

export const DEFAULT_THUMBNAIL_SPECS: readonly ThumbnailSpec[] = [
  { variant: 'small', width: 320, quality: 80 },
  { variant: 'medium', width: 800, quality: 82 },
  { variant: 'large', width: 1600, quality: 85 },
] as const;

export interface MediaBlockMetadataStore {
  saveImageThumbnails(
    spaceId: UUID,
    blockId: UUID,
    thumbnails: Record<ThumbnailVariantName, GeneratedThumbnailArtifact>,
  ): Promise<void>;
  saveBookmarkMetadata(
    spaceId: UUID,
    blockId: UUID,
    metadata: OpenGraphMetadata,
  ): Promise<void>;
}

/**
 * In-memory block metadata store for media jobs (thumbnails & OpenGraph bookmarks).
 */
export class InMemoryMediaBlockMetadataStore implements MediaBlockMetadataStore {
  private readonly blocks = new Map<UUID, Block>();
  private readonly thumbnailsByBlock = new Map<
    UUID,
    Record<ThumbnailVariantName, GeneratedThumbnailArtifact>
  >();
  private readonly bookmarksByBlock = new Map<UUID, OpenGraphMetadata>();

  constructor(initialBlocks: Iterable<Block> = []) {
    for (const block of initialBlocks) {
      this.blocks.set(block.id, structuredClone(block));
    }
  }

  upsertBlock(block: Block): void {
    this.blocks.set(block.id, structuredClone(block));
  }

  getBlock(blockId: UUID): Block | undefined {
    const b = this.blocks.get(blockId);
    return b ? structuredClone(b) : undefined;
  }

  getThumbnails(
    blockId: UUID,
  ): Record<ThumbnailVariantName, GeneratedThumbnailArtifact> | undefined {
    return this.thumbnailsByBlock.get(blockId);
  }

  getBookmarkMetadata(blockId: UUID): OpenGraphMetadata | undefined {
    return this.bookmarksByBlock.get(blockId);
  }

  async saveImageThumbnails(
    spaceId: UUID,
    blockId: UUID,
    thumbnails: Record<ThumbnailVariantName, GeneratedThumbnailArtifact>,
  ): Promise<void> {
    this.thumbnailsByBlock.set(blockId, structuredClone(thumbnails));
    const block = this.blocks.get(blockId);
    if (block && block.space_id === spaceId) {
      block.format = {
        ...(block.format ?? {}),
        display_source: thumbnails.medium.url,
        thumbnails: {
          small: thumbnails.small.url,
          medium: thumbnails.medium.url,
          large: thumbnails.large.url,
        },
      };
      block.version += 1;
      block.last_edited_time = Date.now();
    }
  }

  async saveBookmarkMetadata(
    spaceId: UUID,
    blockId: UUID,
    metadata: OpenGraphMetadata,
  ): Promise<void> {
    this.bookmarksByBlock.set(blockId, structuredClone(metadata));
    const block = this.blocks.get(blockId);
    if (block && block.space_id === spaceId) {
      block.properties = {
        ...(block.properties ?? {}),
        title: [[metadata.title]],
        link: [[metadata.url]],
        ...(metadata.description
          ? { description: [[metadata.description]] }
          : {}),
      };
      block.format = {
        ...(block.format ?? {}),
        ...(metadata.imageUrl ? { bookmark_cover: metadata.imageUrl } : {}),
        ...(metadata.faviconUrl ? { bookmark_icon: metadata.faviconUrl } : {}),
      };
      block.version += 1;
      block.last_edited_time = Date.now();
    }
  }
}

export type HtmlLoader = (url: string) => Promise<string>;

export interface MediaProcessorWorkerOptions {
  storage: ObjectStorageAdapter;
  metadataStore?: MediaBlockMetadataStore;
  /** Optional custom HTML loader for OpenGraph scraping (useful in offline/proxied environments). */
  htmlLoader?: HtmlLoader;
}

function resolveBufferFromSource(source: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(source)) return source;
  if (source instanceof Uint8Array) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength);
  }
  const base64Body = source.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  return Buffer.from(base64Body, 'base64');
}

function resolveAbsoluteUrl(candidate: string | undefined, baseUrl: string): string | undefined {
  if (!candidate || !candidate.trim()) return undefined;
  try {
    return new URL(candidate.trim(), baseUrl).toString();
  } catch {
    return candidate.trim();
  }
}

interface OgsResultShape {
  ogTitle?: string;
  twitterTitle?: string;
  dcTitle?: string;
  ogDescription?: string;
  twitterDescription?: string;
  dcDescription?: string;
  ogSiteName?: string;
  favicon?: string;
  ogImage?: Array<{ url?: string }> | { url?: string };
  twitterImage?: Array<{ url?: string }> | { url?: string };
}

type OgsCallable = (options: {
  url?: string;
  html?: string;
  timeout?: number;
}) => Promise<{
  error: boolean;
  result: OgsResultShape;
}>;

const runOpenGraphScraper: OgsCallable = ogs as unknown as OgsCallable;

/**
 * Generates WebP image thumbnails (`small`, `medium`, `large`) using Sharp,
 * uploads them to S3/R2 object storage, and scrapes OpenGraph link previews
 * for bookmark blocks via `open-graph-scraper`.
 */
export class MediaProcessorWorker {
  private readonly storage: ObjectStorageAdapter;
  private readonly metadataStore?: MediaBlockMetadataStore;
  private readonly htmlLoader?: HtmlLoader;

  constructor(options: MediaProcessorWorkerOptions) {
    this.storage = options.storage;
    if (options.metadataStore) {
      this.metadataStore = options.metadataStore;
    }
    if (options.htmlLoader) {
      this.htmlLoader = options.htmlLoader;
    }
  }

  async process(data: MediaProcessorJobData): Promise<MediaProcessorJobResult> {
    if (data.kind === 'image-thumbnail') {
      return this.processImageThumbnail(data);
    }
    return this.processOpenGraphBookmark(data);
  }

  async processImageThumbnail(
    data: ImageThumbnailJobData,
  ): Promise<Extract<MediaProcessorJobResult, { kind: 'image-thumbnail' }>> {
    let sourceBuffer: Buffer | null = null;
    if (data.sourceImage !== undefined) {
      sourceBuffer = resolveBufferFromSource(data.sourceImage);
    } else if (data.sourceObjectKey) {
      sourceBuffer = await this.storage.getObject(data.sourceObjectKey);
    }

    if (!sourceBuffer || sourceBuffer.byteLength === 0) {
      throw new Error(
        `Unable to load source image for block "${data.blockId}". Provide sourceImage or an existing sourceObjectKey.`,
      );
    }

    const specs =
      data.variants && data.variants.length > 0
        ? data.variants
        : DEFAULT_THUMBNAIL_SPECS;

    const thumbnails = {} as Record<
      ThumbnailVariantName,
      GeneratedThumbnailArtifact
    >;

    for (const spec of specs) {
      const quality = spec.quality ?? data.quality ?? 82;
      const resizeOptions: sharp.ResizeOptions = {
        width: spec.width,
        fit: 'inside',
        withoutEnlargement: true,
        ...(spec.height !== undefined ? { height: spec.height } : {}),
      };

      const { data: webpBuffer, info } = await sharp(sourceBuffer)
        .rotate()
        .resize(resizeOptions)
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      const key = buildThumbnailObjectKey(
        data.spaceId,
        data.blockId,
        spec.variant,
      );

      const stored = await this.storage.putObject({
        key,
        body: webpBuffer,
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          blockId: data.blockId,
          spaceId: data.spaceId,
          variant: spec.variant,
          width: String(info.width),
          height: String(info.height),
        },
      });

      thumbnails[spec.variant] = {
        variant: spec.variant,
        key: stored.key,
        url: stored.url,
        width: info.width,
        height: info.height,
        sizeBytes: info.size,
        format: 'webp',
      };
    }

    if (this.metadataStore) {
      await this.metadataStore.saveImageThumbnails(
        data.spaceId,
        data.blockId,
        thumbnails,
      );
    }

    return {
      kind: 'image-thumbnail',
      blockId: data.blockId,
      thumbnails,
    };
  }

  async processOpenGraphBookmark(
    data: OpenGraphScrapeJobData,
  ): Promise<Extract<MediaProcessorJobResult, { kind: 'opengraph-bookmark' }>> {
    const html =
      data.html ??
      (this.htmlLoader ? await this.htmlLoader(data.url) : undefined);

    const ogsResponse = await runOpenGraphScraper(
      html !== undefined ? { html } : { url: data.url, timeout: 10 },
    );

    const raw = ogsResponse.result ?? {};
    const title =
      raw.ogTitle?.trim() ||
      raw.twitterTitle?.trim() ||
      raw.dcTitle?.trim() ||
      new URL(data.url).hostname;

    const description =
      raw.ogDescription?.trim() ||
      raw.twitterDescription?.trim() ||
      raw.dcDescription?.trim() ||
      undefined;

    const rawOgImage = Array.isArray(raw.ogImage)
      ? raw.ogImage[0]?.url
      : raw.ogImage?.url;
    const rawTwitterImage = Array.isArray(raw.twitterImage)
      ? raw.twitterImage[0]?.url
      : raw.twitterImage?.url;

    const imageUrl = resolveAbsoluteUrl(
      rawOgImage ?? rawTwitterImage,
      data.url,
    );
    const faviconUrl = resolveAbsoluteUrl(raw.favicon, data.url);
    const siteName = raw.ogSiteName?.trim() || undefined;

    const metadata: OpenGraphMetadata = {
      url: data.url,
      title,
      ...(description !== undefined ? { description } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(siteName !== undefined ? { siteName } : {}),
      ...(faviconUrl !== undefined ? { faviconUrl } : {}),
    };

    if (this.metadataStore) {
      await this.metadataStore.saveBookmarkMetadata(
        data.spaceId,
        data.blockId,
        metadata,
      );
    }

    return {
      kind: 'opengraph-bookmark',
      blockId: data.blockId,
      metadata,
    };
  }
}

export interface CreateMediaProcessorBullWorkerConfig
  extends MediaProcessorWorkerOptions {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
  workerOptions?: Partial<WorkerOptions>;
}

export function createMediaProcessorBullWorker(
  config: CreateMediaProcessorBullWorkerConfig,
): Worker<MediaProcessorJobData, MediaProcessorJobResult, string> {
  const processor = new MediaProcessorWorker(config);
  return new Worker<MediaProcessorJobData, MediaProcessorJobResult, string>(
    MEDIA_PROCESSOR_QUEUE_NAME,
    async (job: Job<MediaProcessorJobData, MediaProcessorJobResult, string>) =>
      processor.process(job.data),
    {
      connection: config.connection,
      prefix: config.prefix ?? 'votion',
      concurrency: config.concurrency ?? 2,
      ...config.workerOptions,
    },
  );
}
