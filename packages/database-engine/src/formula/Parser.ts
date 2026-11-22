/**
 * Recursive-descent parser producing a Formula 2.0 AST.
 *
 * Grammar (lowest to highest precedence):
 *
 *   expression      := orExpr
 *   orExpr          := andExpr (('or' | '||') andExpr)*
 *   andExpr         := comparison (('and' | '&&') comparison)*
 *   comparison      := additive (('==' | '!=' | '<' | '>' | '<=' | '>=') additive)*
 *   additive        := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative  := unary (('*' | '/' | '%') unary)*
 *   unary           := ('-' | '+' | '!' | 'not') unary | primary
 *   primary         := NUMBER | STRING | BOOLEAN | NULL
 *                     | 'prop' '(' STRING ')'
 *                     | IDENTIFIER '(' args ')'
 *                     | IDENTIFIER
 *                     | '(' expression ')'
 */

import { FormulaSyntaxError, TokenType, tokenizeFormula } from './Lexer.js';
import type { FormulaToken } from './Lexer.js';

/** AST node variants. */
export type FormulaAST =
  | { type: 'NumberLiteral'; value: number; position: number }
  | { type: 'StringLiteral'; value: string; position: number }
  | { type: 'BooleanLiteral'; value: boolean; position: number }
  | { type: 'NullLiteral'; position: number }
  | { type: 'Identifier'; name: string; position: number }
  | { type: 'PropertyRef'; name: string; position: number }
  | {
      type: 'Unary';
      operator: string;
      argument: FormulaAST;
      position: number;
    }
  | {
      type: 'Binary';
      operator: string;
      left: FormulaAST;
      right: FormulaAST;
      position: number;
    }
  | {
      type: 'Call';
      callee: string;
      args: FormulaAST[];
      position: number;
    }
  | { type: 'ListLiteral'; elements: FormulaAST[]; position: number };

const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);

/** Recursive-descent parser over a token stream. */
export class FormulaParser {
  private readonly tokens: FormulaToken[];
  private cursor = 0;

