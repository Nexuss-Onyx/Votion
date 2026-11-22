import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { Worker, type ConnectionOptions, type Job, type WorkerOptions } from 'bullmq';
import puppeteer from 'puppeteer-core';

import {
  richTextToPlainText,
  type Block,
  type Collection,
  type RichText,
  type TextModifier,
  type UUID,
} from '@votion/types';

import {
  EXPORT_QUEUE_NAME,
  type ExportFileEntry,
  type ExportJobData,
  type ExportJobResult,
} from '../queues/export.queue.js';
import {
  buildExportObjectKey,
  type ObjectStorageAdapter,
} from '../storage.js';

export interface ExportDataSource {
  getSubtreeBlocks(spaceId: UUID, rootPageId: UUID): Promise<Block[]>;
  getCollectionsInSpace?(spaceId: UUID): Promise<Collection[]>;
}

export class InMemoryExportDataSource implements ExportDataSource {
  private readonly blocks = new Map<UUID, Block>();
  private readonly collections = new Map<UUID, Collection>();

  constructor(
    blocks: Iterable<Block> = [],
    collections: Iterable<Collection> = [],
  ) {
    for (const block of blocks) {
      this.blocks.set(block.id, structuredClone(block));
    }
    for (const col of collections) {
      this.collections.set(col.id, structuredClone(col));
    }
  }

  upsertBlocks(blocks: Iterable<Block>): void {
    for (const b of blocks) {
      this.blocks.set(b.id, structuredClone(b));
    }
  }

  upsertCollection(collection: Collection): void {
    this.collections.set(collection.id, structuredClone(collection));
  }

  async getSubtreeBlocks(spaceId: UUID, rootPageId: UUID): Promise<Block[]> {
    const out: Block[] = [];
    const visited = new Set<UUID>();
    const queue: UUID[] = [rootPageId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const block = this.blocks.get(currentId);
      if (!block || block.space_id !== spaceId || !block.alive) continue;
      out.push(structuredClone(block));

      for (const childId of block.content) {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }
      for (const candidate of this.blocks.values()) {
        if (
          candidate.space_id === spaceId &&
          candidate.alive &&
          candidate.parent_id === currentId &&
          !visited.has(candidate.id)
        ) {
          queue.push(candidate.id);
        }
      }
    }

    return out;
  }

  async getCollectionsInSpace(spaceId: UUID): Promise<Collection[]> {
    const out: Collection[] = [];
    for (const col of this.collections.values()) {
      if (col.space_id === spaceId && col.alive) {
        out.push(structuredClone(col));
      }
    }
    return out;
  }
}

/**
 * Serializes canonical Votion {@link RichText} segments back into inline Markdown.
 */
export function serializeRichTextToMarkdown(
  richText: RichText | undefined,
): string {
  if (!richText || richText.length === 0) return '';

  return richText
    .map((segment) => {
      const [rawText, modifiers] = segment;
      if (!rawText) return '';
      if (!modifiers || modifiers.length === 0) return rawText;

      let formatted = rawText;
      const modList: readonly TextModifier[] = modifiers;

      const hasCode = modList.some((m) => m[0] === 'c');
      if (hasCode) {
        formatted = `\`${formatted}\``;
      }

      const hasBold = modList.some((m) => m[0] === 'b');
      if (hasBold) {
        formatted = `**${formatted}**`;
      }

      const hasItalic = modList.some((m) => m[0] === 'i');
      if (hasItalic) {
        formatted = `*${formatted}*`;
      }

      const hasStrike = modList.some((m) => m[0] === 's');
      if (hasStrike) {
        formatted = `~~${formatted}~~`;
      }

      const linkMod = modList.find(
        (m): m is ['a', string] => m[0] === 'a' && typeof m[1] === 'string',
      );
      if (linkMod) {
        formatted = `[${formatted}](${linkMod[1]})`;
      }

      return formatted;
    })
    .join('');
}

function isBlockChecked(block: Block): boolean {
  const checked = block.properties?.checked;
  if (!checked || !Array.isArray(checked)) return false;
  const plain = richTextToPlainText(checked).trim().toLowerCase();
  return plain === 'yes' || plain === 'true' || plain === '1';
}

