import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Block } from '@votion/types';
import {
  createRecordStore,
  setRecordStore,
  resetRecordStore,
} from '@votion/sync-client';
import { BlockCanvas } from '../src/components/BlockCanvas.js';
import { createBlockEditor } from '../src/lib/editor.js';
import { installTestStore, uninstallTestStore } from '../src/lib/store.js';

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    space_id: 'space-1111-1111-1111-111111111111',
    type: (overrides.type ?? 'text') as Block['type'],
    version: 1,
    properties: {},
    format: {},
    content: overrides.content ?? [],
    parent_id: overrides.parent_id ?? 'root-000000000000000000000000',
    parent_table: 'block',
    alive: true,
    created_time: 0,
    last_edited_time: 0,
    created_by_id: 'user-1',
    last_edited_by_id: 'user-1',
    ...overrides,
  };
}

describe('BlockCanvas', () => {
  beforeEach(() => {
    installTestStore();
  });

  afterEach(() => {
    uninstallTestStore();
  });

  it('renders child blocks from the root block content list', () => {
    const store = createRecordStore();
    setRecordStore(store);
    const root = makeBlock({ id: 'root-1', type: 'page', content: [] });
    const child = makeBlock({
      id: 'child-1',
      type: 'text',
      properties: { title: [['Hello canvas']] },
    });
    store.getState().setRecord('block', root);
    store.getState().setRecord('block', { ...root, content: ['child-1'] });
    store.getState().setRecord('block', child);

    render(<BlockCanvas rootBlockId="root-1" />);

    expect(screen.getByText('Hello canvas')).toBeInTheDocument();
  });

  it('renders nested children recursively inside a toggle block', () => {
    const store = createRecordStore();
    setRecordStore(store);
    const root = makeBlock({ id: 'root-2', type: 'page', content: [] });
    const toggle = makeBlock({
      id: 'toggle-1',
      type: 'toggle',
      content: [],
      properties: { title: [['Open me']] },
    });
    const nested = makeBlock({
      id: 'nested-1',
      type: 'text',
      properties: { title: [['I am nested']] },
    });
    store.getState().setRecord('block', root);
    store.getState().setRecord('block', { ...root, content: ['toggle-1'] });
    store.getState().setRecord('block', toggle);
    store.getState().setRecord('block', { ...toggle, content: ['nested-1'] });
    store.getState().setRecord('block', nested);

    render(<BlockCanvas rootBlockId="root-2" />);

    // Toggles start expanded.
    expect(screen.getByText('Open me')).toBeInTheDocument();
    expect(screen.queryByText('I am nested')).toBeInTheDocument();

    const toggleButton = screen.getByRole('button', { name: 'Collapse' });
    fireEvent.click(toggleButton);
    expect(screen.queryByText('I am nested')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('I am nested')).toBeInTheDocument();
  });

  it('inserts a new block via the slash menu and renders it', () => {
    const store = createRecordStore();
    setRecordStore(store);
    const root = makeBlock({ id: 'root-3', type: 'page', content: [] });
    const first = makeBlock({
      id: 'first-1',
      type: 'text',
      parent_id: 'root-3',
      properties: { title: [['First block']] },
    });
    store.getState().setRecord('block', root);
    store.getState().setRecord('block', { ...root, content: ['first-1'] });
    store.getState().setRecord('block', first);

    render(
      <BlockCanvas
        rootBlockId="root-3"
        spaceId="space-1111-1111-1111-1111-111111111111"
      />,
    );

    const insertButton = screen.getByRole('button', { name: /Insert block/ });
    fireEvent.click(insertButton);

    const search = screen.getByPlaceholderText(/insert/i);
    fireEvent.input(search, { target: { value: 'to' } });
    const todoOption = screen.getByRole('option', { name: /To-do list/ });
    fireEvent.click(todoOption);

    const blocks = store.getState().blocks;
    const newId = Object.keys(blocks).find(
      (id) => id !== 'root-3' && id !== 'first-1',
    );
    expect(newId).toBeDefined();
    const inserted = blocks[newId as string];
    expect(inserted?.type).toBe('to_do');
    expect(inserted?.parent_id).toBe('root-3');

    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('deletes selected blocks with backspace', () => {
    const store = createRecordStore();
    setRecordStore(store);
    const root = makeBlock({ id: 'root-4', type: 'page', content: [] });
    const child = makeBlock({
      id: 'child-4',
      type: 'text',
      properties: { title: [['To delete']] },
    });
    store.getState().setRecord('block', root);
    store.getState().setRecord('block', { ...root, content: ['child-4'] });
    store.getState().setRecord('block', child);

    render(<BlockCanvas rootBlockId="root-4" />);

    fireEvent.click(screen.getByText('To delete'));
    document.body.focus();
    fireEvent.keyDown(document, { key: 'Backspace' });

    expect(store.getState().blocks['child-4']).toBeUndefined();
    expect(screen.queryByText('To delete')).not.toBeInTheDocument();
  });

  it('exposes the block editor API for insertions', () => {
    const store = createRecordStore();
    setRecordStore(store);
    const root = makeBlock({ id: 'root-5', type: 'page', content: [] });
    store.getState().setRecord('block', root);

    const editor = createBlockEditor('space-1111-1111-1111-1111-111111111111');
    const id = editor.insertBlock('root-5', 'to_do', { title: 'Via API' });

    expect(store.getState().blocks[id]?.type).toBe('to_do');
    expect(store.getState().blocks[id]?.properties.title).toEqual([['Via API']]);
    expect(root.content).not.toContain(id);
    const updatedRoot = store.getState().blocks['root-5'];
    expect(updatedRoot?.content).toEqual([id]);
  });
});
