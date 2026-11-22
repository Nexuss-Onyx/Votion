import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Block } from '@votion/types';
import { createRecordStore, setRecordStore, resetRecordStore } from '@votion/sync-client';
import { BlockCanvas } from '../src/components/BlockCanvas.js';
import { TodoBlock } from '../src/blocks/TodoBlock.js';
import { createBlockEditor } from '../src/lib/editor.js';
import { installTestStore, uninstallTestStore } from '../src/lib/store.js';

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    space_id: 'space-1111-1111-1111-111111111111',
    type: 'to_do',
    version: 1,
    properties: {},
    format: {},
    content: [],
    parent_id: 'root-000000000000000000000000',
    parent_table: 'block',
    alive: true,
    created_time: 0,
    last_edited_time: 0,
    created_by_id: 'user-1',
    last_edited_by_id: 'user-1',
    ...overrides,
  };
}

describe('TodoBlock', () => {
  beforeEach(() => {
    installTestStore();
  });

  afterEach(() => {
    uninstallTestStore();
  });

  it('renders an unchecked checkbox by default', () => {
    const editor = createBlockEditor('space-1111-1111-1111-111111111111');
    const block = makeBlock({
      properties: { title: [['Buy milk']], checked: [['no']] },
    });
    render(<TodoBlock block={block} editor={editor} />);
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('Buy milk').closest('.todo-text')).not.toHaveClass(
      'is-checked',
    );
  });

  it('toggles checked state and applies strikethrough through the canvas', () => {
    const store = createRecordStore();
    setRecordStore(store);
    const root = makeBlock({
      id: 'root-todo-2',
      type: 'page',
      content: ['todo-1'],
    });
    const block = makeBlock({
      id: 'todo-1',
      parent_id: 'root-todo-2',
      properties: { title: [['Buy milk']], checked: [['no']] },
    });
    store.getState().setRecord('block', root);
    store.getState().setRecord('block', block);

    render(<BlockCanvas rootBlockId="root-todo-2" />);

    fireEvent.click(screen.getByRole('checkbox'));
    console.log('HTML2', document.body.innerHTML);

    expect(store.getState().blocks['todo-1']?.properties.checked).toEqual([
      ['yes'],
    ]);
    expect(screen.getByRole('checkbox')).toBeChecked();
    const textEl = screen.getByText('Buy milk');
    expect(textEl.closest('.todo-text')).toHaveClass('is-checked');
  });
});
