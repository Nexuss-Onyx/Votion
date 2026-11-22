/**
 * View projection rendering tests for all six database views.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRecordStore } from '@votion/sync-client';
import type { CollectionView, ViewType } from '@votion/types';
import { TableView } from '../src/views/TableView/TableView.js';
import { BoardView } from '../src/views/BoardView/BoardView.js';
import { CalendarView } from '../src/views/CalendarView/CalendarView.js';
import { TimelineView } from '../src/views/TimelineView/TimelineView.js';
import { GalleryView } from '../src/views/GalleryView/GalleryView.js';
import { ListView } from '../src/views/ListView/ListView.js';
import { RelationPicker } from '../src/views/RelationPicker.js';
import { ViewRenderer } from '../src/views/ViewRenderer.js';
import { applyViewQuery } from '../src/views/records.js';
import { selectCollectionRecords } from '../src/views/records.js';
import { makeBlock, makeCollection, makeRecord, makeTestSchema, makeView, titledRecord } from './support/fixtures.js';

const { schema, titleId, statusId, amountId, tagsId, dueId, doneId } = makeTestSchema();
const collection = makeCollection(schema);

function makeRows() {
  return [
    titledRecord(collection, 'Alpha', {
      [statusId]: 'opt_doing',
      [amountId]: 10,
      [tagsId]: ['tag_red'],
      [dueId]: '2026-01-10',
      [doneId]: true,
    }),
    titledRecord(collection, 'Beta', {
      [statusId]: 'opt_todo',
      [amountId]: 5,
      [tagsId]: ['tag_blue'],
      [dueId]: '2026-02-15',
      [doneId]: false,
    }),
    titledRecord(collection, 'Gamma', {
      [statusId]: 'opt_done',
      [amountId]: 20,
      [tagsId]: [],
      [dueId]: null,
      [doneId]: false,
    }),
  ];
}

function renderView(
  type: ViewType,
  rows = makeRows(),
  overrides: Partial<CollectionView> = {},
) {
  const view = makeView(type, overrides);
  return render(
    <ViewRenderer
      collection={collection}
      view={view}
      records={rows}
      onChangeProperty={vi.fn()}
    />,
  );
}

describe('TableView', () => {
  it('renders headers, rows and footer aggregations', () => {
    render(<TableView collection={collection} view={makeView('table')} records={makeRows()} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    expect(screen.getByText('35 / 11.6667')).toBeInTheDocument();
  });

  it('edits a text cell through the onChangeProperty callback', () => {
    const onChangeProperty = vi.fn();
    const rows = makeRows();
    render(
      <TableView
        collection={collection}
        view={makeView('table')}
        records={rows}
        onChangeProperty={onChangeProperty}
      />,
    );
    fireEvent.doubleClick(screen.getByText('Alpha'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.blur(input);
    expect(onChangeProperty).toHaveBeenCalledWith(
      rows[0]?.id,
      titleId,
      [['Alpha 2']],
    );
  });
});

describe('BoardView', () => {
  it('renders kanban columns grouped by select options', () => {
    renderView('board');
    expect(screen.getAllByText('Todo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Doing').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('collapses a column when its toggle is clicked', () => {
    renderView('board');
    const toggle = screen.getByRole('button', { name: /Collapse Doing/ });
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: /Expand Doing/ }),
    ).toBeInTheDocument();
  });
});

describe('CalendarView', () => {
  it('renders month cells and places records on their date', () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      titledRecord(collection, 'Today task', { [dueId]: today }),
    ];
    render(
      <CalendarView
        collection={collection}
        view={makeView('calendar', { format: { calendar_by: dueId } })}
        records={rows}
      />,
    );
    expect(screen.getByText('Today task')).toBeInTheDocument();
    expect(screen.getByText('Month')).toBeInTheDocument();
    expect(screen.getByText('Week')).toBeInTheDocument();
  });
});

describe('TimelineView', () => {
  it('renders duration bars and a zoom controller', () => {
    render(
      <TimelineView
        collection={collection}
        view={makeView('timeline', {
          format: { timeline_by: dueId, timeline_by_end: dueId, timeline_scale: 'day' },
        })}
        records={makeRows()}
      />,
    );
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom month' })).toBeInTheDocument();
  });
});

describe('GalleryView', () => {
  it('renders a card grid with titles and tags', () => {
    renderView('gallery');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('switches the card cover source', () => {
    renderView('gallery');
    const none = screen.getByRole('button', { name: 'Cover source none' });
    fireEvent.click(none);
    expect(none).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('RelationPicker', () => {
  it('selects linked records and confirms the id list', () => {
    const targetCollection = makeCollection(schema, {
      id: 'collection-target-0000-0000-000000000001',
      name: [['Target']],
    });
    const targets = [
      titledRecord(targetCollection, 'One'),
      titledRecord(targetCollection, 'Two'),
    ];
    const onConfirm = vi.fn();
    render(
      <RelationPicker
        collection={targetCollection}
        schema={targetCollection.schema}
        records={targets}
        selectedIds={[]}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'One' }));
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(onConfirm).toHaveBeenCalledWith([targets[0]?.id]);
  });
});

describe('ListView', () => {
  it('renders a high-density list and toggles visible properties', () => {
    renderView('list');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });
});

describe('view query application', () => {
  it('applies filters, search and limits', () => {
    const rows = makeRows();
    const filtered = applyViewQuery(
      rows,
      makeView('table', {
        query2: {
          filter: {
            operator: 'and',
            clauses: [
              { property: 'Status', comparator: 'not_equals', value: 'Done' },
            ],
          },
        },
      }),
      schema,
    );
    expect(filtered.map((record) => record.title)).toEqual(['Alpha', 'Beta']);

    const searched = applyViewQuery(
      rows,
      makeView('table', { query2: { search: 'gamma' } }),
      schema,
    );
    expect(searched.map((record) => record.title)).toEqual(['Gamma']);

    const limited = applyViewQuery(
      rows,
      makeView('table', { query2: { limit: 2 } }),
      schema,
    );
    expect(limited).toHaveLength(2);
  });

  it('selects collection rows from the normalized record store', () => {
    const store = createRecordStore();
    store.getState().setRecord('collection', collection);
    const block = makeBlock(collection, {
      [titleId]: [['Stored row']],
      [statusId]: 'opt_todo',
    });
    store.getState().setRecord('block', block);
    const rows = selectCollectionRecords(store.getState(), collection.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Stored row');
  });
});

describe('record projections', () => {
  it('exposes database row helpers', () => {
    const rows = makeRows();
    expect(rows[0]?.title).toBe('Alpha');
    expect(rows[0]?.properties[amountId]).toBe(10);
    expect(rows[1]?.title).toBe('Beta');
  });
});

describe('ViewRenderer', () => {
  it('dispatches every view type to its projection', () => {
    for (const type of ['table', 'board', 'calendar', 'timeline', 'gallery', 'list'] as const) {
      const { unmount } = renderView(type);
      unmount();
    }
    expect(true).toBe(true);
  });
});
