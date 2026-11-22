import { createHash } from 'node:crypto';
import { Worker, type ConnectionOptions, type Job, type WorkerOptions } from 'bullmq';

import type {
  Block,
  BlockProperties,
  BlockType,
  Collection,
  CollectionSchema,
  ParentTable,
  RichText,
  RichTextSegment,
  TextModifier,
  UUID,
} from '@votion/types';

import {
  IMPORT_QUEUE_NAME,
  type ImportJobData,
  type ImportJobResult,
} from '../queues/import.queue.js';

export interface ImportBlockStore {
  upsertBlocks(spaceId: UUID, blocks: readonly Block[]): Promise<void>;
  upsertCollection?(spaceId: UUID, collection: Collection): Promise<void>;
}

export class InMemoryImportBlockStore implements ImportBlockStore {
  private readonly blocks = new Map<UUID, Block>();
  private readonly collections = new Map<UUID, Collection>();

  async upsertBlocks(_spaceId: UUID, blocks: readonly Block[]): Promise<void> {
    for (const block of blocks) {
      this.blocks.set(block.id, structuredClone(block));
    }
  }

  async upsertCollection(
    _spaceId: UUID,
    collection: Collection,
  ): Promise<void> {
    this.collections.set(collection.id, structuredClone(collection));
  }

  getBlock(id: UUID): Block | undefined {
    const b = this.blocks.get(id);
    return b ? structuredClone(b) : undefined;
  }

  getAllBlocks(): Block[] {
    return [...this.blocks.values()].map((b) => structuredClone(b));
  }

  getCollection(id: UUID): Collection | undefined {
    const c = this.collections.get(id);
    return c ? structuredClone(c) : undefined;
  }
}

/**
 * Generates a deterministic UUID v5-shaped identifier from a namespace seed
 * so retrying an import job yields the exact same block IDs.
 */
