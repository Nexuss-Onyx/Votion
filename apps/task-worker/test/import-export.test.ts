import { describe, expect, it } from 'vitest';

import type { UUID } from '@votion/types';

import { InMemoryObjectStorage } from '../src/storage.js';
import {
  ExportWorker,
  serializeBlocksToMarkdown,
  serializeCollectionToCsv,
} from '../src/workers/ExportWorker.js';
import {
  ImportWorker,
  InMemoryImportBlockStore,
} from '../src/workers/ImportWorker.js';

const SPACE_ID: UUID = '00000000-0000-4000-8000-000000000020';
const PARENT_SPACE_ID: UUID = '00000000-0000-4000-8000-000000000020';
const USER_ID: UUID = '00000000-0000-4000-8000-000000000099';

describe('ImportWorker & ExportWorker round-trip verification', () => {
  it('round-trips Markdown import -> Block tree -> Markdown export losslessly', async () => {
    const sourceMarkdown = [
      '# Votion Phase 9 Engineering Spec',
      '',
      'Welcome to the **Votion** worker fleet with *italic*, ~~strikethrough~~, `inline code`, and [Docs](https://votion.dev/docs).',
      '',
      '## Core Responsibilities',
      '',
      '- Cascade soft-deletes across deep hierarchies',
      '  - Nested child bullet item',
      '- Index rich text into Meilisearch',
      '',
      '1. Enqueue background job',
      '2. Process idempotently',
      '',
      '- [x] Implement HierarchyCascadeWorker',
      '- [ ] Verify production metrics',
      '',
      '### Code Example',
      '',
      '> Asynchronous background queues keep HTTP latency low.',
      '',
      '> [!NOTE] Every job handler is idempotent across retries.',
      '',
      '```typescript',
      'const queue = createSearchIndexingQueue({ connection });',
      'await queue.add("index", payload);',
      '```',
      '',
      '$$ E = mc^2 $$',
      '',
      '---',
      '',
      '![Architecture Diagram](https://votion.dev/diagram.png)',
      '',
    ].join('\n');

    const importStore = new InMemoryImportBlockStore();
    const importWorker = new ImportWorker({ store: importStore });

    const imported = await importWorker.process({
      importId: 'roundtrip-spec-01',
      spaceId: SPACE_ID,
      parentId: PARENT_SPACE_ID,
      parentTable: 'space',
      createdBy: USER_ID,
      format: 'markdown',
      content: sourceMarkdown,
    });

    expect(imported.blocks.length).toBeGreaterThanOrEqual(14);
    const rootPage = imported.blocks.find((b) => b.id === imported.rootBlockId);
    expect(rootPage).toBeDefined();
    expect(rootPage?.type).toBe('page');
    expect(rootPage?.properties.title).toEqual([
      ['Votion Phase 9 Engineering Spec'],
    ]);

    // Export the imported block tree back to Markdown
    const exportedMarkdown = serializeBlocksToMarkdown(
      imported.rootBlockId,
      imported.blocks,
    );

    expect(exportedMarkdown).toBe(sourceMarkdown);

    // Re-importing the exported Markdown with the same importId produces identical blocks
    const reimported = await importWorker.process({
      importId: 'roundtrip-spec-01',
      spaceId: SPACE_ID,
      parentId: PARENT_SPACE_ID,
      parentTable: 'space',
      createdBy: USER_ID,
      format: 'markdown',
      content: exportedMarkdown,
    });

    expect(reimported.rootBlockId).toBe(imported.rootBlockId);
    expect(reimported.blocks.map((b) => ({ id: b.id, type: b.type, properties: b.properties }))).toEqual(
      imported.blocks.map((b) => ({ id: b.id, type: b.type, properties: b.properties })),
    );
  });

  it('imports HTML and CSV files into Notion block trees and exports Markdown + CSV zip and PDF bundles', async () => {
    const importWorker = new ImportWorker();

    const htmlResult = await importWorker.process({
      importId: 'html-import-01',
      spaceId: SPACE_ID,
      parentId: PARENT_SPACE_ID,
      createdBy: USER_ID,
      format: 'html',
      content: `<!DOCTYPE html>
<html>
  <head><title>Imported HTML Page</title></head>
  <body>
    <h1>Imported HTML Page</h1>
    <p>Paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
    <ul>
      <li>First item</li>
      <li>Second item</li>
    </ul>
    <pre><code class="language-javascript">console.log("hello");</code></pre>
  </body>
</html>`,
    });

    expect(htmlResult.blocks[0]?.type).toBe('page');
    expect(htmlResult.blocks.some((b) => b.type === 'bulleted_list_item')).toBe(true);
    expect(htmlResult.blocks.some((b) => b.type === 'code')).toBe(true);

    const csvInput = 'Task Name,Owner,Status\n"Build Queues, Workers",Nexuss,Done\nWrite Tests,Nexuss,In Progress\n';
    const csvResult = await importWorker.process({
      importId: 'csv-import-01',
      spaceId: SPACE_ID,
      parentId: PARENT_SPACE_ID,
      createdBy: USER_ID,
      format: 'csv',
      title: 'Sprint Backlog',
      content: csvInput,
    });

    expect(csvResult.collection).toBeDefined();
    expect(csvResult.blocks).toHaveLength(3); // 1 collection_view + 2 row pages

    const exportedCsv = serializeCollectionToCsv(
      csvResult.collection!,
      csvResult.blocks,
    );
    expect(exportedCsv).toBe(csvInput);

    // Package Markdown + CSV into a .zip archive and upload to S3/R2 storage
    const storage = new InMemoryObjectStorage({
      bucket: 'votion-exports',
      publicBaseUrl: 'https://exports.votion.dev',
    });
    const exportWorker = new ExportWorker({ storage });

    const zipResult = await exportWorker.process({
      exportId: 'exp-zip-001',
      spaceId: SPACE_ID,
      rootPageId: htmlResult.rootBlockId,
      requestedBy: USER_ID,
      format: 'markdown-csv-zip',
      blocks: [...htmlResult.blocks, ...csvResult.blocks],
      collections: [csvResult.collection!],
      expiresInSeconds: 1800,
    });

    expect(zipResult.format).toBe('markdown-csv-zip');
    expect(zipResult.downloadUrl).toContain('https://exports.votion.dev/');
    expect(zipResult.downloadUrl).toContain('X-Amz-Expires=1800');
    expect(zipResult.filePaths).toContain('Imported-HTML-Page.md');
    expect(zipResult.filePaths).toContain('databases/Sprint-Backlog.csv');

    const zipBytes = await storage.getObject(zipResult.objectKey);
    expect(zipBytes).not.toBeNull();
    // Verify PK\x03\x04 ZIP header signature
    expect(zipBytes![0]).toBe(0x50);
    expect(zipBytes![1]).toBe(0x4b);
    expect(zipBytes![2]).toBe(0x03);
    expect(zipBytes![3]).toBe(0x04);

    // Verify PDF export generation & upload
    const pdfResult = await exportWorker.process({
      exportId: 'exp-pdf-001',
      spaceId: SPACE_ID,
      rootPageId: htmlResult.rootBlockId,
      requestedBy: USER_ID,
      format: 'pdf',
      blocks: htmlResult.blocks,
    });

    expect(pdfResult.format).toBe('pdf');
    const pdfBytes = await storage.getObject(pdfResult.objectKey);
    expect(pdfBytes).not.toBeNull();
    expect(pdfBytes!.subarray(0, 8).toString('utf8')).toBe('%PDF-1.4');
  });
});
