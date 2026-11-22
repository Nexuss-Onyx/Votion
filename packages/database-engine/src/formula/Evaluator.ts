/**
 * Formula 2.0 AST evaluator.
 *
 * The evaluator is a pure interpreter: AST nodes are matched exhaustively and
 * all built-ins come from the standard-library registry. There is no `eval`,
 * `new Function`, or dynamic property access, so a malicious formula cannot
 * escape the sandbox.
 */

import type { CollectionSchema, PropertyType } from '@votion/types';
import { parseFormula } from './Parser.js';
import type { FormulaAST } from './Parser.js';
import {
  FORMULA_FUNCTIONS,
  getFormulaFunction,
  type FormulaRuntime,
} from './StandardLibrary.js';
import {
  FormulaDate,
  FormulaError,
  formulaEquals,
  formulaToNumber,
  formulaToString,
  formulaTruthy,
  isFormulaDate,
  toFormulaValue,
} from './values.js';
import type { FormulaValue } from './values.js';
import type { FilterableRecord } from '../types.js';

/** Context passed to the evaluator. */
export interface FormulaEvalContext {
  /** Raw property values keyed by property id. */
  properties?: Record<string, unknown>;
  /** Raw property values keyed by property display name. */
  propertiesByName?: Record<string, unknown>;
  /** Property type lookup by id or display name. */
  propertyTypes?: Record<string, PropertyType>;
  /** Property display name -> id mapping. */
  propertyNameToId?: Record<string, string>;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

/** Internal scope used by list callbacks. */
type Scope = Record<string, FormulaValue>;

/** Builds a formula context from a database record and its schema. */
export function createFormulaContext(
  record: FilterableRecord,
  schema: CollectionSchema,
  propertiesByName: Record<string, unknown> = {},
): FormulaEvalContext {
  const properties = 'properties' in record ? record.properties : {};
  const types: Record<string, PropertyType> = {};
  const nameToId: Record<string, string> = {};
  const byName: Record<string, unknown> = { ...propertiesByName };

  for (const [propertyId, property] of Object.entries(schema)) {
    types[propertyId] = property.type;
    types[property.name] = property.type;
    nameToId[property.name] = propertyId;
    if (!(property.name in byName)) {
      byName[property.name] = properties[propertyId] ?? null;
    }
  }

  // Audit properties are addressable by their display names and wire names.
  const audit: Array<[string, unknown, PropertyType]> = [
    ['Created time', record.created_time, 'created_time'],
    ['created_time', record.created_time, 'created_time'],
    ['Last edited time', record.last_edited_time, 'last_edited_time'],
    ['last_edited_time', record.last_edited_time, 'last_edited_time'],
    ['Created by', record.created_by_id, 'created_by'],
    ['created_by', record.created_by_id, 'created_by'],
    ['Last edited by', record.last_edited_by_id, 'last_edited_by'],
    ['last_edited_by', record.last_edited_by_id, 'last_edited_by'],
    ['ID', record.id, 'unique_id'],
    ['id', record.id, 'unique_id'],
  ];
  for (const [name, value, type] of audit) {
    byName[name] = value;
    types[name] = type;
  }

  return {
    properties,
    propertiesByName: byName,
    propertyTypes: types,
    propertyNameToId: nameToId,
    now: () => new Date(),
  };
}

/** Evaluates a formula expression against a context. */
export function evaluateFormula(
  input: string,
  context: FormulaEvalContext = {},
): FormulaValue {
  const ast = parseFormula(input);
  return evaluateAST(ast, context);
}

/** Evaluates a parsed AST against a context. */
export function evaluateAST(
  ast: FormulaAST,
  context: FormulaEvalContext = {},
  scope: Scope = {},
): FormulaValue {
  const evaluator = new FormulaEvaluator(context, scope);
  return evaluator.evaluate(ast);
}

/** Evaluates a formula property for a database record. */
export function evaluateRecordFormula(
  record: FilterableRecord,
  schema: CollectionSchema,
  expression: string,
): FormulaValue {
  return evaluateFormula(expression, createFormulaContext(record, schema));
}

/** Renders a formula result as a display string. */
export function formatFormulaResult(value: FormulaValue): string {
  if (value instanceof FormulaDate) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatFormulaResult(entry)).join(', ');
  }
  return formulaToString(value);
}

