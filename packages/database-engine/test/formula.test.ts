/**
 * Formula 2.0 engine tests: lexer, parser, standard library and evaluator.
 */

import { describe, expect, it } from 'vitest';
import {
  FormulaDate,
  FormulaError,
  FormulaSyntaxError,
  createFormulaContext,
  evaluateAST,
  evaluateFormula,
  formatFormulaResult,
  formulaFunctionNames,
  parseFormula,
  tokenizeFormula,
} from '../src/formula/index.js';
import { TokenType } from '../src/formula/Lexer.js';
import { FORMULA_FUNCTIONS } from '../src/formula/StandardLibrary.js';
import { makeCollection, makeRecord, makeTestSchema } from './support/fixtures.js';

const { schema } = makeTestSchema();
const collection = makeCollection(schema);

function contextWith(
  properties: Record<string, unknown>,
  now?: Date,
  extraByName: Record<string, unknown> = {},
): ReturnType<typeof createFormulaContext> {
  // Map test-friendly keys (title, amount, due, ...) onto schema property ids.
  const lowerCased = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const mapped: Record<string, unknown> = {};
  for (const [propertyId, property] of Object.entries(schema)) {
    const value =
      lowerCased[property.name.toLowerCase()] ??
      (property.type === 'title' ? lowerCased.title : undefined) ??
      properties[propertyId];
    if (value !== undefined) {
      mapped[propertyId] = value;
    }
  }
  const record = makeRecord(collection, mapped);
  const context = createFormulaContext(record, schema, extraByName);
  if (now) {
    context.now = () => now;
  }
  return context;
}

describe('Formula Lexer', () => {
  it('tokenises numbers, identifiers, operators and prop references', () => {
    const tokens = tokenizeFormula('1 + prop("Name")');
    expect(tokens[0]).toMatchObject({ type: TokenType.Number, value: '1' });
    expect(tokens[1]).toMatchObject({ type: TokenType.Operator, value: '+' });
    expect(tokens[2]).toMatchObject({ type: TokenType.Prop, value: 'prop' });
    expect(tokens[3]).toMatchObject({ type: TokenType.LParen });
    expect(tokens[4]).toMatchObject({ type: TokenType.String, value: 'Name' });
    expect(tokens[5]).toMatchObject({ type: TokenType.RParen });
  });

  it('keeps string contents and handles escapes', () => {
    const tokens = tokenizeFormula('"a\\"b"');
    expect(tokens[0]).toMatchObject({ type: TokenType.String, value: 'a"b' });
  });

  it('rejects unknown characters with a position', () => {
    try {
      tokenizeFormula('1 # 2');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FormulaSyntaxError);
      expect((error as FormulaSyntaxError).position).toBe(2);
    }
  });

  it('rejects unterminated strings', () => {
    expect(() => tokenizeFormula('"oops')).toThrow(FormulaSyntaxError);
  });
});

describe('Formula Parser', () => {
  it('respects arithmetic precedence', () => {
    const ast = parseFormula('1 + 2 * 3');
    expect(ast.type).toBe('Binary');
    if (ast.type === 'Binary') {
      expect(ast.operator).toBe('+');
      expect(ast.right.type).toBe('Binary');
      if (ast.right.type === 'Binary') {
        expect(ast.right.operator).toBe('*');
      }
    }
    expect(evaluateFormula('1 + 2 * 3')).toBe(7);
  });

  it('honours parentheses and unary operators', () => {
    expect(evaluateFormula('(1 + 2) * 3')).toBe(9);
    expect(evaluateFormula('-2 + 5')).toBe(3);
    expect(evaluateFormula('+7')).toBe(7);
    expect(evaluateFormula('!(1 == 2)')).toBe(true);
  });

  it('parses and/or with short-circuit semantics', () => {
    expect(evaluateFormula('true and false')).toBe(false);
    expect(evaluateFormula('true or false')).toBe(true);
    expect(evaluateFormula('1 == 1 && 2 > 1')).toBe(true);
  });

  it('rejects unbalanced parentheses', () => {
    expect(() => parseFormula('(1 + 2')).toThrow(FormulaSyntaxError);
    expect(() => parseFormula('1 + 2)')).toThrow(FormulaSyntaxError);
  });
});

