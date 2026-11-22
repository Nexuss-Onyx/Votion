/**
 * Formula 2.0 standard library.
 *
 * Functions receive already-evaluated arguments (plus the raw AST argument list
 * so list operations can evaluate their callback lazily). Every function is a
 * pure, type-checked transform — there is no dynamic code execution anywhere.
 */

import {
  add,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInSeconds,
  differenceInWeeks,
  differenceInYears,
  format,
  getDate,
  getDay,
  getHours,
  getMinutes,
  getMonth,
  getSeconds,
  getYear,
  isValid,
} from 'date-fns';
import type { FormulaAST } from './Parser.js';
import {
  FormulaDate,
  FormulaError,
  formulaToNumber,
  formulaToString,
  isFormulaDate,
} from './values.js';
import type { FormulaValue } from './values.js';

/** Runtime services exposed to library functions. */
export interface FormulaRuntime {
  /** Current time (injected for deterministic tests). */
  now(): Date;
  /** Evaluates a callback expression with a variable scope. */
  evaluate(expression: string, scope?: Record<string, FormulaValue>): FormulaValue;
  /** Parses a callback expression (exposed for advanced callbacks). */
  parse(expression: string): FormulaAST;
}

/** A standard-library function. */
export type FormulaFunction = (
  args: FormulaValue[],
  runtime: FormulaRuntime,
  astArgs: FormulaAST[],
) => FormulaValue;

/** Date units accepted by date math functions. */
export type FormulaDateUnit =
  | 'seconds'
  | 'minutes'
  | 'hours'
  | 'days'
  | 'weeks'
  | 'months'
  | 'years';

function normalizeUnit(unit: unknown): FormulaDateUnit {
  const value = String(unit ?? 'days').toLowerCase();
  switch (value) {
    case 'second':
    case 'seconds':
      return 'seconds';
    case 'minute':
    case 'minutes':
      return 'minutes';
    case 'hour':
    case 'hours':
      return 'hours';
    case 'day':
    case 'days':
      return 'days';
    case 'week':
    case 'weeks':
      return 'weeks';
    case 'month':
    case 'months':
      return 'months';
    case 'year':
    case 'years':
      return 'years';
    default:
      throw new FormulaError(`Unknown date unit "${String(unit)}"`);
  }
}

function requireArity(name: string, args: FormulaValue[], min: number, max = min): void {
  if (args.length < min || args.length > max) {
    throw new FormulaError(
      `${name} expects ${min === max ? min : `${min}-${max}`} argument(s), received ${args.length}`,
    );
  }
}

function requireNumber(name: string, value: FormulaValue): number {
  const numeric = formulaToNumber(value);
  if (numeric == null) {
    throw new FormulaError(`${name} expects a number, received ${formulaToString(value)}`);
  }
  return numeric;
}

function requireString(name: string, value: FormulaValue): string {
  if (value == null) {
    throw new FormulaError(`${name} expects a string`);
  }
  return formulaToString(value);
}

function requireList(name: string, value: FormulaValue): FormulaValue[] {
  if (!Array.isArray(value)) {
    throw new FormulaError(`${name} expects a list, received ${formulaToString(value)}`);
  }
  return value;
}

function requireDate(name: string, value: FormulaValue): FormulaDate {
  if (!isFormulaDate(value)) {
    throw new FormulaError(`${name} expects a date, received ${formulaToString(value)}`);
  }
  return value;
}

function asDate(value: FormulaValue): FormulaDate | null {
  return FormulaDate.from(value);
}

function addDate(date: FormulaDate, amount: number, unit: FormulaDateUnit): FormulaDate {
  const duration: Record<string, number> = { [unit]: amount };
  return new FormulaDate(add(new Date(date.epochMs), duration).getTime());
}