export function deterministicUuid(seed: string): UUID {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Parses inline Markdown formatting (`**bold**`, `*italic*`, `~~strike~~`,
 * `` `code` ``, `[text](url)`) into canonical Votion {@link RichText} segments.
 */
export function parseInlineMarkdownToRichText(input: string): RichText {
  if (!input) return [];

  const segments: RichTextSegment[] = [];
  const tokenRegex =
    /(\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      const plain = input.slice(lastIndex, match.index);
      if (plain) segments.push([plain]);
    }

    if (match[2] !== undefined) {
      segments.push([match[2], [['b']]]);
    } else if (match[3] !== undefined) {
      segments.push([match[3], [['i']]]);
    } else if (match[4] !== undefined) {
      segments.push([match[4], [['s']]]);
    } else if (match[5] !== undefined) {
      segments.push([match[5], [['c']]]);
    } else if (match[6] !== undefined && match[7] !== undefined) {
      const linkText = match[6];
      const href = match[7].trim();
      const modifiers: TextModifier[] = [['a', href]];
      segments.push([linkText, modifiers]);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < input.length) {
    const trailing = input.slice(lastIndex);
    if (trailing) segments.push([trailing]);
  }

  return segments.length > 0 ? segments : [[input]];
}

interface MakeBlockParams {
  id: UUID;
  spaceId: UUID;
  type: BlockType;
  parentId: UUID;
  parentTable: ParentTable;
  properties: BlockProperties;
  content?: UUID[];
  createdBy: UUID;
  now: number;
}

function createBlockRecord(params: MakeBlockParams): Block {
  return {
    id: params.id,
    space_id: params.spaceId,
    version: 1,
    type: params.type,
    properties: params.properties,
    format: {},
    content: params.content ?? [],
    parent_id: params.parentId,
    parent_table: params.parentTable,
    alive: true,
    created_time: params.now,
    last_edited_time: params.now,
    created_by_id: params.createdBy,
    last_edited_by_id: params.createdBy,
  };
}

export interface ParseMarkdownOptions {
  spaceId: UUID;
  parentId: UUID;
  parentTable?: ParentTable;
  createdBy: UUID;
  importId: string;
  defaultTitle?: string;
  now?: number;
}

/**
 * Parses a Markdown document into a root `page` block and ordered descendant
 * blocks (`header`, `sub_header`, `sub_sub_header`, `text`, `bulleted_list`,
 * `numbered_list`, `to_do`, `quote`, `callout`, `code`, `equation`, `divider`, `image`).
 */
export function parseMarkdownToBlocks(
  markdown: string,
  options: ParseMarkdownOptions,
): { rootBlockId: UUID; blocks: Block[] } {
  const now = options.now ?? Date.now();
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  let blockCounter = 0;
  const nextBlockId = (): UUID => {
    const id = deterministicUuid(
      `${options.spaceId}:${options.importId}:md:${blockCounter}`,
    );
    blockCounter += 1;
    return id;
  };

  const rootPageId = nextBlockId();
  let pageTitle = options.defaultTitle?.trim() || 'Untitled';
  let startLineIndex = 0;

  // Check if the first non-empty line is a top-level `# Title` heading
  while (startLineIndex < lines.length && lines[startLineIndex]!.trim() === '') {
    startLineIndex += 1;
  }
  if (startLineIndex < lines.length) {
    const firstLine = lines[startLineIndex]!;
    const h1Match = /^#\s+(.+)$/.exec(firstLine.trim());
    if (h1Match && !options.defaultTitle) {
      pageTitle = h1Match[1]!.trim();
      startLineIndex += 1;
    }
  }

  const rootPage = createBlockRecord({
    id: rootPageId,
    spaceId: options.spaceId,
    type: 'page',
    parentId: options.parentId,
    parentTable: options.parentTable ?? 'space',
    properties: {
      title: parseInlineMarkdownToRichText(pageTitle),
    },
    content: [],
    createdBy: options.createdBy,
    now,
  });

  const blocksById = new Map<UUID, Block>([[rootPageId, rootPage]]);
  const blockOrder: UUID[] = [rootPageId];

  const appendChild = (parentId: UUID, child: Block): void => {
    const parent = blocksById.get(parentId);
    if (parent) {
      parent.content.push(child.id);
    }
    blocksById.set(child.id, child);
    blockOrder.push(child.id);
  };

  // Track active list hierarchy by indentation depth (2 spaces per level)
  let listStack: Array<{ indent: number; blockId: UUID }> = [];

  let i = startLineIndex;
  while (i < lines.length) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      listStack = [];
      i += 1;
      continue;
    }

    // Fenced code block: ```lang ... ```
    const codeOpenMatch = /^```([\w+-]*)\s*$/.exec(trimmed);
    if (codeOpenMatch) {
      listStack = [];
      const language = codeOpenMatch[1]?.trim() || 'plain text';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!.trim())) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) {
        i += 1; // consume closing ```
      }
      const codeBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: 'code',
        parentId: rootPageId,
        parentTable: 'block',
        properties: {
          title: [[codeLines.join('\n')]],
          language: [[language]],
        },
        createdBy: options.createdBy,
        now,
      });
      appendChild(rootPageId, codeBlock);
      continue;
    }

    // Block equation: $$ ... $$
    if (trimmed.startsWith('$$')) {
      listStack = [];
      let expr = '';
      if (trimmed.endsWith('$$') && trimmed.length > 4) {
        expr = trimmed.slice(2, -2).trim();
        i += 1;
      } else {
        const eqLines: string[] = [];
        const firstRemainder = trimmed.slice(2).trim();
        if (firstRemainder) eqLines.push(firstRemainder);
        i += 1;
        while (i < lines.length && !lines[i]!.trim().endsWith('$$')) {
          eqLines.push(lines[i]!);
          i += 1;
        }
        if (i < lines.length) {
          const closingLine = lines[i]!.trim().slice(0, -2).trim();
          if (closingLine) eqLines.push(closingLine);
          i += 1;
        }
        expr = eqLines.join('\n');
      }

      const eqBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: 'math',
        parentId: rootPageId,
        parentTable: 'block',
        properties: {
          title: [[expr]],
        },
        createdBy: options.createdBy,
        now,
      });
      appendChild(rootPageId, eqBlock);
      continue;
    }

    // Horizontal divider: --- or ***
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      listStack = [];
      const dividerBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: 'divider',
        parentId: rootPageId,
        parentTable: 'block',
        properties: {},
        createdBy: options.createdBy,
        now,
      });
      appendChild(rootPageId, dividerBlock);
      i += 1;
      continue;
    }

    // Image block: ![caption](url)
    const imageMatch = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (imageMatch) {
      listStack = [];
      const caption = imageMatch[1]!.trim();
      const sourceUrl = imageMatch[2]!.trim();
      const props: BlockProperties = {
        source: [[sourceUrl]],
        ...(caption ? { caption: parseInlineMarkdownToRichText(caption) } : {}),
      };
      const imageBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: 'image',
        parentId: rootPageId,
        parentTable: 'block',
        properties: props,
        createdBy: options.createdBy,
        now,
      });
      appendChild(rootPageId, imageBlock);
      i += 1;
      continue;
    }

    // Headings: ###, ##, #
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      listStack = [];
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!.trim();
      const headingType: BlockType =
        level === 1
          ? 'heading_1'
          : level === 2
            ? 'heading_2'
            : 'heading_3';
      const headingBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: headingType,
        parentId: rootPageId,
        parentTable: 'block',
        properties: {
          title: parseInlineMarkdownToRichText(text),
        },
        createdBy: options.createdBy,
        now,
      });
      appendChild(rootPageId, headingBlock);
      i += 1;
      continue;
    }

    // To-do checkbox list item: - [ ] or - [x]
    const todoMatch = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(rawLine);
    if (todoMatch) {
      const indent = todoMatch[1]!.length;
      const checked = todoMatch[2]!.toLowerCase() === 'x';
      const text = todoMatch[3]!.trim();

      while (
        listStack.length > 0 &&
        listStack[listStack.length - 1]!.indent >= indent
      ) {
        listStack.pop();
      }
      const parentId =
        listStack.length > 0
          ? listStack[listStack.length - 1]!.blockId
          : rootPageId;

      const todoBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: 'to_do',
        parentId,
        parentTable: 'block',
        properties: {
          title: parseInlineMarkdownToRichText(text),
          checked: [[checked ? 'yes' : 'no']],
        },
        createdBy: options.createdBy,
        now,
      });
      appendChild(parentId, todoBlock);
      listStack.push({ indent, blockId: todoBlock.id });
      i += 1;
      continue;
    }

    // Bulleted list item: - item or * item
    const bulletMatch = /^(\s*)[-*+]\s+(.+)$/.exec(rawLine);
    if (bulletMatch) {
      const indent = bulletMatch[1]!.length;
      const text = bulletMatch[2]!.trim();

      while (
        listStack.length > 0 &&
        listStack[listStack.length - 1]!.indent >= indent
      ) {
        listStack.pop();
      }
      const parentId =
        listStack.length > 0
          ? listStack[listStack.length - 1]!.blockId
          : rootPageId;

      const bulletBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: 'bulleted_list_item',
        parentId,
        parentTable: 'block',
        properties: {
          title: parseInlineMarkdownToRichText(text),
        },
        createdBy: options.createdBy,
        now,
      });
      appendChild(parentId, bulletBlock);
      listStack.push({ indent, blockId: bulletBlock.id });
      i += 1;
      continue;
    }

    // Numbered list item: 1. item
    const numberedMatch = /^(\s*)\d+\.\s+(.+)$/.exec(rawLine);
    if (numberedMatch) {
      const indent = numberedMatch[1]!.length;
      const text = numberedMatch[2]!.trim();

      while (
        listStack.length > 0 &&
        listStack[listStack.length - 1]!.indent >= indent
      ) {
        listStack.pop();
      }
      const parentId =
        listStack.length > 0
          ? listStack[listStack.length - 1]!.blockId
          : rootPageId;

      const numberedBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: 'numbered_list_item',
        parentId,
        parentTable: 'block',
        properties: {
          title: parseInlineMarkdownToRichText(text),
        },
        createdBy: options.createdBy,
        now,
      });
      appendChild(parentId, numberedBlock);
      listStack.push({ indent, blockId: numberedBlock.id });
      i += 1;
      continue;
    }

    // Quote or Callout: > text
    const quoteMatch = /^>\s*(.*)$/.exec(trimmed);
    if (quoteMatch) {
      listStack = [];
      const contentText = quoteMatch[1]!.trim();
      const calloutMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(
        contentText,
      );
      const isCallout = Boolean(calloutMatch);
      const bodyText = calloutMatch ? calloutMatch[2]!.trim() : contentText;

      const quoteBlock = createBlockRecord({
        id: nextBlockId(),
        spaceId: options.spaceId,
        type: isCallout ? 'callout' : 'quote',
        parentId: rootPageId,
        parentTable: 'block',
        properties: {
          title: parseInlineMarkdownToRichText(bodyText),
        },
        createdBy: options.createdBy,
        now,
      });
      appendChild(rootPageId, quoteBlock);
      i += 1;
      continue;
    }

    // Standard paragraph block (`text`)
    listStack = [];
    const textBlock = createBlockRecord({
      id: nextBlockId(),
      spaceId: options.spaceId,
      type: 'text',
      parentId: rootPageId,
      parentTable: 'block',
      properties: {
        title: parseInlineMarkdownToRichText(trimmed),
      },
      createdBy: options.createdBy,
      now,
    });
    appendChild(rootPageId, textBlock);
    i += 1;
  }

  return {
    rootBlockId: rootPageId,
    blocks: blockOrder.map((id) => blocksById.get(id)!),
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function htmlInlineToMarkdown(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
      .replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~')
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(
        /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
        '[$2]($1)',
      )
      .replace(/<[^>]+>/g, ''),
  ).trim();
}