/** Converts a formula result into a JSON-storable value. */
export function formulaResultToStored(value: FormulaValue): unknown {
  if (value instanceof FormulaDate) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formulaResultToStored(entry));
  }
  return value;
}

/** Interpreter over a single AST. */
class FormulaEvaluator {
  private readonly runtime: FormulaRuntime;
  private readonly callbackCache = new Map<string, FormulaAST>();

  constructor(
    private readonly context: FormulaEvalContext,
    private readonly scope: Scope = {},
  ) {
    this.runtime = {
      now: () => context.now?.() ?? new Date(),
      evaluate: (expression, nextScope) => this.evaluateCallback(expression, nextScope),
      parse: (expression) => this.parseCallback(expression),
    };
  }

  evaluate(node: FormulaAST): FormulaValue {
    try {
      return this.evaluateNode(node);
    } catch (error) {
      if (error instanceof FormulaError) {
        if (error.position == null) {
          error.position = node.position;
        }
        throw error;
      }
      throw error;
    }
  }

  private evaluateNode(node: FormulaAST): FormulaValue {
    switch (node.type) {
      case 'NumberLiteral':
        return node.value;
      case 'StringLiteral':
        return node.value;
      case 'BooleanLiteral':
        return node.value;
      case 'NullLiteral':
        return null;
      case 'Identifier':
        return this.resolveIdentifier(node.name);
      case 'PropertyRef':
        return this.resolveProperty(node.name);
      case 'Unary':
        return this.evaluateUnary(node);
      case 'Binary':
        return this.evaluateBinary(node);
      case 'Call':
        return this.evaluateCall(node);
      case 'ListLiteral':
        return node.elements.map((element) => this.evaluate(element));
      default: {
        const exhaustive: never = node;
        throw new FormulaError(`Unsupported AST node: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private resolveIdentifier(name: string): FormulaValue {
    if (Object.prototype.hasOwnProperty.call(this.scope, name)) {
      return this.scope[name] ?? null;
    }
    switch (name) {
      case 'pi':
        return Math.PI;
      case 'e':
        return Math.E;
      case 'true':
        return true;
      case 'false':
        return false;
      case 'null':
        return null;
      default:
        throw new FormulaError(`Unknown variable "${name}"`);
    }
  }

  private resolveProperty(name: string): FormulaValue {
    const { properties = {}, propertiesByName = {}, propertyTypes = {}, propertyNameToId = {} } =
      this.context;

    const propertyId = propertyNameToId[name] ?? (name in properties ? name : undefined);
    if (propertyId != null && Object.prototype.hasOwnProperty.call(properties, propertyId)) {
      const type = propertyTypes[propertyId];
      return toFormulaValue(properties[propertyId], type);
    }
    if (Object.prototype.hasOwnProperty.call(propertiesByName, name)) {
      const type = propertyTypes[name];
      return toFormulaValue(propertiesByName[name], type);
    }
    if (Object.prototype.hasOwnProperty.call(properties, name)) {
      return toFormulaValue(properties[name], propertyTypes[name]);
    }
    throw new FormulaError(`Unknown property "${name}"`);
  }

  private evaluateUnary(node: Extract<FormulaAST, { type: 'Unary' }>): FormulaValue {
    const argument = this.evaluate(node.argument);
    switch (node.operator) {
      case '-': {
        const numeric = formulaToNumber(argument);
        if (numeric == null) {
          throw new FormulaError('Unary minus expects a number');
        }
        return -numeric;
      }
      case '+': {
        const numeric = formulaToNumber(argument);
        if (numeric == null) {
          throw new FormulaError('Unary plus expects a number');
        }
        return numeric;
      }
      case '!':
      case 'not':
        return !formulaTruthy(argument);
      default:
        throw new FormulaError(`Unsupported unary operator "${node.operator}"`);
    }
  }

  private evaluateBinary(node: Extract<FormulaAST, { type: 'Binary' }>): FormulaValue {
    switch (node.operator) {
      case 'and':
      case '&&':
        return (
          formulaTruthy(this.evaluate(node.left)) &&
          formulaTruthy(this.evaluate(node.right))
        );
      case 'or':
      case '||':
        return (
          formulaTruthy(this.evaluate(node.left)) ||
          formulaTruthy(this.evaluate(node.right))
        );
    }

    const left = this.evaluate(node.left);
    const right = this.evaluate(node.right);

    switch (node.operator) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return formulaToString(left) + formulaToString(right);
        }
        return this.numeric(left, '+') + this.numeric(right, '+');
      case '-':
        return this.numeric(left, '-') - this.numeric(right, '-');
      case '*':
        return this.numeric(left, '*') * this.numeric(right, '*');
      case '/': {
        const divisor = this.numeric(right, '/');
        if (divisor === 0) {
          throw new FormulaError('Division by zero');
        }
        return this.numeric(left, '/') / divisor;
      }
      case '%': {
        const divisor = this.numeric(right, '%');
        if (divisor === 0) {
          throw new FormulaError('Modulo by zero');
        }
        return this.numeric(left, '%') % divisor;
      }
      case '==':
        return formulaEquals(left, right);
      case '!=':
        return !formulaEquals(left, right);
      case '<':
      case '>':
      case '<=':
      case '>=':
        return this.compare(left, right, node.operator);
      default:
        throw new FormulaError(`Unsupported binary operator "${node.operator}"`);
    }
  }

  private numeric(value: FormulaValue, operator: string): number {
    const numeric = formulaToNumber(value);
    if (numeric == null) {
      throw new FormulaError(
        `Operator "${operator}" expects numbers, received ${formulaToString(value)}`,
      );
    }
    return numeric;
  }

  private compare(
    left: FormulaValue,
    right: FormulaValue,
    operator: '<' | '>' | '<=' | '>=',
  ): boolean {
    let result: number;
    if (isFormulaDate(left) || isFormulaDate(right)) {
      const a = isFormulaDate(left) ? left.epochMs : null;
      const b = isFormulaDate(right) ? right.epochMs : null;
      if (a == null || b == null) {
        throw new FormulaError('Cannot compare a date with a non-date value');
      }
      result = a - b;
    } else {
      const a = formulaToNumber(left);
      const b = formulaToNumber(right);
      if (a != null && b != null) {
        result = a - b;
      } else {
        result = formulaToString(left).localeCompare(formulaToString(right));
      }
    }
    switch (operator) {
      case '<':
        return result < 0;
      case '>':
        return result > 0;
      case '<=':
        return result <= 0;
      case '>=':
        return result >= 0;
      default:
        return false;
    }
  }

  private evaluateCall(node: Extract<FormulaAST, { type: 'Call' }>): FormulaValue {
    const name = node.callee.toLowerCase();

    if (name === 'if') {
      if (node.args.length !== 3) {
        throw new FormulaError(
          `if expects 3 arguments, received ${node.args.length}`,
          node.position,
        );
      }
      const condition = formulaTruthy(this.evaluate(node.args[0] as FormulaAST));
      return this.evaluate(condition ? (node.args[1] as FormulaAST) : (node.args[2] as FormulaAST));
    }

    const fn = getFormulaFunction(name);
    if (!fn) {
      throw new FormulaError(`Unknown function "${name}"`, node.position);
    }
    const args = node.args.map((argument) => this.evaluate(argument));
    return fn(args, this.runtime, node.args);
  }

  private parseCallback(expression: string): FormulaAST {
    const cached = this.callbackCache.get(expression);
    if (cached) {
      return cached;
    }
    const parsed = parseFormula(expression);
    this.callbackCache.set(expression, parsed);
    return parsed;
  }

  private evaluateCallback(
    expression: string,
    nextScope: Scope = {},
  ): FormulaValue {
    const ast = this.parseCallback(expression);
    const evaluator = new FormulaEvaluator(this.context, { ...this.scope, ...nextScope });
    return evaluator.evaluate(ast);
  }
}

/** Returns the names of every built-in formula function. */
export function formulaFunctionNames(): string[] {
  return Object.keys(FORMULA_FUNCTIONS);
}
