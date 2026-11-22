/**
 * Schema & property registry tests.
 */

import { describe, expect, it } from 'vitest';
import type { CollectionSchema } from '@votion/types';
import {
  createDefaultOptions,
  createProperty,
  datePattern,
  defaultPropertyValue,
  formatPropertyValue,
  getPropertyTypeDefinition,
  isPropertyValueEmpty,
  propertyValueToComparable,
  validatePropertyValue,
} from '../src/schema/PropertyRegistry.js';
import {
  addPropertyToSchema,
  buildAddPropertyTransaction,
  buildDeletePropertyTransaction,
  buildDuplicatePropertyTransaction,
  buildRenamePropertyTransaction,
  buildReorderPropertyTransaction,
  createDefaultSchema,
  deletePropertyFromSchema,
  duplicatePropertyInSchema,
  orderedProperties,
  renamePropertyInSchema,
  reorderPropertyInSchema,
  setPropertyHiddenInSchema,
  updatePropertyInSchema,
} from '../src/schema/SchemaManager.js';

const SPACE_ID = 'space-0000-0000-0000-000000000001';
const COLLECTION_ID = 'collection-0000-0000-0000-000000000001';

function baseSchema(): CollectionSchema {
  return {
    title: { name: 'Name', type: 'title' },
    amount: { name: 'Amount', type: 'number', number_format: 'number' },
    status: {
      name: 'Status',
      type: 'select',
      options: [
        { id: 'opt_1', value: 'Todo', color: 'gray' },
        { id: 'opt_2', value: 'Done', color: 'green' },
      ],
    },
    due: { name: 'Due', type: 'date', date_format: 'year_month_day' },
    done: { name: 'Done', type: 'checkbox' },
  };
}

describe('PropertyRegistry', () => {
  it('creates properties with type-appropriate defaults', () => {
    const number = createProperty('number', 'Price', { number_format: 'dollar' });
    expect(number.number_format).toBe('dollar');
    const date = createProperty('date', 'Due');
    expect(date.date_format).toBe('month_day_year');
    const formula = createProperty('formula', 'Total');
    expect(formula.formula).toBe('');
    const status = createProperty('status', 'Status');
    expect(status.groups?.map((group) => group.name)).toEqual([
      'To-do',
      'In progress',
      'Complete',
    ]);
  });

  it('formats numbers across currency, percent and progress formats', () => {
    const price = createProperty('number', 'Price', { number_format: 'dollar' });
    expect(formatPropertyValue(12.5, price)).toBe('$12.50');
    const percent = createProperty('number', 'Rate', { number_format: 'percent' });
    expect(formatPropertyValue(0.25, percent)).toBe('25%');
    const progress = createProperty('number', 'Progress', { number_format: 'progress' });
    expect(formatPropertyValue(0.5, progress)).toBe('50%');
  });

  it('formats dates with date-fns patterns', () => {
    const due = createProperty('date', 'Due', { date_format: 'year_month_day' });
    expect(datePattern('year_month_day')).toBe('yyyy-MM-dd');
    expect(formatPropertyValue('2026-01-15', due)).toBe('2026-01-15');
  });

  it('formats and validates select options', () => {
    const status = baseSchema().status!;
    expect(formatPropertyValue('opt_1', status)).toBe('Todo');
    expect(validatePropertyValue('opt_2', status)).toBeNull();
    expect(validatePropertyValue('Missing', status)).toContain('Unknown option');
    expect(propertyValueToComparable('opt_2', status)).toBe(1);
  });

  it('validates primitive types', () => {
    const email = createProperty('email', 'Email');
    expect(validatePropertyValue('user@example.com', email)).toBeNull();
    expect(validatePropertyValue('not-an-email', email)).toContain('Invalid email');
    const url = createProperty('url', 'URL');
    expect(validatePropertyValue('https://votion.app', url)).toBeNull();
    expect(validatePropertyValue('votion.app', url)).toContain('Expected an http(s) URL');
    const number = createProperty('number', 'Amount');
    expect(validatePropertyValue(10, number)).toBeNull();
    expect(validatePropertyValue('abc', number)).toContain('Expected a number');
  });

  it('reports empty values and defaults', () => {
    expect(isPropertyValueEmpty(null)).toBe(true);
    expect(isPropertyValueEmpty('')).toBe(true);
    expect(isPropertyValueEmpty([])).toBe(true);
    expect(isPropertyValueEmpty(false)).toBe(false);
    expect(defaultPropertyValue('number')).toBeNull();
    expect(defaultPropertyValue('checkbox')).toBe(false);
    expect(defaultPropertyValue('multi_select')).toEqual([]);
  });

  it('exposes every property type and icons', () => {
    const types = [
      'title',
      'text',
      'number',
      'select',
      'multi_select',
      'status',
      'date',
      'person',
      'file',
      'checkbox',
      'url',
      'email',
      'phone_number',
      'formula',
      'relation',
      'rollup',
      'created_time',
      'created_by',
      'last_edited_time',
      'last_edited_by',
      'unique_id',
    ] as const;
    for (const type of types) {
      expect(getPropertyTypeDefinition(type).type).toBe(type);
    }
  });

  it('creates default colored options', () => {
    const options = createDefaultOptions(3);
    expect(options).toHaveLength(3);
    expect(options[0]?.value).toBe('Option 1');
    expect(new Set(options.map((option) => option.id)).size).toBe(3);
  });
});