/**
 * Converts an HTML document into equivalent Markdown lines and parses into a
 * Votion block tree, preserving headings, paragraphs, lists, code blocks,
 * quotes, images, and inline formatting.
 */
export function parseHtmlToBlocks(
  html: string,
  options: ParseMarkdownOptions,
): { rootBlockId: UUID; blocks: Block[] } {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const extractedTitle = titleMatch
    ? decodeHtmlEntities(titleMatch[1]!.replace(/<[^>]+>/g, '').trim())
    : undefined;

  let body = html;
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) {
    body = bodyMatch[1]!;
  }

  const mdLines: string[] = [];
  const blockTokenRegex =
    /<(h[1-6]|p|blockquote|pre|ul|ol|hr|img)\b([^>]*)>([\s\S]*?)<\/\1>|<(hr|img)\b([^>]*)\/?>/gi;

  let match: RegExpExecArray | null;
  while ((match = blockTokenRegex.exec(body)) !== null) {
    const tag = (match[1] ?? match[4] ?? '').toLowerCase();
    const attrs = match[2] ?? match[5] ?? '';
    const inner = match[3] ?? '';

    if (tag === 'h1') {
      mdLines.push(`# ${htmlInlineToMarkdown(inner)}`);
    } else if (tag === 'h2') {
      mdLines.push(`## ${htmlInlineToMarkdown(inner)}`);
    } else if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      mdLines.push(`### ${htmlInlineToMarkdown(inner)}`);
    } else if (tag === 'p') {
      const text = htmlInlineToMarkdown(inner);
      if (text) mdLines.push(text);
    } else if (tag === 'blockquote') {
      const text = htmlInlineToMarkdown(inner);
      if (text) mdLines.push(`> ${text}`);
    } else if (tag === 'pre') {
      const langMatch = /class=["'][^"']*language-([\w+-]+)[^"']*["']/i.exec(
        inner + ' ' + attrs,
      );
      const lang = langMatch?.[1] ?? '';
      const rawCode = decodeHtmlEntities(inner.replace(/<[^>]+>/g, '')).trim();
      mdLines.push(`\`\`\`${lang}\n${rawCode}\n\`\`\``);
    } else if (tag === 'ul') {
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        mdLines.push(`- ${htmlInlineToMarkdown(liMatch[1]!)}`);
      }
    } else if (tag === 'ol') {
      const liRegex = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let idx = 1;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(inner)) !== null) {
        mdLines.push(`${idx}. ${htmlInlineToMarkdown(liMatch[1]!)}`);
        idx += 1;
      }
    } else if (tag === 'hr') {
      mdLines.push('---');
    } else if (tag === 'img') {
      const srcMatch = /src=["']([^"']+)["']/i.exec(attrs);
      const altMatch = /alt=["']([^"']*)["']/i.exec(attrs);
      if (srcMatch?.[1]) {
        mdLines.push(`![${altMatch?.[1] ?? ''}](${srcMatch[1]})`);
      }
    }
  }

  const markdown = mdLines.join('\n\n');
  return parseMarkdownToBlocks(markdown, {
    ...options,
    ...(options.defaultTitle ?? extractedTitle
      ? { defaultTitle: options.defaultTitle ?? extractedTitle }
      : {}),
  });
}

