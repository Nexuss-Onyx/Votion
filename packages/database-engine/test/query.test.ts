/**
 * Query engine tests: recursive filters, multi-level sorts, grouping,
 * aggregations and sub-items.
 */

import { describe, expect, it } from 'vitest';
import type { FilterGroup } from '@votion/types';
import {
  FilterEvaluationError,
  evaluateFilter,
  filterRecords,
} from '../src/query/FilterEvaluator.js';
import {
  compareRecords,
  sortRecords,
  toggleSortDirection,
} from '../src/query/SortEngine.js';
import {
  dateGroupKey,
  groupCounts,
  groupKeyToDate,
  groupRecords,
} from '../src/query/GroupingEngine.js';
import {
  aggregateRecords,
  computeAggregation,
  computeFooterValue,
  computeFooters,
} from '../src/query/Aggregations.js';
import {
  buildSubItemTree,
  flattenSubItems,
  getSubItemIds,
} from '../src/query/SubItemEngine.js';
import { makeCollection, makeRecord, makeTestSchema, titledRecord } from './support/fixtures.js';

const { schema, titleId, statusId, amountId, tagsId, dueId, doneId } = makeTestSchema();
const collection = makeCollection(schema);

function records() {
  return [
    makeRecord(collection, {
      [titleId]: [['Alpha']],
      [statusId]: 'opt_doing',
      [amountId]: 10,
      [tagsId]: ['tag_red'],
      [dueId]: '2026-01-10',
      [doneId]: true,
    }),
    makeRecord(collection, {
      [titleId]: [['Beta']],
      [statusId]: 'opt_todo',
      [amountId]: 5,
      [tagsId]: ['tag_blue'],
      [dueId]: '2026-02-15',
      [doneId]: false,
    }),
    makeRecord(collection, {
      [titleId]: [['Gamma']],
      [statusId]: 'opt_done',
      [amountId]: 20,
      [tagsId]: [],
      [dueId]: null,
      [doneId]: false,
    }),
  ];
}

describe('FilterEvaluator', () => {
  const rows = records();
  const alpha = rows[0]!;
  const beta = rows[1]!;
  const gamma = rows[2]!;

  it('evaluates type-specific leaf comparators', () => {
    expect(
      evaluateFilter({ property: 'Status', comparator: 'equals', value: 'Doing' }, alpha, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Status', comparator: 'not_equals', value: 'Todo' }, alpha, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Tags', comparator: 'contains', value: 'red' }, alpha, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Tags', comparator: 'does_not_contain', value: 'red' }, beta, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Name', comparator: 'starts_with', value: 'Al' }, alpha, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Name', comparator: 'ends_with', value: 'ta' }, beta, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Due', comparator: 'is_empty', value: null }, gamma, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Done', comparator: 'is_checked', value: null }, alpha, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Done', comparator: 'is_not_checked', value: null }, beta, schema),
    ).toBe(true);
  });

  it('compares numbers and dates', () => {
    expect(
      evaluateFilter({ property: 'Amount', comparator: 'greater_than', value: 8 }, alpha, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Amount', comparator: 'less_than_or_equal', value: 5 }, beta, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Due', comparator: 'before', value: '2026-02-01' }, alpha, schema),
    ).toBe(true);
    expect(
      evaluateFilter({ property: 'Due', comparator: 'after', value: '2026-02-01' }, beta, schema),
    ).toBe(true);
  });

  it('evaluates nested AND / OR trees recursively', () => {
    const filter: FilterGroup = {
      operator: 'and',
      clauses: [
        { property: 'Status', comparator: 'not_equals', value: 'Done' },
        {
          operator: 'or',
          clauses: [
            { property: 'Amount', comparator: 'greater_than', value: 8 },
            { property: 'Tags', comparator: 'contains', value: 'blue' },
          ],
        },
      ],
    };
    const matches = filterRecords(rows, filter, schema);
    expect(matches.map((record) => record.id).sort()).toEqual(
      [alpha.id, beta.id].sort(),
    );
  });

  it('supports is_within and is_relative_to_today', () => {
    expect(
      evaluateFilter(
        {
          property: 'Due',
          comparator: 'is_within',
          value: { start: '2026-01-01', end: '2026-01-31' },
        },
        alpha,
        schema,
      ),
    ).toBe(true);
    const now = new Date('2026-01-12T12:00:00Z');
    expect(
      evaluateFilter(
        { property: 'Due', comparator: 'is_relative_to_today', value: 'past_week' },
        alpha,
        schema,
        { now },
      ),
    ).toBe(true);
    expect(
      evaluateFilter(
        { property: 'Due', comparator: 'is_relative_to_today', value: 'past_week' },
        beta,
        schema,
        { now },
      ),
    ).toBe(false);
  });

  it('treats an empty filter as a match-all', () => {
    expect(evaluateFilter(undefined, alpha, schema)).toBe(true);
  });

  it('rejects unsupported comparators', () => {
    expect(() =>
      evaluateFilter(
        { property: 'Name', comparator: 'explodes' as never, value: 'x' },
        alpha,
        schema,
      ),
    ).toThrow(FilterEvaluationError);
  });
});