describe('Formula Evaluator: math', () => {
  it('evaluates arithmetic with runtime type checks', () => {
    expect(evaluateFormula('2 * 3 + 4 / 2')).toBe(8);
    expect(evaluateFormula('7 % 3')).toBe(1);
    expect(evaluateFormula('2 + "a"')).toBe('2a');
  });

  it('supports the math standard library', () => {
    expect(evaluateFormula('round(1.2345, 2)')).toBe(1.23);
    expect(evaluateFormula('ceil(1.1)')).toBe(2);
    expect(evaluateFormula('floor(1.9)')).toBe(1);
    expect(evaluateFormula('abs(-4)')).toBe(4);
    expect(evaluateFormula('min(3, 1, 2)')).toBe(1);
    expect(evaluateFormula('max([3, 1, 2])')).toBe(3);
    expect(evaluateFormula('pow(2, 5)')).toBe(32);
    expect(evaluateFormula('mod(7, 3)')).toBe(1);
    expect(evaluateFormula('sqrt(16)')).toBe(4);
  });

  it('throws on division by zero and unknown functions', () => {
    expect(() => evaluateFormula('1 / 0')).toThrow(FormulaError);
    expect(() => evaluateFormula('1 % 0')).toThrow(FormulaError);
    expect(() => evaluateFormula('nope(1)')).toThrow(FormulaError);
    expect(() => evaluateFormula('"a" - 1')).toThrow(FormulaError);
  });
});

describe('Formula Evaluator: strings', () => {
  const ctx = contextWith({
    title: [['Hello World']],
    tags: ['a', 'b'],
  });

  it('resolves prop("Name") against the schema', () => {
    expect(evaluateFormula('prop("Name")', ctx)).toBe('Hello World');
    expect(evaluateFormula('length(prop("Name"))', ctx)).toBe(11);
  });

  it('supports concat, join, slice and length', () => {
    expect(evaluateFormula('concat(prop("Name"), "!")', ctx)).toBe('Hello World!');
    expect(evaluateFormula('join("-", prop("Tags"))', ctx)).toBe('a-b');
    expect(evaluateFormula('slice(prop("Name"), 0, 5)', ctx)).toBe('Hello');
    expect(evaluateFormula('length(prop("Tags"))', ctx)).toBe(2);
  });

  it('supports replace, test, match and case helpers', () => {
    expect(evaluateFormula('replace(prop("Name"), "l", "L")', ctx)).toBe('HeLLo WorLd');
    expect(evaluateFormula('test(prop("Name"), "^Hello")', ctx)).toBe(true);
    expect(evaluateFormula('match(prop("Name"), "o")', ctx)).toEqual(['o']);
    expect(evaluateFormula('lower(prop("Name"))', ctx)).toBe('hello world');
    expect(evaluateFormula('upper(prop("Name"))', ctx)).toBe('HELLO WORLD');
    expect(evaluateFormula('trim("  x  ")', ctx)).toBe('x');
    expect(evaluateFormula('title("hello world")', ctx)).toBe('Hello World');
  });

  it('rejects invalid regular expressions', () => {
    expect(() => evaluateFormula('test("x", "[")')).toThrow(FormulaError);
  });
});

describe('Formula Evaluator: dates', () => {
  const now = new Date('2026-01-15T12:00:00Z');
  const ctx = contextWith(
    {
      title: [['Date row']],
      due: '2026-01-20',
      start: '2026-01-10',
    },
    now,
    { Start: '2026-01-10' },
  );
  ctx.propertyTypes = { ...ctx.propertyTypes, Start: 'date' as const };

  it('coerces date properties into FormulaDate values', () => {
    const value = evaluateFormula('prop("Due")', ctx);
    expect(value).toBeInstanceOf(FormulaDate);
    expect((value as FormulaDate).epochMs).toBe(
      new Date('2026-01-20T00:00:00Z').getTime(),
    );
  });

  it('supports dateAdd, dateSubtract, dateBetween and formatDate', () => {
    expect(
      evaluateFormula('formatDate(dateAdd(prop("Due"), 5, "days"), "yyyy-MM-dd")', ctx),
    ).toBe('2026-01-25');
    expect(
      evaluateFormula('formatDate(dateSubtract(prop("Due"), 5, "days"), "yyyy-MM-dd")', ctx),
    ).toBe('2026-01-15');
    expect(evaluateFormula('dateBetween(prop("Due"), prop("Start"), "days")', ctx)).toBe(10);
    expect(evaluateFormula('formatDate(prop("Due"), "MMMM d, yyyy")', ctx)).toBe(
      'January 20, 2026',
    );
  });

  it('supports now, timestamp and date part functions', () => {
    expect(evaluateFormula('timestamp(now())', ctx)).toBe(now.getTime());
    expect(evaluateFormula('year(prop("Due"))', ctx)).toBe(2026);
    expect(evaluateFormula('month(prop("Due"))', ctx)).toBe(1);
    expect(evaluateFormula('day(prop("Due"))', ctx)).toBe(20);
  });

  it('compares dates and numbers', () => {
    expect(evaluateFormula('prop("Due") > prop("Start")', ctx)).toBe(true);
    expect(evaluateFormula('prop("Due") == prop("Due")', ctx)).toBe(true);
  });
});