function dateDiff(
  later: FormulaDate,
  earlier: FormulaDate,
  unit: FormulaDateUnit,
): number {
  const start = new Date(earlier.epochMs);
  const end = new Date(later.epochMs);
  switch (unit) {
    case 'seconds':
      return differenceInSeconds(end, start);
    case 'minutes':
      return differenceInMinutes(end, start);
    case 'hours':
      return differenceInHours(end, start);
    case 'days':
      return differenceInDays(end, start);
    case 'weeks':
      return differenceInWeeks(end, start);
    case 'months':
      return differenceInMonths(end, start);
    case 'years':
      return differenceInYears(end, start);
    default:
      return 0;
  }
}

/** Translates Notion-style date tokens to date-fns tokens. */
export function normalizeDateFormat(pattern: string): string {
  return pattern
    .replace(/YYYY/g, 'yyyy')
    .replace(/YY/g, 'yy')
    .replace(/DD/g, 'dd')
    .replace(/D(?!d)/g, 'd')
    .replace(/HH/g, 'HH')
    .replace(/mm/g, 'mm')
    .replace(/ss/g, 'ss');
}

function formatDateWithPattern(date: FormulaDate, pattern: string): string {
  const normalized = normalizeDateFormat(pattern);
  try {
    return format(new Date(date.epochMs), normalized);
  } catch {
    return date.toISOString();
  }
}

/** Resolves a callback AST node to an expression string. */
function callbackExpression(ast: FormulaAST | undefined): string {
  if (!ast) {
    throw new FormulaError('List function expects a callback expression');
  }
  if (ast.type === 'StringLiteral') {
    return ast.value;
  }
  if (ast.type === 'Identifier') {
    return ast.name;
  }
  throw new FormulaError(
    'List callbacks must be a quoted formula string (e.g. map(list, "current * 2"))',
  );
}

function evaluateCallback(
  ast: FormulaAST | undefined,
  runtime: FormulaRuntime,
  item: FormulaValue,
  index: number,
): FormulaValue {
  const expression = callbackExpression(ast);
  return runtime.evaluate(expression, {
    current: item,
    item,
    index,
    key: index,
  });
}

