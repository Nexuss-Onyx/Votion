import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { Block, UUID } from '@votion/types';

import { InMemoryObjectStorage } from '../src/storage.js';
import {
  InMemoryMediaBlockMetadataStore,
  MediaProcessorWorker,
} from '../src/workers/MediaProcessorWorker.js';

const SPACE_ID: UUID = '00000000-0000-4000-8000-000000000010';
const IMAGE_BLOCK_ID: UUID = '00000000-0000-4000-8000-000000000011';
const BOOKMARK_BLOCK_ID: UUID = '00000000-0000-4000-8000-000000000012';
const USER_ID: UUID = '00000000-0000-4000-8000-000000000099';

async function createSampleSourcePng(
  width = 2000,
  height = 1200,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 42, g: 112, b: 220 },
    },
  })
    .png()
    .toBuffer();
}

describe('MediaProcessorWorker', () => {
  it('generates small, medium, and large WebP thumbnails with Sharp and uploads to storage', async () => {
    const sourcePng = await createSampleSourcePng(2000, 1200);
    const storage = new InMemoryObjectStorage({
      bucket: 'votion-media',
      publicBaseUrl: 'https://cdn.votion.dev',
    });

    const imageBlock: Block = {
      id: IMAGE_BLOCK_ID,
      space_id: SPACE_ID,
      version: 1,
      type: 'image',
      properties: {
        source: [['https://cdn.votion.dev/raw/hero.png']],
      },
      format: {},
      content: [],
      parent_id: SPACE_ID,
      parent_table: 'space',
      alive: true,
      created_time: 1_700_000_000_000,
      last_edited_time: 1_700_000_000_000,
      created_by_id: USER_ID,
      last_edited_by_id: USER_ID,
    };

    const metadataStore = new InMemoryMediaBlockMetadataStore([imageBlock]);
    const worker = new MediaProcessorWorker({
      storage,
      metadataStore,
    });

    const result = await worker.process({
      kind: 'image-thumbnail',
      spaceId: SPACE_ID,
      blockId: IMAGE_BLOCK_ID,
      sourceImage: sourcePng,
    });

    expect(result.kind).toBe('image-thumbnail');
    if (result.kind !== 'image-thumbnail') {
      throw new Error('Unexpected result kind');
    }

    const { small, medium, large } = result.thumbnails;

    expect(small.format).toBe('webp');
    expect(small.width).toBe(320);
    expect(small.height).toBe(192);
    expect(small.sizeBytes).toBeGreaterThan(0);

    expect(medium.format).toBe('webp');
    expect(medium.width).toBe(800);
    expect(medium.height).toBe(480);
    expect(medium.sizeBytes).toBeGreaterThan(0);

    expect(large.format).toBe('webp');
    expect(large.width).toBe(1600);
    expect(large.height).toBe(960);
    expect(large.sizeBytes).toBeGreaterThan(0);

    // Inspect the actual bytes written to storage using Sharp
    for (const artifact of [small, medium, large]) {
      const storedBuffer = await storage.getObject(artifact.key);
      expect(storedBuffer).not.toBeNull();
      const meta = await sharp(storedBuffer!).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(artifact.width);
      expect(meta.height).toBe(artifact.height);
    }

    // Verify block metadata store was updated
    const updatedBlock = metadataStore.getBlock(IMAGE_BLOCK_ID);
    expect(updatedBlock?.format?.display_source).toBe(medium.url);

    // Idempotence: re-running overwrites exact same keys without duplicating objects
    await worker.process({
      kind: 'image-thumbnail',
      spaceId: SPACE_ID,
      blockId: IMAGE_BLOCK_ID,
      sourceImage: sourcePng,
    });
    expect(storage.listKeys(`spaces/${SPACE_ID}/thumbnails/${IMAGE_BLOCK_ID}`)).toHaveLength(3);
  });

  it('extracts OpenGraph metadata for bookmark blocks via open-graph-scraper', async () => {
    const storage = new InMemoryObjectStorage();
    const bookmarkBlock: Block = {
      id: BOOKMARK_BLOCK_ID,
      space_id: SPACE_ID,
      version: 1,
      type: 'bookmark',
      properties: {
        source: [['https://votion.dev/docs/architecture']],
      },
      format: {},
      content: [],
      parent_id: SPACE_ID,
      parent_table: 'space',
      alive: true,
      created_time: 1_700_000_000_000,
      last_edited_time: 1_700_000_000_000,
      created_by_id: USER_ID,
      last_edited_by_id: USER_ID,
    };

    const metadataStore = new InMemoryMediaBlockMetadataStore([bookmarkBlock]);
    const worker = new MediaProcessorWorker({
      storage,
      metadataStore,
    });

    const sampleHtml = `<!DOCTYPE html>
<html>
  <head>
    <title>Votion Architecture</title>
    <meta property="og:title" content="Votion Edge Architecture Guide" />
    <meta property="og:description" content="Real-time collaborative workspace powered by Wasmer Edge and BullMQ." />
    <meta property="og:image" content="https://votion.dev/assets/og-architecture.png" />
    <meta property="og:site_name" content="Votion Docs" />
    <link rel="icon" href="/favicon.ico" />
  </head>
  <body></body>
</html>`;

    const result = await worker.process({
      kind: 'opengraph-bookmark',
      spaceId: SPACE_ID,
      blockId: BOOKMARK_BLOCK_ID,
      url: 'https://votion.dev/docs/architecture',
      html: sampleHtml,
    });

    expect(result.kind).toBe('opengraph-bookmark');
    if (result.kind !== 'opengraph-bookmark') {
      throw new Error('Unexpected result kind');
    }

    expect(result.metadata.title).toBe('Votion Edge Architecture Guide');
    expect(result.metadata.description).toBe(
      'Real-time collaborative workspace powered by Wasmer Edge and BullMQ.',
    );
    expect(result.metadata.imageUrl).toBe(
      'https://votion.dev/assets/og-architecture.png',
    );
    expect(result.metadata.siteName).toBe('Votion Docs');
    expect(result.metadata.faviconUrl).toBe('https://votion.dev/favicon.ico');

    const updatedBlock = metadataStore.getBlock(BOOKMARK_BLOCK_ID);
    expect(updatedBlock?.properties?.title).toEqual([
      ['Votion Edge Architecture Guide'],
    ]);
    expect(updatedBlock?.format?.bookmark_cover).toBe(
      'https://votion.dev/assets/og-architecture.png',
    );
  });
});