describe('Formula Evaluator: lists', () => {
  const ctx = contextWith(
    {
      title: [['List row']],
      nums: [1, 2, 3, 4],
      tags: ['red', 'blue', 'red'],
    },
    undefined,
    { Nums: [1, 2, 3, 4], Tags: ['red', 'blue', 'red'] },
  );

  it('maps with a callback expression', () => {
    expect(evaluateFormula('map(prop("Nums"), "current * 2")', ctx)).toEqual([2, 4, 6, 8]);
  });

  it('filters, finds, some and every', () => {
    expect(evaluateFormula('filter(prop("Nums"), "current > 2")', ctx)).toEqual([3, 4]);
    expect(evaluateFormula('find(prop("Nums"), "current > 2")', ctx)).toBe(3);
    expect(evaluateFormula('some(prop("Nums"), "current > 3")', ctx)).toBe(true);
    expect(evaluateFormula('every(prop("Nums"), "current > 0")', ctx)).toBe(true);
    expect(evaluateFormula('every(prop("Nums"), "current > 1")', ctx)).toBe(false);
  });

  it('supports sort, uniq, first, last, range and flatten', () => {
    expect(evaluateFormula('sort(prop("Nums"))', ctx)).toEqual([1, 2, 3, 4]);
    expect(evaluateFormula('reverse(prop("Nums"))', ctx)).toEqual([4, 3, 2, 1]);
    expect(evaluateFormula('uniq(prop("Tags"))', ctx)).toEqual(['red', 'blue']);
    expect(evaluateFormula('first(prop("Nums"))', ctx)).toBe(1);
    expect(evaluateFormula('last(prop("Nums"))', ctx)).toBe(4);
    expect(evaluateFormula('range(3)', ctx)).toEqual([0, 1, 2]);
    expect(evaluateFormula('flatten([[1, 2], [3]])', ctx)).toEqual([1, 2, 3]);
  });
});

describe('Formula Evaluator: conditionals and errors', () => {
  const ctx = contextWith({ title: [['Conditional']], amount: 10, done: true });

  it('evaluates if lazily', () => {
    expect(evaluateFormula('if(prop("Amount") > 5, "big", "small")', ctx)).toBe('big');
    expect(evaluateFormula('if(prop("Amount") > 50, "big", "small")', ctx)).toBe('small');
    expect(
      evaluateFormula('if(prop("Done"), "yes", "no")', ctx),
    ).toBe('yes');
  });

  it('throws for unknown properties and variables', () => {
    expect(() => evaluateFormula('prop("Missing")', ctx)).toThrow(FormulaError);
    expect(() => evaluateFormula('Missing + 1', ctx)).toThrow(FormulaError);
  });

  it('never executes host code', () => {
    expect(() => evaluateFormula('eval("process.exit(1)")')).toThrow(FormulaError);
    expect(() => evaluateFormula('constructor("return 1")')).toThrow(FormulaError);
  });

  it('evaluates a parsed AST directly', () => {
    const ast = parseFormula('1 + 2');
    expect(evaluateAST(ast)).toBe(3);
  });

  it('formats results', () => {
    expect(formatFormulaResult(evaluateFormula('1 + 2'))).toBe('3');
    expect(formatFormulaResult(evaluateFormula('"x"'))).toBe('x');
  });
});

describe('Formula standard library registry', () => {
  it('exposes math, string, date and list functions', () => {
    const names = formulaFunctionNames().map((name) => name.toLowerCase());
    for (const expected of [
      'round',
      'ceil',
      'floor',
      'abs',
      'min',
      'max',
      'concat',
      'join',
      'slice',
      'length',
      'replace',
      'test',
      'match',
      'now',
      'dateadd',
      'datesubtract',
      'datebetween',
      'formatdate',
      'map',
      'filter',
      'find',
      'some',
      'every',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('contains callable entries only', () => {
    for (const [name, fn] of Object.entries(FORMULA_FUNCTIONS)) {
      expect(typeof fn).toBe('function');
      expect(name).toBe(name.toLowerCase());
    }
  });
});