/**
 * Serializes a page block sub-tree into clean Markdown.
 */
export function serializeBlocksToMarkdown(
  rootPageId: UUID,
  blocks: readonly Block[],
): string {
  const blockMap = new Map<UUID, Block>();
  for (const block of blocks) {
    if (block.alive) {
      blockMap.set(block.id, block);
    }
  }

  const rootBlock = blockMap.get(rootPageId);
  if (!rootBlock) {
    return '';
  }

  const blocksOut: string[] = [];
  const rootTitle = serializeRichTextToMarkdown(rootBlock.properties?.title).trim();
  if (rootTitle) {
    blocksOut.push(`# ${rootTitle}`);
  }

  const visited = new Set<UUID>([rootPageId]);

  const renderListSubtree = (
    block: Block,
    depth: number,
    numberIndex: number,
  ): string[] => {
    visited.add(block.id);
    const indent = '  '.repeat(depth);
    const titleMd = serializeRichTextToMarkdown(block.properties?.title);
    const lines: string[] = [];

    if (block.type === 'to_do') {
      const mark = isBlockChecked(block) ? 'x' : ' ';
      lines.push(`${indent}- [${mark}] ${titleMd}`);
    } else if (block.type === 'numbered_list_item') {
      lines.push(`${indent}${numberIndex}. ${titleMd}`);
    } else {
      lines.push(`${indent}- ${titleMd}`);
    }

    let childNumberCounter = 1;
    for (const childId of block.content) {
      if (visited.has(childId)) continue;
      const child = blockMap.get(childId);
      if (!child) continue;
      if (
        child.type === 'bulleted_list_item' ||
        child.type === 'numbered_list_item' ||
        child.type === 'to_do'
      ) {
        const idx = child.type === 'numbered_list_item' ? childNumberCounter++ : 1;
        lines.push(...renderListSubtree(child, depth + 1, idx));
      } else {
        const rendered = renderBlockNode(child);
        if (rendered) lines.push(rendered);
      }
    }

    return lines;
  };

  const renderBlockNode = (block: Block): string | null => {
    if (visited.has(block.id)) return null;
    visited.add(block.id);

    const titleMd = serializeRichTextToMarkdown(block.properties?.title);

    switch (block.type) {
      case 'heading_1':
        return `# ${titleMd}`;
      case 'heading_2':
        return `## ${titleMd}`;
      case 'heading_3':
        return `### ${titleMd}`;
      case 'text':
        return titleMd;
      case 'quote':
        return `> ${titleMd}`;
      case 'callout':
        return `> [!NOTE] ${titleMd}`;
      case 'divider':
        return '---';
      case 'code': {
        const lang = richTextToPlainText(block.properties?.language).trim();
        const codeBody = richTextToPlainText(block.properties?.title);
        const fenceHeader = lang && lang !== 'plain text' ? `\`\`\`${lang}` : '```';
        return `${fenceHeader}\n${codeBody}\n\`\`\``;
      }
      case 'math': {
        const expr = richTextToPlainText(block.properties?.title).trim();
        return `$$ ${expr} $$`;
      }
      case 'image': {
        const src = richTextToPlainText(block.properties?.source).trim();
        const caption = serializeRichTextToMarkdown(block.properties?.caption).trim();
        return `![${caption}](${src})`;
      }
      case 'bookmark': {
        const rawLink = (block.properties?.link ?? block.properties?.source) as
          | RichText
          | undefined;
        const link = richTextToPlainText(rawLink).trim();
        const label = titleMd || link;
        return `[${label}](${link})`;
      }
      case 'page': {
        return `[${titleMd || 'Subpage'}](${block.id}.md)`;
      }
      default:
        return titleMd || null;
    }
  };

  let i = 0;
  const topLevelIds = rootBlock.content;
  while (i < topLevelIds.length) {
    const childId = topLevelIds[i]!;
    const child = blockMap.get(childId);
    if (!child || visited.has(child.id)) {
      i += 1;
      continue;
    }

    if (
      child.type === 'bulleted_list_item' ||
      child.type === 'numbered_list_item' ||
      child.type === 'to_do'
    ) {
      const listType = child.type;
      const listGroupLines: string[] = [];
      let numberedCounter = 1;
      while (i < topLevelIds.length) {
        const candidateId = topLevelIds[i]!;
        const candidate = blockMap.get(candidateId);
        if (!candidate || candidate.type !== listType) {
          break;
        }
        const idx =
          candidate.type === 'numbered_list_item' ? numberedCounter++ : 1;
        listGroupLines.push(...renderListSubtree(candidate, 0, idx));
        i += 1;
      }
      if (listGroupLines.length > 0) {
        blocksOut.push(listGroupLines.join('\n'));
      }
      continue;
    }

    const rendered = renderBlockNode(child);
    if (rendered !== null && rendered !== '') {
      blocksOut.push(rendered);
    }
    i += 1;
  }

  return blocksOut.join('\n\n') + '\n';
}