/**
 * RFC 4180 compliant CSV parser handling quoted fields, escaped double-quotes,
 * and embedded newlines.
 */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          currentCell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\n') {
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.length > 0) || currentRow.length > 1) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((cell) => cell.length > 0) || currentRow.length > 1) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function parseCsvToCollectionAndBlocks(
  csvText: string,
  options: ParseMarkdownOptions,
): { rootBlockId: UUID; blocks: Block[]; collection: Collection } {
  const now = options.now ?? Date.now();
  const parsedRows = parseCsvRows(csvText);
  const headers = parsedRows[0] ?? ['Name'];
  const dataRows = parsedRows.slice(1);

  const rootBlockId = deterministicUuid(
    `${options.spaceId}:${options.importId}:csv:root`,
  );
  const collectionId = deterministicUuid(
    `${options.spaceId}:${options.importId}:csv:collection`,
  );

  const schema: CollectionSchema = {};
  const propIds: string[] = [];

  headers.forEach((rawHeader, index) => {
    const headerName = rawHeader.trim() || `Column ${index + 1}`;
    const propId = index === 0 ? 'title' : `prop_${index}`;
    propIds.push(propId);
    schema[propId] = {
      name: headerName,
      type: index === 0 ? 'title' : 'text',
    };
  });

  const collectionTitle = options.defaultTitle?.trim() || 'Imported Database';
  const collection: Collection = {
    id: collectionId,
    space_id: options.spaceId,
    parent_id: rootBlockId,
    name: [[collectionTitle]],
    schema,
    alive: true,
    version: 1,
    created_time: now,
    last_edited_time: now,
    created_by_id: options.createdBy,
    last_edited_by_id: options.createdBy,
  };

  const rowBlocks: Block[] = dataRows.map((cells, rowIdx) => {
    const rowId = deterministicUuid(
      `${options.spaceId}:${options.importId}:csv:row:${rowIdx}`,
    );
    const properties: BlockProperties = {};
    propIds.forEach((propId, colIdx) => {
      const cellValue = (cells[colIdx] ?? '').trim();
      properties[propId] = cellValue ? [[cellValue]] : [];
    });
    return createBlockRecord({
      id: rowId,
      spaceId: options.spaceId,
      type: 'page',
      parentId: collectionId,
      parentTable: 'collection',
      properties,
      createdBy: options.createdBy,
      now,
    });
  });

  const rootBlock = createBlockRecord({
    id: rootBlockId,
    spaceId: options.spaceId,
    type: 'collection_view',
    parentId: options.parentId,
    parentTable: options.parentTable ?? 'space',
    properties: {
      title: [[collectionTitle]],
      collection_id: collectionId,
    },
    content: rowBlocks.map((r) => r.id),
    createdBy: options.createdBy,
    now,
  });

  return {
    rootBlockId,
    blocks: [rootBlock, ...rowBlocks],
    collection,
  };
}

