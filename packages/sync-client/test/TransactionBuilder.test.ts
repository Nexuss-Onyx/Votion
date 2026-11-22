/**
 * TransactionBuilder: operation shapes, atomicity and serialisability.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { isTransaction, type Transaction } from '@votion/types';

import {
  TransactionBuilder,
  createSpaceTransactionBuilder,
  createTransactionBuilder,
  generateUUID,
} from '../src/index.js';
import { PAGE_ID, SPACE_ID, id, makeTextBlock, richText } from './factories.js';

const target = { spaceId: SPACE_ID, table: 'block' as const, id: PAGE_ID };

describe('TransactionBuilder — operation generation', () => {
  it('builds a `set` operation with the exact wire shape', () => {
    const transaction = new TransactionBuilder(target)
      .set(['properties', 'title'], richText('Updated Document Title'))
      .build();

    expect(transaction.operations).toEqual([
      {
        pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
        path: ['properties', 'title'],
        command: 'set',
        args: [['Updated Document Title']],
      },
    ]);
    expect(transaction.spaceId).toBe(SPACE_ID);
    expect(transaction.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(typeof transaction.createdAt).toBe('number');
  });

  it('builds `update` operations that merge instead of replacing', () => {
    const transaction = new TransactionBuilder(target)
      .update(['properties'], { checked: [['yes']] })
      .build();

    expect(transaction.operations[0]).toEqual({
      pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
      path: ['properties'],
      command: 'update',
      args: { checked: [['yes']] },
    });
  });

  it('builds listAfter / listBefore / listRemove with target + new id', () => {
    const transaction = new TransactionBuilder(target)
      .listAfter(['content'], id(1), id(2))
      .listBefore(['content'], id(3), id(4))
      .listRemove(['content'], id(5))
      .build();

    expect(transaction.operations).toEqual([
      {
        pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
        path: ['content'],
        command: 'listAfter',
        args: { id: id(2), after: id(1) },
      },
      {
        pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
        path: ['content'],
        command: 'listBefore',
        args: { id: id(4), before: id(3) },
      },
      {
        pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
        path: ['content'],
        command: 'listRemove',
        args: { id: id(5) },
      },
    ]);
  });

  it('supports null anchors for prepend/append', () => {
    const transaction = new TransactionBuilder(target)
      .listAfter(['content'], null, 'first')
      .listBefore(['content'], null, 'last')
      .build();

    expect(transaction.operations[0]).toMatchObject({
      command: 'listAfter',
      args: { id: 'first', after: null },
    });
    expect(transaction.operations[1]).toMatchObject({
      command: 'listBefore',
      args: { id: 'last', before: null },
    });
  });

  it('builds keyedObjectSet for single map entries', () => {
    const transaction = new TransactionBuilder(target)
      .keyedObjectSet(['properties'], 'language', [['typescript']])
      .build();

    expect(transaction.operations[0]).toMatchObject({
      command: 'keyedObjectSet',
      args: { key: 'language', value: [['typescript']] },
    });
  });

  it('preserves operation order (server replays left-to-right)', () => {
    const transaction = new TransactionBuilder(target)
      .listRemove(['content'], 'a')
      .listAfter(['content'], 'b', 'a')
      .set(['version'], 2)
      .build();

    expect(
      transaction.operations.map((operation) => operation.command),
    ).toEqual(['listRemove', 'listAfter', 'set']);
  });

  it('addresses other records via per-call targets', () => {
    const childId = id(77);
    const transaction = new TransactionBuilder(target)
      .set(['alive'], false, { id: childId })
      .set(['alive'], true)
      .build();

    expect(transaction.operations[0]?.pointer.id).toBe(childId);
    expect(transaction.operations[1]?.pointer.id).toBe(PAGE_ID);
  });

  it('supports builders without a default record (space-scoped batches)', () => {
    const builder = createSpaceTransactionBuilder({ spaceId: SPACE_ID });
    builder.set(['properties', 'title'], [['A']], {
      table: 'block',
      id: PAGE_ID,
    });
    builder.set(['name'], 'Renamed', { table: 'collection', id: id(100) });
    const transaction = builder.build();

    expect(transaction.operations).toHaveLength(2);
    expect(transaction.operations[1]?.pointer.table).toBe('collection');
  });

  it('throws when an operation has no target record', () => {
    const builder = new TransactionBuilder({ spaceId: SPACE_ID });
    expect(() => builder.set(['alive'], false)).toThrow(
      /missing a target record id/,
    );
  });

  it('throws when no space id is provided', () => {
    expect(() => new TransactionBuilder({} as never)).toThrow(
      /requires a spaceId/,
    );
  });

  it('retargets the builder between operations', () => {
    const builder = new TransactionBuilder(target);
    builder
      .set(['alive'], false)
      .target({ id: id(88), table: 'collection' })
      .set(['name'], 'X');
    const transaction = builder.build();
    expect(transaction.operations[0]?.pointer.table).toBe('block');
    expect(transaction.operations[1]?.pointer.table).toBe('collection');
  });
});

describe('TransactionBuilder — atomicity & bookkeeping', () => {
  it('reports size / isEmpty', () => {
    const builder = new TransactionBuilder(target);
    expect(builder.isEmpty).toBe(true);
    expect(builder.size).toBe(0);
    builder.set(['alive'], false);
    expect(builder.size).toBe(1);
    expect(builder.isEmpty).toBe(false);
  });

  it('refuses to build an empty transaction', () => {
    expect(() => new TransactionBuilder(target).build()).toThrow(
      /no operations/,
    );
    expect(new TransactionBuilder(target).tryBuild()).toBeUndefined();
  });

  it('uses the supplied transaction id and timestamp', () => {
    const transaction = new TransactionBuilder(target, {
      transactionId: 'tx-fixed',
      createdAt: 1234,
      requestId: 'req-1',
    })
      .set(['alive'], false)
      .build();

    expect(transaction.id).toBe('tx-fixed');
    expect(transaction.createdAt).toBe(1234);
    expect(transaction.requestId).toBe('req-1');
  });

  it('generates a unique id per transaction', () => {
    const ids = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      ids.add(new TransactionBuilder(target).set(['alive'], true).build().id);
    }
    expect(ids.size).toBe(50);
  });

  it('build() is repeatable and returns independent copies', () => {
    const builder = new TransactionBuilder(target).set(['properties'], {
      title: [['A']],
    });
    const first = builder.build();
    const second = builder.build();

    expect(first.operations).toEqual(second.operations);
    expect(first.operations[0]).not.toBe(second.operations[0]);
    // Mutating the built copy cannot corrupt the builder.
    (first.operations[0] as { args: unknown }).args = 'tampered';
    expect(builder.toOperations()[0]?.args).toEqual({ title: [['A']] });
  });

  it('clone() reuses operations under a fresh id', () => {
    const builder = new TransactionBuilder(target).set(['alive'], false);
    const original = builder.build();
    const copy = builder.clone();

    expect(copy.id).not.toBe(original.id);
    expect(copy.operations).toEqual(original.operations);
  });

  it('accepts pre-built operations via push()', () => {
    const transaction = new TransactionBuilder(target)
      .push({
        pointer: { table: 'block', id: PAGE_ID, spaceId: SPACE_ID },
        path: ['alive'],
        command: 'set',
        args: false,
      })
      .build();
    expect(transaction.operations).toHaveLength(1);
  });

  it('accepts an optional requestId only when supplied', () => {
    const withoutRequest = new TransactionBuilder(target)
      .set(['alive'], true)
      .build();
    expect('requestId' in withoutRequest).toBe(false);

    const withRequest = new TransactionBuilder(target, { requestId: 'req-9' })
      .set(['alive'], true)
      .build();
    expect(withRequest.requestId).toBe('req-9');
  });

  it('createTransactionBuilder factory matches the constructor', () => {
    const transaction = createTransactionBuilder(target)
      .set(['alive'], false)
      .build();
    expect(transaction.spaceId).toBe(SPACE_ID);
  });
});

describe('TransactionBuilder — serialisability', () => {
  it('produces a payload that survives JSON round-tripping unchanged', () => {
    const block = makeTextBlock();
    const transaction = new TransactionBuilder({
      spaceId: SPACE_ID,
      table: 'block',
      id: block.id,
    })
      .set(['properties', 'title'], richText('Round trip'))
      .update(['format'], { block_color: 'blue', block_width: 50 })
      .listAfter(['content'], null, id(3))
      .build();

    const roundTripped = JSON.parse(JSON.stringify(transaction)) as Transaction;
    expect(roundTripped).toEqual(transaction);
  });

  it('marks generated transactions as valid per the shared contract guard', () => {
    const transaction = new TransactionBuilder(target)
      .set(['alive'], false)
      .build();
    expect(isTransaction(transaction)).toBe(true);
    expect(isTransaction({ id: 1 })).toBe(false);
  });

  it('generated UUIDs are v4-shaped and unique', () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expectTypeOf(uuid).toEqualTypeOf<string>();
  });

  it('does not alias caller-owned args objects', () => {
    const args = { title: [['Aliased']] };
    const transaction = new TransactionBuilder(target)
      .set(['properties'], args)
      .build();
    (args.title as unknown) = 'mutated';
    expect(transaction.operations[0]?.args).toEqual({ title: [['Aliased']] });
  });
});