function escapeCsvCell(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serializes a {@link Collection} and its row blocks into RFC 4180 CSV text.
 */
export function serializeCollectionToCsv(
  collection: Collection,
  rowBlocks: readonly Block[],
): string {
  const schemaEntries = Object.entries(collection.schema);
  // Put title column first
  schemaEntries.sort(([, a], [, b]) => {
    if (a.type === 'title' && b.type !== 'title') return -1;
    if (a.type !== 'title' && b.type === 'title') return 1;
    return 0;
  });

  const headerLine = schemaEntries
    .map(([, prop]) => escapeCsvCell(prop.name))
    .join(',');

  const lines: string[] = [headerLine];

  for (const row of rowBlocks) {
    if (!row.alive || row.parent_id !== collection.id) continue;
    const props = (row.properties ?? {}) as Record<string, unknown>;
    const cells = schemaEntries.map(([propId]) => {
      const raw = props[propId];
      if (raw === null || raw === undefined) return '';
      if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
        return escapeCsvCell(String(raw));
      }
      if (Array.isArray(raw)) {
        if (raw.every((seg) => Array.isArray(seg) && typeof seg[0] === 'string')) {
          return escapeCsvCell(richTextToPlainText(raw as RichText));
        }
        return escapeCsvCell(raw.map((v) => String(v)).join(', '));
      }
      return '';
    });
    lines.push(cells.join(','));
  }

  return lines.join('\n') + '\n';
}

/**
 * Packages file entries into an in-memory `.zip` Buffer using `archiver`.
 */