export interface ImportWorkerOptions {
  store?: ImportBlockStore;
}

/**
 * Parses uploaded Markdown, HTML, and CSV files into canonical Votion block
 * trees and persists them idempotently.
 */
export class ImportWorker {
  private readonly store?: ImportBlockStore;

  constructor(options: ImportWorkerOptions = {}) {
    if (options.store) {
      this.store = options.store;
    }
  }

  async process(data: ImportJobData): Promise<ImportJobResult> {
    const parseOptions: ParseMarkdownOptions = {
      spaceId: data.spaceId,
      parentId: data.parentId,
      parentTable: data.parentTable ?? 'space',
      createdBy: data.createdBy,
      importId: data.importId,
      ...(data.title !== undefined ? { defaultTitle: data.title } : {}),
    };

    if (data.format === 'csv') {
      const { rootBlockId, blocks, collection } =
        parseCsvToCollectionAndBlocks(data.content, parseOptions);
      if (this.store) {
        if (this.store.upsertCollection) {
          await this.store.upsertCollection(data.spaceId, collection);
        }
        await this.store.upsertBlocks(data.spaceId, blocks);
      }
      return {
        importId: data.importId,
        format: 'csv',
        rootBlockId,
        blocks,
        collection,
      };
    }

    const parsed =
      data.format === 'html'
        ? parseHtmlToBlocks(data.content, parseOptions)
        : parseMarkdownToBlocks(data.content, parseOptions);

    if (this.store) {
      await this.store.upsertBlocks(data.spaceId, parsed.blocks);
    }

    return {
      importId: data.importId,
      format: data.format,
      rootBlockId: parsed.rootBlockId,
      blocks: parsed.blocks,
    };
  }
}

export interface CreateImportBullWorkerConfig extends ImportWorkerOptions {
  connection: ConnectionOptions;
  prefix?: string;
  concurrency?: number;
  workerOptions?: Partial<WorkerOptions>;
}

export function createImportBullWorker(
  config: CreateImportBullWorkerConfig,
): Worker<ImportJobData, ImportJobResult, string> {
  const processor = new ImportWorker(config);
  return new Worker<ImportJobData, ImportJobResult, string>(
    IMPORT_QUEUE_NAME,
    async (job: Job<ImportJobData, ImportJobResult, string>) =>
      processor.process(job.data),
    {
      connection: config.connection,
      prefix: config.prefix ?? 'votion',
      concurrency: config.concurrency ?? 2,
      ...config.workerOptions,
    },
  );
}