  constructor(tokens: FormulaToken[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): FormulaToken {
    return this.tokens[this.cursor + offset] ?? {
      type: TokenType.EOF,
      value: '',
      position: 0,
    };
  }

  private advance(): FormulaToken {
    const token = this.peek();
    if (token.type !== TokenType.EOF) {
      this.cursor += 1;
    }
    return token;
  }

  private expect(type: TokenType, message: string): FormulaToken {
    const token = this.peek();
    if (token.type !== type) {
      throw new FormulaSyntaxError(message, token.position);
    }
    return this.advance();
  }

  private isOperator(value: string): boolean {
    const token = this.peek();
    return token.type === TokenType.Operator && token.value === value;
  }

  private isKeyword(value: string): boolean {
    const token = this.peek();
    return token.type === TokenType.Identifier && token.value === value;
  }

  /** Parses a whole formula, requiring the token stream to be consumed. */
  parse(): FormulaAST {
    const ast = this.parseExpression();
    const remaining = this.peek();
    if (remaining.type !== TokenType.EOF) {
      throw new FormulaSyntaxError(
        `Unexpected token "${remaining.value}" after expression`,
        remaining.position,
      );
    }
    return ast;
  }

  parseExpression(): FormulaAST {
    return this.parseOr();
  }

  private parseOr(): FormulaAST {
    let left = this.parseAnd();
    while (this.isKeyword('or') || this.isOperator('||')) {
      const operator = this.advance();
      const right = this.parseAnd();
      left = {
        type: 'Binary',
        operator: operator.value,
        left,
        right,
        position: operator.position,
      };
    }
    return left;
  }

  private parseAnd(): FormulaAST {
    let left = this.parseComparison();
    while (this.isKeyword('and') || this.isOperator('&&')) {
      const operator = this.advance();
      const right = this.parseComparison();
      left = {
        type: 'Binary',
        operator: operator.value,
        left,
        right,
        position: operator.position,
      };
    }
    return left;
  }

  private parseComparison(): FormulaAST {
    let left = this.parseAdditive();
    while (this.peek().type === TokenType.Operator && COMPARISON_OPERATORS.has(this.peek().value)) {
      const operator = this.advance();
      const right = this.parseAdditive();
      left = {
        type: 'Binary',
        operator: operator.value,
        left,
        right,
        position: operator.position,
      };
    }
    return left;
  }

  private parseAdditive(): FormulaAST {
    let left = this.parseMultiplicative();
    while (this.isOperator('+') || this.isOperator('-')) {
      const operator = this.advance();
      const right = this.parseMultiplicative();
      left = {
        type: 'Binary',
        operator: operator.value,
        left,
        right,
        position: operator.position,
      };
    }
    return left;
  }

  private parseMultiplicative(): FormulaAST {
    let left = this.parseUnary();
    while (this.isOperator('*') || this.isOperator('/') || this.isOperator('%')) {
      const operator = this.advance();
      const right = this.parseUnary();
      left = {
        type: 'Binary',
        operator: operator.value,
        left,
        right,
        position: operator.position,
      };
    }
    return left;
  }

  private parseUnary(): FormulaAST {
    if (
      this.isOperator('-') ||
      this.isOperator('+') ||
      this.isOperator('!') ||
      this.isKeyword('not')
    ) {
      const operator = this.advance();
      const argument = this.parseUnary();
      return {
        type: 'Unary',
        operator: operator.value,
        argument,
        position: operator.position,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaAST {
    const token = this.peek();

    switch (token.type) {
      case TokenType.Number: {
        this.advance();
        const value = Number(token.value);
        if (!Number.isFinite(value)) {
          throw new FormulaSyntaxError(`Invalid number "${token.value}"`, token.position);
        }
        return { type: 'NumberLiteral', value, position: token.position };
      }
      case TokenType.String:
        this.advance();
        return { type: 'StringLiteral', value: token.value, position: token.position };
      case TokenType.Prop: {
        this.advance();
        this.expect(TokenType.LParen, 'Expected "(" after prop');
        const nameToken = this.peek();
        if (nameToken.type !== TokenType.String && nameToken.type !== TokenType.Identifier) {
          throw new FormulaSyntaxError(
            'Expected a property name string inside prop(...)',
            nameToken.position,
          );
        }
        this.advance();
        this.expect(TokenType.RParen, 'Expected ")" after prop(...)');
        return {
          type: 'PropertyRef',
          name: nameToken.value,
          position: token.position,
        };
      }
      case TokenType.LParen: {
        this.advance();
        const expression = this.parseExpression();
        this.expect(TokenType.RParen, 'Expected closing parenthesis');
        return expression;
      }
      case TokenType.LBracket: {
        this.advance();
        const elements: FormulaAST[] = [];
        if (this.peek().type !== TokenType.RBracket) {
          elements.push(this.parseExpression());
          while (this.peek().type === TokenType.Comma) {
            this.advance();
            elements.push(this.parseExpression());
          }
        }
        this.expect(TokenType.RBracket, 'Expected closing bracket');
        return { type: 'ListLiteral', elements, position: token.position };
      }
      case TokenType.Identifier: {
        this.advance();
        const name = token.value;
        if (name === 'true' || name === 'false') {
          return { type: 'BooleanLiteral', value: name === 'true', position: token.position };
        }
        if (name === 'null') {
          return { type: 'NullLiteral', position: token.position };
        }
        if (this.peek().type === TokenType.LParen) {
          this.advance();
          const args: FormulaAST[] = [];
          if (this.peek().type !== TokenType.RParen) {
            args.push(this.parseExpression());
            while (this.peek().type === TokenType.Comma) {
              this.advance();
              args.push(this.parseExpression());
            }
          }
          this.expect(TokenType.RParen, `Expected ")" closing ${name}(...)`);
          return { type: 'Call', callee: name, args, position: token.position };
        }
        return { type: 'Identifier', name, position: token.position };
      }
      case TokenType.EOF:
        throw new FormulaSyntaxError('Unexpected end of formula', token.position);
      default:
        throw new FormulaSyntaxError(
          `Unexpected token "${token.value}"`,
          token.position,
        );
    }
  }
}

/** Parses a formula string into an AST. */
export function parseFormula(input: string): FormulaAST {
  return new FormulaParser(tokenizeFormula(input)).parse();
}

/** Parses a sub-expression used by list callbacks. */
export function parseFormulaExpression(input: string): FormulaAST {
  return parseFormula(input);
}