export async function createZipArchiveBuffer(
  files: readonly ExportFileEntry[],
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on('error', reject);
    archive.on('error', reject);

    archive.pipe(stream);

    for (const file of files) {
      const buf =
        typeof file.content === 'string'
          ? Buffer.from(file.content, 'utf8')
          : file.content;
      archive.append(buf, { name: file.path });
    }

    void archive.finalize();
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders a page block sub-tree into a standalone printable HTML document
 * suitable for headless Chromium / Puppeteer PDF generation.
 */
export function renderBlocksToPrintableHtml(
  rootPageId: UUID,
  blocks: readonly Block[],
): string {
  const blockMap = new Map<UUID, Block>(
    blocks.filter((b) => b.alive).map((b) => [b.id, b]),
  );
  const root = blockMap.get(rootPageId);
  const pageTitle = root
    ? richTextToPlainText(root.properties?.title).trim() || 'Untitled'
    : 'Untitled';

  const bodyParts: string[] = [`<h1>${escapeHtml(pageTitle)}</h1>`];

  for (const childId of root?.content ?? []) {
    const block = blockMap.get(childId);
    if (!block) continue;
    const text = escapeHtml(richTextToPlainText(block.properties?.title));
    switch (block.type) {
      case 'heading_1':
        bodyParts.push(`<h1>${text}</h1>`);
        break;
      case 'heading_2':
        bodyParts.push(`<h2>${text}</h2>`);
        break;
      case 'heading_3':
        bodyParts.push(`<h3>${text}</h3>`);
        break;
      case 'quote':
      case 'callout':
        bodyParts.push(`<blockquote>${text}</blockquote>`);
        break;
      case 'code':
        bodyParts.push(`<pre><code>${text}</code></pre>`);
        break;
      case 'divider':
        bodyParts.push('<hr />');
        break;
      case 'bulleted_list_item':
      case 'numbered_list_item':
      case 'to_do':
        bodyParts.push(`<p>• ${text}</p>`);
        break;
      default:
        bodyParts.push(`<p>${text}</p>`);
        break;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pageTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; color: #1f2328; line-height: 1.6; }
    h1, h2, h3 { margin-top: 1.4em; margin-bottom: 0.5em; }
    blockquote { border-left: 3px solid #d0d7de; margin-left: 0; padding-left: 16px; color: #57606a; }
    pre { background: #f6f8fa; padding: 12px; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body>
  ${bodyParts.join('\n  ')}
</body>
</html>`;
}

/**
 * Generates a syntactically valid PDF-1.4 document buffer containing the
 * exported text when a headless Chromium executable is not installed on the host.
 */
export function buildFallbackPdfBuffer(title: string, plainBody: string): Buffer {
  const sanitizedLines = [title, '', ...plainBody.split('\n')]
    .map((line) =>
      line
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .slice(0, 100),
    )
    .slice(0, 45);

  const textOps = sanitizedLines
    .map((line, idx) =>
      idx === 0 ? `(${line}) Tj` : `0 -15 Td (${line}) Tj`,
    )
    .join('\n');

  const streamContent = `BT\n/F1 11 Tf\n50 750 Td\n${textOps}\nET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'utf8')} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

export type PdfRenderer = (
  html: string,
  markdownPreview: string,
  title: string,
) => Promise<Buffer>;

function sanitizeFilename(title: string, fallback: string): string {
  const cleaned = title
    .replace(/[^a-zA-Z0-9._-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned || fallback;
}

export interface ExportWorkerOptions {
  storage: ObjectStorageAdapter;
  dataSource?: ExportDataSource;
  chromiumExecutablePath?: string;
  pdfRenderer?: PdfRenderer;
  defaultExpiresInSeconds?: number;
}

/**
 * Packages page sub-trees into Markdown and CSV files, compresses them into
 * `.zip` archives using `archiver` (or renders PDF documents via `puppeteer-core`),
 * uploads to S3/R2 object storage, and returns a time-limited download URL.
 */
export class ExportWorker {
  private readonly storage: ObjectStorageAdapter;
  private readonly dataSource?: ExportDataSource;
  private readonly chromiumExecutablePath?: string;
  private readonly pdfRenderer?: PdfRenderer;
  private readonly defaultExpiresInSeconds: number;

  constructor(options: ExportWorkerOptions) {
    this.storage = options.storage;
    this.defaultExpiresInSeconds = options.defaultExpiresInSeconds ?? 3600;
    if (options.dataSource) {
      this.dataSource = options.dataSource;
    }
    if (options.chromiumExecutablePath) {
      this.chromiumExecutablePath = options.chromiumExecutablePath;
    }
    if (options.pdfRenderer) {
      this.pdfRenderer = options.pdfRenderer;
    }
  }

  private async renderPdfBuffer(
    html: string,
    markdownPreview: string,
    title: string,
  ): Promise<Buffer> {
    if (this.pdfRenderer) {
      return this.pdfRenderer(html, markdownPreview, title);
    }

    if (this.chromiumExecutablePath) {
      const browser = await puppeteer.launch({
        executablePath: this.chromiumExecutablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
        });
        return Buffer.from(pdfBytes);
      } finally {
        await browser.close();
      }
    }

    return buildFallbackPdfBuffer(title, markdownPreview);
  }

  async process(data: ExportJobData): Promise<ExportJobResult> {
    const blocks =
      data.blocks ??
      (this.dataSource
        ? await this.dataSource.getSubtreeBlocks(data.spaceId, data.rootPageId)
        : []);

    const collections =
      data.collections ??
      (this.dataSource?.getCollectionsInSpace
        ? await this.dataSource.getCollectionsInSpace(data.spaceId)
        : []);

    const rootBlock = blocks.find((b) => b.id === data.rootPageId);
    const rootTitle = rootBlock
      ? richTextToPlainText(rootBlock.properties?.title).trim() || 'Untitled'
      : 'Untitled';

    const expiresIn = data.expiresInSeconds ?? this.defaultExpiresInSeconds;

    if (data.format === 'pdf') {
      const html = renderBlocksToPrintableHtml(data.rootPageId, blocks);
      const mdPreview = serializeBlocksToMarkdown(data.rootPageId, blocks);
      const pdfBuffer = await this.renderPdfBuffer(html, mdPreview, rootTitle);

      const objectKey = buildExportObjectKey(data.spaceId, data.exportId, 'pdf');
      const stored = await this.storage.putObject({
        key: objectKey,
        body: pdfBuffer,
        contentType: 'application/pdf',
        metadata: {
          exportId: data.exportId,
          spaceId: data.spaceId,
          rootPageId: data.rootPageId,
        },
      });
      const downloadUrl = await this.storage.getPresignedDownloadUrl(
        stored.key,
        expiresIn,
      );

      return {
        exportId: data.exportId,
        format: 'pdf',
        objectKey: stored.key,
        downloadUrl,
        sizeBytes: stored.sizeBytes,
        filePaths: [`${sanitizeFilename(rootTitle, data.rootPageId)}.pdf`],
      };
    }

    // Markdown + CSV zip archive
    const files: ExportFileEntry[] = [];
    const rootFilename = `${sanitizeFilename(rootTitle, data.rootPageId)}.md`;
    const rootMarkdown = serializeBlocksToMarkdown(data.rootPageId, blocks);
    files.push({
      path: rootFilename,
      contentType: 'text/markdown',
      content: rootMarkdown,
    });

    if (data.includeSubpages !== false) {
      const subPages = blocks.filter(
        (b) =>
          b.alive &&
          b.id !== data.rootPageId &&
          b.type === 'page' &&
          b.parent_table !== 'collection',
      );
      for (const subPage of subPages) {
        const subTitle =
          richTextToPlainText(subPage.properties?.title).trim() || subPage.id;
        const subFilename = `subpages/${sanitizeFilename(subTitle, subPage.id)}-${subPage.id.slice(0, 8)}.md`;
        files.push({
          path: subFilename,
          contentType: 'text/markdown',
          content: serializeBlocksToMarkdown(subPage.id, blocks),
        });
      }
    }

    for (const collection of collections) {
      if (!collection.alive) continue;
      const colName =
        richTextToPlainText(collection.name).trim() || collection.id;
      const csvFilename = `databases/${sanitizeFilename(colName, collection.id)}.csv`;
      const csvContent = serializeCollectionToCsv(collection, blocks);
      files.push({
        path: csvFilename,
        contentType: 'text/csv',
        content: csvContent,
      });
    }

    const zipBuffer = await createZipArchiveBuffer(files);
    const objectKey = buildExportObjectKey(data.spaceId, data.exportId, 'zip');
    const stored = await this.storage.putObject({
      key: objectKey,
      body: zipBuffer,
      contentType: 'application/zip',
      metadata: {
        exportId: data.exportId,
        spaceId: data.spaceId,
        rootPageId: data.rootPageId,
      },
    });

    const downloadUrl = await this.storage.getPresignedDownloadUrl(
      stored.key,
      expiresIn,
    );

    return {
      exportId: data.exportId,
      format: 'markdown-csv-zip',
      objectKey: stored.key,
      downloadUrl,
      sizeBytes: stored.sizeBytes,
      filePaths: files.map((f) => f.path),
    };
  }
}

export interface CreateExportBullWorkerConfig extends ExportWorkerOptions {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
  workerOptions?: Partial<WorkerOptions>;
}

export function createExportBullWorker(
  config: CreateExportBullWorkerConfig,
): Worker<ExportJobData, ExportJobResult, string> {
  const processor = new ExportWorker(config);
  return new Worker<ExportJobData, ExportJobResult, string>(
    EXPORT_QUEUE_NAME,
    async (job: Job<ExportJobData, ExportJobResult, string>) =>
      processor.process(job.data),
    {
      connection: config.connection,
      prefix: config.prefix ?? 'votion',
      concurrency: config.concurrency ?? 2,
      ...config.workerOptions,
    },
  );
}