describe('SortEngine', () => {
  const rows = records();
  const alpha = rows[0]!;
  const beta = rows[1]!;
  const gamma = rows[2]!;

  it('sorts select values by their declared option order', () => {
    const sorted = sortRecords(rows, [
      { property: 'Status', direction: 'ascending' },
    ], schema);
    expect(sorted.map((record) => record.id)).toEqual([beta.id, alpha.id, gamma.id]);
  });

  it('supports multi-level ascending/descending sorts', () => {
    const extra = titledRecord(collection, 'Delta', {
      [statusId]: 'opt_todo',
      [amountId]: 7,
    });
    const all = [...rows, extra];
    const sorted = sortRecords(
      all,
      [
        { property: 'Status', direction: 'ascending' },
        { property: 'Amount', direction: 'descending' },
      ],
      schema,
    );
    expect(sorted.map((record) => record.title)).toEqual([
      'Delta',
      'Beta',
      'Alpha',
      'Gamma',
    ]);
  });

  it('always sinks empty values to the end', () => {
    const sorted = sortRecords(rows, [
      { property: 'Due', direction: 'ascending' },
    ], schema);
    expect(sorted[sorted.length - 1]?.id).toBe(gamma.id);

    const descending = sortRecords(rows, [
      { property: 'Due', direction: 'descending' },
    ], schema);
    expect(descending[descending.length - 1]?.id).toBe(gamma.id);
  });

  it('compares records for a single clause and toggles direction', () => {
    expect(
      compareRecords(alpha, beta, { property: 'Amount', direction: 'ascending' }, schema),
    ).toBeGreaterThan(0);
    expect(toggleSortDirection('ascending')).toBe('descending');
    expect(toggleSortDirection('descending')).toBe('ascending');
  });
});