function valuesOrArgs(args: FormulaValue[]): FormulaValue[] {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

/** The built-in function registry. */
export const FORMULA_FUNCTIONS: Readonly<Record<string, FormulaFunction>> = {
  // ---------------------------------------------------------------- math
  round: (args) => {
    requireArity('round', args, 1, 2);
    const value = requireNumber('round', args[0] as FormulaValue);
    const digits = args[1] == null ? 0 : requireNumber('round', args[1]);
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  },
  ceil: (args) => {
    requireArity('ceil', args, 1);
    return Math.ceil(requireNumber('ceil', args[0] as FormulaValue));
  },
  floor: (args) => {
    requireArity('floor', args, 1);
    return Math.floor(requireNumber('floor', args[0] as FormulaValue));
  },
  abs: (args) => {
    requireArity('abs', args, 1);
    return Math.abs(requireNumber('abs', args[0] as FormulaValue));
  },
  sqrt: (args) => {
    requireArity('sqrt', args, 1);
    return Math.sqrt(requireNumber('sqrt', args[0] as FormulaValue));
  },
  pow: (args) => {
    requireArity('pow', args, 2);
    return Math.pow(
      requireNumber('pow', args[0] as FormulaValue),
      requireNumber('pow', args[1] as FormulaValue),
    );
  },
  mod: (args) => {
    requireArity('mod', args, 2);
    const divisor = requireNumber('mod', args[1] as FormulaValue);
    if (divisor === 0) {
      throw new FormulaError('mod cannot divide by zero');
    }
    return requireNumber('mod', args[0] as FormulaValue) % divisor;
  },
  min: (args) => {
    const values = valuesOrArgs(args).map((value) => requireNumber('min', value));
    if (values.length === 0) {
      throw new FormulaError('min expects at least one value');
    }
    return Math.min(...values);
  },
  max: (args) => {
    const values = valuesOrArgs(args).map((value) => requireNumber('max', value));
    if (values.length === 0) {
      throw new FormulaError('max expects at least one value');
    }
    return Math.max(...values);
  },

  // -------------------------------------------------------------- strings
  concat: (args) => {
    if (args.length === 0) {
      throw new FormulaError('concat expects at least one argument');
    }
    return args
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .map((value) => formulaToString(value))
      .join('');
  },
  join: (args) => {
    requireArity('join', args, 2);
    const separator = requireString('join', args[0] as FormulaValue);
    const list = requireList('join', args[1] as FormulaValue);
    return list.map((value) => formulaToString(value)).join(separator);
  },
  slice: (args) => {
    requireArity('slice', args, 2, 3);
    const start = requireNumber('slice', args[1] as FormulaValue);
    const end = args[2] == null ? undefined : requireNumber('slice', args[2]);
    if (Array.isArray(args[0])) {
      return args[0].slice(start, end);
    }
    return requireString('slice', args[0] as FormulaValue).slice(start, end);
  },
  length: (args) => {
    requireArity('length', args, 1);
    const value = args[0];
    if (Array.isArray(value)) {
      return value.length;
    }
    return requireString('length', value as FormulaValue).length;
  },
  replace: (args) => {
    requireArity('replace', args, 3);
    const source = requireString('replace', args[0] as FormulaValue);
    const find = requireString('replace', args[1] as FormulaValue);
    const replacement = requireString('replace', args[2] as FormulaValue);
    if (find === '') {
      return source;
    }
    return source.split(find).join(replacement);
  },
  replaceall: (args) => {
    requireArity('replaceAll', args, 3);
    const source = requireString('replaceAll', args[0] as FormulaValue);
    const find = requireString('replaceAll', args[1] as FormulaValue);
    const replacement = requireString('replaceAll', args[2] as FormulaValue);
    if (find === '') {
      return source;
    }
    return source.split(find).join(replacement);
  },
  replacefirst: (args) => {
    requireArity('replaceFirst', args, 3);
    const source = requireString('replaceFirst', args[0] as FormulaValue);
    const find = requireString('replaceFirst', args[1] as FormulaValue);
    const replacement = requireString('replaceFirst', args[2] as FormulaValue);
    return source.replace(find, replacement);
  },
  test: (args) => {
    requireArity('test', args, 2);
    const source = requireString('test', args[0] as FormulaValue);
    const pattern = requireString('test', args[1] as FormulaValue);
    try {
      return new RegExp(pattern).test(source);
    } catch (error) {
      throw new FormulaError(
        `Invalid regular expression "${pattern}": ${(error as Error).message}`,
      );
    }
  },
  match: (args) => {
    requireArity('match', args, 2);
    const source = requireString('match', args[0] as FormulaValue);
    const pattern = requireString('match', args[1] as FormulaValue);
    try {
      const matches = new RegExp(pattern).exec(source);
      return matches ? [matches[0] ?? ''] : [];
    } catch (error) {
      throw new FormulaError(
        `Invalid regular expression "${pattern}": ${(error as Error).message}`,
      );
    }
  },
  lower: (args) => {
    requireArity('lower', args, 1);
    return requireString('lower', args[0] as FormulaValue).toLowerCase();
  },
  upper: (args) => {
    requireArity('upper', args, 1);
    return requireString('upper', args[0] as FormulaValue).toUpperCase();
  },
  trim: (args) => {
    requireArity('trim', args, 1);
    return requireString('trim', args[0] as FormulaValue).trim();
  },
  title: (args) => {
    requireArity('title', args, 1);
    return requireString('title', args[0] as FormulaValue)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  },
  contains: (args) => {
    requireArity('contains', args, 2);
    return requireString('contains', args[0] as FormulaValue).includes(
      requireString('contains', args[1] as FormulaValue),
    );
  },
  startswith: (args) => {
    requireArity('startsWith', args, 2);
    return requireString('startsWith', args[0] as FormulaValue).startsWith(
      requireString('startsWith', args[1] as FormulaValue),
    );
  },
  endswith: (args) => {
    requireArity('endsWith', args, 2);
    return requireString('endsWith', args[0] as FormulaValue).endsWith(
      requireString('endsWith', args[1] as FormulaValue),
    );
  },
  format: (args) => {
    requireArity('format', args, 1);
    return formulaToString(args[0] as FormulaValue);
  },
  tonumber: (args) => {
    requireArity('toNumber', args, 1);
    return formulaToNumber(args[0] as FormulaValue);
  },

  // ---------------------------------------------------------------- dates
  now: (args, runtime) => {
    requireArity('now', args, 0, 0);
    return new FormulaDate(runtime.now().getTime());
  },
  date: (args) => {
    requireArity('date', args, 1);
    const parsed = asDate(args[0] as FormulaValue);
    if (!parsed) {
      throw new FormulaError('date expects a valid date value');
    }
    return parsed;
  },
  dateadd: (args) => {
    requireArity('dateAdd', args, 3);
    const date = requireDate('dateAdd', args[0] as FormulaValue);
    const amount = requireNumber('dateAdd', args[1] as FormulaValue);
    return addDate(date, amount, normalizeUnit(args[2]));
  },
  datesubtract: (args) => {
    requireArity('dateSubtract', args, 3);
    const date = requireDate('dateSubtract', args[0] as FormulaValue);
    const amount = requireNumber('dateSubtract', args[1] as FormulaValue);
    return addDate(date, -amount, normalizeUnit(args[2]));
  },
  datebetween: (args) => {
    requireArity('dateBetween', args, 3);
    const later = requireDate('dateBetween', args[0] as FormulaValue);
    const earlier = requireDate('dateBetween', args[1] as FormulaValue);
    return dateDiff(later, earlier, normalizeUnit(args[2]));
  },
  formatdate: (args) => {
    requireArity('formatDate', args, 1, 2);
    const date = requireDate('formatDate', args[0] as FormulaValue);
    if (args[1] == null) {
      return formatDateWithPattern(date, 'yyyy-MM-dd');
    }
    const pattern = requireString('formatDate', args[1]);
    switch (pattern.toLowerCase()) {
      case 'short':
        return formatDateWithPattern(date, 'PP');
      case 'full':
        return formatDateWithPattern(date, 'PP p');
      case 'relative':
        return formatDateWithPattern(date, 'PP');
      default:
        return formatDateWithPattern(date, pattern);
    }
  },
  year: (args) => {
    requireArity('year', args, 1);
    return getYear(new Date(requireDate('year', args[0] as FormulaValue).epochMs));
  },
  month: (args) => {
    requireArity('month', args, 1);
    return (
      getMonth(new Date(requireDate('month', args[0] as FormulaValue).epochMs)) + 1
    );
  },
  day: (args) => {
    requireArity('day', args, 1);
    return getDate(new Date(requireDate('day', args[0] as FormulaValue).epochMs));
  },
  weekday: (args) => {
    requireArity('weekday', args, 1);
    return getDay(new Date(requireDate('weekday', args[0] as FormulaValue).epochMs));
  },
  hour: (args) => {
    requireArity('hour', args, 1);
    return getHours(new Date(requireDate('hour', args[0] as FormulaValue).epochMs));
  },
  minute: (args) => {
    requireArity('minute', args, 1);
    return getMinutes(new Date(requireDate('minute', args[0] as FormulaValue).epochMs));
  },
  second: (args) => {
    requireArity('second', args, 1);
    return getSeconds(new Date(requireDate('second', args[0] as FormulaValue).epochMs));
  },
  timestamp: (args) => {
    requireArity('timestamp', args, 1);
    return requireDate('timestamp', args[0] as FormulaValue).epochMs;
  },

  // ---------------------------------------------------------------- lists
  map: (args, runtime, astArgs) => {
    requireArity('map', args, 2);
    const list = requireList('map', args[0] as FormulaValue);
    return list.map((item, index) =>
      evaluateCallback(astArgs[1], runtime, item, index),
    );
  },
  filter: (args, runtime, astArgs) => {
    requireArity('filter', args, 2);
    const list = requireList('filter', args[0] as FormulaValue);
    return list.filter(
      (item, index) =>
        formulaToBoolean(evaluateCallback(astArgs[1], runtime, item, index)),
    );
  },
  find: (args, runtime, astArgs) => {
    requireArity('find', args, 2);
    const list = requireList('find', args[0] as FormulaValue);
    const match = list.find(
      (item, index) =>
        formulaToBoolean(evaluateCallback(astArgs[1], runtime, item, index)),
    );
    return match ?? null;
  },
  some: (args, runtime, astArgs) => {
    requireArity('some', args, 2);
    const list = requireList('some', args[0] as FormulaValue);
    return list.some(
      (item, index) =>
        formulaToBoolean(evaluateCallback(astArgs[1], runtime, item, index)),
    );
  },
  every: (args, runtime, astArgs) => {
    requireArity('every', args, 2);
    const list = requireList('every', args[0] as FormulaValue);
    return list.every(
      (item, index) =>
        formulaToBoolean(evaluateCallback(astArgs[1], runtime, item, index)),
    );
  },
  sort: (args) => {
    requireArity('sort', args, 1, 2);
    const list = requireList('sort', args[0] as FormulaValue);
    const descending = args[1] === true;
    const sorted = [...list].sort((a, b) => {
      const an = formulaToNumber(a);
      const bn = formulaToNumber(b);
      if (an != null && bn != null) {
        return an - bn;
      }
      return formulaToString(a).localeCompare(formulaToString(b));
    });
    return descending ? sorted.reverse() : sorted;
  },
  reverse: (args) => {
    requireArity('reverse', args, 1);
    return [...requireList('reverse', args[0] as FormulaValue)].reverse();
  },
  uniq: (args) => {
    requireArity('uniq', args, 1);
    const list = requireList('uniq', args[0] as FormulaValue);
    const seen = new Set<string>();
    const result: FormulaValue[] = [];
    for (const value of list) {
      const key = formulaToString(value);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(value);
      }
    }
    return result;
  },
  flatten: (args) => {
    requireArity('flatten', args, 1);
    const list = requireList('flatten', args[0] as FormulaValue);
    return list.flatMap((value) => (Array.isArray(value) ? value : [value]));
  },
  first: (args) => {
    requireArity('first', args, 1);
    const list = requireList('first', args[0] as FormulaValue);
    return list[0] ?? null;
  },
  last: (args) => {
    requireArity('last', args, 1);
    const list = requireList('last', args[0] as FormulaValue);
    return list.length === 0 ? null : (list[list.length - 1] as FormulaValue);
  },
  range: (args) => {
    requireArity('range', args, 1, 3);
    const start = requireNumber('range', args[0] as FormulaValue);
    const end = args[1] == null ? undefined : requireNumber('range', args[1]);
    const step = args[2] == null ? 1 : requireNumber('range', args[2]);
    if (step === 0) {
      throw new FormulaError('range step cannot be zero');
    }
    const result: number[] = [];
    if (end == null) {
      for (let value = 0; value < start; value += Math.abs(step)) {
        result.push(value);
      }
      return result;
    }
    if (step > 0) {
      for (let value = start; value <= end; value += step) {
        result.push(value);
      }
    } else {
      for (let value = start; value >= end; value += step) {
        result.push(value);
      }
    }
    return result;
  },
};

/** Internal helper: truthiness for list predicates. */
function formulaToBoolean(value: FormulaValue): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

/** Returns a registered function, or `undefined`. */
export function getFormulaFunction(name: string): FormulaFunction | undefined {
  const key = name.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FORMULA_FUNCTIONS, key)) {
    return undefined;
  }
  return FORMULA_FUNCTIONS[key];
}

/** Registers (or replaces) a standard-library function. */
export function registerFormulaFunction(name: string, fn: FormulaFunction): void {
  (FORMULA_FUNCTIONS as Record<string, FormulaFunction>)[name.toLowerCase()] = fn;
}

/** Returns `true` when a name is a built-in function. */
export function isFormulaFunction(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(FORMULA_FUNCTIONS, name.toLowerCase());
}

/** Validates that a date produced by date-fns is real. */
export function isValidFormulaDate(date: Date): boolean {
  return isValid(date);
}