describe('SchemaManager', () => {
  it('adds, renames, updates and deletes properties', () => {
    let schema = baseSchema();
    schema = addPropertyToSchema(schema, 'notes', { name: 'Notes', type: 'text' });
    expect(schema.notes?.name).toBe('Notes');
    schema = renamePropertyInSchema(schema, 'notes', 'Description');
    expect(schema.notes?.name).toBe('Description');
    schema = updatePropertyInSchema(schema, 'notes', { hidden: true });
    expect(schema.notes?.hidden).toBe(true);
    schema = setPropertyHiddenInSchema(schema, 'notes', false);
    expect(schema.notes?.hidden).toBe(false);
    schema = deletePropertyFromSchema(schema, 'notes');
    expect(schema.notes).toBeUndefined();
  });

  it('reorders properties and duplicates them', () => {
    let schema = baseSchema();
    schema = reorderPropertyInSchema(schema, 'done', null);
    expect(Object.keys(schema)[0]).toBe('done');
    schema = reorderPropertyInSchema(schema, 'done', 'title');
    expect(Object.keys(schema).slice(0, 3)).toEqual(['title', 'done', 'amount']);

    const result = duplicatePropertyInSchema(schema, 'status', 'status_copy');
    expect(result.schema.status_copy?.name).toBe('Status (copy)');
    expect(result.schema.status_copy?.options).toEqual(schema.status?.options);
  });

  it('filters hidden properties from the ordered view', () => {
    let schema = baseSchema();
    schema = setPropertyHiddenInSchema(schema, 'done', true);
    expect(orderedProperties(schema).map(([id]) => id)).not.toContain('done');
    expect(orderedProperties(schema, { includeHidden: true }).map(([id]) => id)).toContain('done');
  });

  it('builds transactions for every schema mutation', () => {
    const target = { spaceId: SPACE_ID, collectionId: COLLECTION_ID };
    const schema = baseSchema();

    const add = buildAddPropertyTransaction(target, 'notes', {
      name: 'Notes',
      type: 'text',
    });
    expect(add.operations[0]).toMatchObject({
      command: 'keyedObjectSet',
      pointer: { table: 'collection', id: COLLECTION_ID, spaceId: SPACE_ID },
      path: ['schema'],
      args: { key: 'notes' },
    });

    const rename = buildRenamePropertyTransaction(target, 'notes', 'Description');
    expect(rename.operations[0]).toMatchObject({
      command: 'keyedObjectSet',
      path: ['schema', 'notes'],
      args: { key: 'name', value: 'Description' },
    });

    const remove = buildDeletePropertyTransaction(target, schema, 'done');
    expect(remove.operations[0]).toMatchObject({ command: 'set', path: ['schema'] });
    expect(
      (remove.operations[0]?.args as CollectionSchema).done,
    ).toBeUndefined();

    const reorder = buildReorderPropertyTransaction(target, schema, 'done', null);
    expect(reorder.operations[0]).toMatchObject({ command: 'set', path: ['schema'] });
    expect(Object.keys(reorder.operations[0]?.args as CollectionSchema)[0]).toBe('done');

    const duplicate = buildDuplicatePropertyTransaction(target, schema, 'status', 'status_copy');
    expect(duplicate.transaction.operations[0]).toMatchObject({
      command: 'keyedObjectSet',
      path: ['schema'],
      args: { key: 'status_copy' },
    });
  });

  it('creates a default schema with a title property', () => {
    const { schema, titlePropertyId } = createDefaultSchema('Task Name');
    expect(schema[titlePropertyId]?.type).toBe('title');
    expect(schema[titlePropertyId]?.name).toBe('Task Name');
  });
});