describe('GroupingEngine', () => {
  const rows = records();

  it('groups select values in option order with counts', () => {
    const groups = groupRecords(rows, { property: 'Status', direction: 'ascending' }, schema);
    expect(groups.map((group) => group.label)).toEqual([
      'Todo',
      'Doing',
      'Done',
      'No value',
    ]);
    expect(groupCounts(groups)).toMatchObject({ opt_todo: 1, opt_doing: 1, opt_done: 1 });
  });

  it('groups dates by interval and resolves drop targets', () => {
    const groups = groupRecords(
      rows,
      { property: 'Due', direction: 'ascending', interval: 'month' },
      schema,
    );
    const labels = groups.map((group) => group.label);
    expect(labels).toContain('January 2026');
    expect(labels).toContain('February 2026');
    expect(labels).toContain('No date');

    const january = groups.find((group) => group.label === 'January 2026');
    expect(january?.startTimestamp).toBe(new Date('2026-01-01T00:00:00Z').getTime());
    expect(dateGroupKey('2026-01-10', 'month')).toBe(String(january?.startTimestamp));
    expect(groupKeyToDate(String(january?.startTimestamp), 'month')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('groups checkboxes and hides empty groups on request', () => {
    const groups = groupRecords(rows, { property: 'Done', direction: 'ascending' }, schema);
    expect(groups.map((group) => group.key)).toEqual(['checked', 'unchecked']);
    const hidden = groupRecords(
      [rows[0]!],
      { property: 'Done', direction: 'ascending', hide_empty_groups: true },
      schema,
    );
    expect(hidden.map((group) => group.key)).toEqual(['checked']);
  });
});

describe('Aggregations', () => {
  const rows = records();

  it('computes numeric aggregations', () => {
    const values = rows.map((record) => record.properties[amountId]);
    expect(computeAggregation(values, 'sum')).toBe(35);
    expect(computeAggregation(values, 'average')).toBeCloseTo(35 / 3);
    expect(computeAggregation(values, 'min')).toBe(5);
    expect(computeAggregation(values, 'max')).toBe(20);
    expect(computeAggregation(values, 'range')).toBe(15);
    expect(computeAggregation(values, 'median')).toBe(10);
    expect(computeAggregation(values, 'count')).toBe(3);
    expect(computeAggregation(values, 'count_values')).toBe(3);
    expect(computeAggregation([1, 1, 2], 'count_unique')).toBe(2);
  });

  it('computes footer values per property type', () => {
    const amount = schema[amountId];
    if (!amount) throw new Error('missing amount property');
    const footer = computeFooterValue(rows, amount, schema, amountId);
    expect(footer.label).toBe('Sum / Average');
    expect(footer.numeric).toBe(35);

    const checkbox = schema[doneId];
    if (!checkbox) throw new Error('missing checkbox property');
    const checked = computeFooterValue(rows, checkbox, schema, doneId);
    expect(checked.label).toBe('Percent checked');
    expect(checked.value).toBe('33%');
  });

  it('computes footers for many columns and aggregate clauses', () => {
    const footers = computeFooters(rows, schema, [amountId, doneId]);
    expect(footers[amountId]?.numeric).toBe(35);
    expect(footers[doneId]?.label).toBe('Percent checked');

    expect(
      aggregateRecords(rows, { property: amountId, aggregation: 'sum' }, schema),
    ).toBe(35);
  });
});

describe('SubItemEngine', () => {
  it('builds a cycle-safe parent/child tree', () => {
    const parent = titledRecord(collection, 'Parent');
    const childA = titledRecord(collection, 'Child A', { parent: parent.id });
    const childB = titledRecord(collection, 'Child B', { parent: parent.id });
    const grandchild = titledRecord(collection, 'Grandchild', { parent: childA.id });
    const root = titledRecord(collection, 'Root');

    const tree = buildSubItemTree([parent, childA, childB, grandchild, root], 'parent');
    expect(tree).toHaveLength(2);
    const parentNode = tree.find((node) => node.record.id === parent.id);
    expect(parentNode?.children.map((node) => node.record.title)).toEqual([
      'Child A',
      'Child B',
    ]);
    expect(parentNode?.children[0]?.children[0]?.record.title).toBe('Grandchild');
    expect(parentNode?.children[0]?.depth).toBe(1);
    expect(getSubItemIds([parent, childA, childB], 'parent', parent.id)).toEqual([
      childA.id,
      childB.id,
    ]);
    expect(flattenSubItems(tree).map((record) => record.title)).toEqual([
      'Parent',
      'Child A',
      'Grandchild',
      'Child B',
      'Root',
    ]);
  });

  it('ignores parent links that do not resolve', () => {
    const orphan = titledRecord(collection, 'Orphan', { parent: 'missing-id' });
    const tree = buildSubItemTree([orphan], 'parent');
    expect(tree).toHaveLength(1);
    expect(tree[0]?.record.id).toBe(orphan.id);
  });
});
