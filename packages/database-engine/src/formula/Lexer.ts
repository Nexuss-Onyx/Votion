/**
 * Formula 2.0 lexer.
 *
 * Tokenises a formula string into a flat token stream. The lexer is
 * intentionally small and strict: it never evaluates anything and rejects
 * unknown characters with a position-annotated error.
 */

/** Token categories produced by the lexer. */
export enum TokenType {
  Number = 'NUMBER',
  String = 'STRING',
  Identifier = 'IDENTIFIER',
  Prop = 'PROP',
  Operator = 'OPERATOR',
  LParen = 'LPAREN',
  RParen = 'RPAREN',
  LBracket = 'LBRACKET',
  RBracket = 'RBRACKET',
  Comma = 'COMMA',
  EOF = 'EOF',
}

/** A single lexed token. */
export interface FormulaToken {
  type: TokenType;
  value: string;
  /** Character offset of the token in the source string. */
  position: number;
}

/** Thrown for malformed formula source. */
export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
    this.name = 'FormulaSyntaxError';
  }
}

const TWO_CHAR_OPERATORS = new Set(['==', '!=', '>=', '<=', '&&', '||']);
const SINGLE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '%', '>', '<', '=', '!']);

/** Tokenises a formula expression. */
export function tokenizeFormula(input: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;

  const push = (type: TokenType, value: string, position: number): void => {
    tokens.push({ type, value, position });
  };

  while (index < input.length) {
    const char = input[index] ?? '';

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // Numbers: 12, 12.5, .5, 1e3, 2.5E-2
    const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(index));
    if (numberMatch && numberMatch[0]) {
      push(TokenType.Number, numberMatch[0], index);
      index += numberMatch[0].length;
      continue;
    }

    // Strings: "..." or '...' with escape sequences.
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let value = '';
      let closed = false;
      while (index < input.length) {
        const current = input[index] ?? '';
        if (current === '\\') {
          const next = input[index + 1] ?? '';
          switch (next) {
            case 'n':
              value += '\n';
              break;
            case 't':
              value += '\t';
              break;
            case 'r':
              value += '\r';
              break;
            case '\\':
              value += '\\';
              break;
            case '"':
              value += '"';
              break;
            case "'":
              value += "'";
              break;
            case 'u': {
              const hex = input.slice(index + 2, index + 6);
              if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                value += String.fromCharCode(parseInt(hex, 16));
                index += 4;
              } else {
                value += 'u';
              }
              break;
            }
            default:
              value += next;
          }
          index += 2;
          continue;
        }
        if (current === quote) {
          closed = true;
          index += 1;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) {
        throw new FormulaSyntaxError('Unterminated string literal', start);
      }
      push(TokenType.String, value, start);
      continue;
    }

    // Identifiers / keywords.
    const identifierMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(index));
    if (identifierMatch && identifierMatch[0]) {
      const raw = identifierMatch[0];
      const type = raw.toLowerCase() === 'prop' ? TokenType.Prop : TokenType.Identifier;
      push(type, raw.toLowerCase(), index);
      index += raw.length;
      continue;
    }

    // Operators.
    const twoChar = input.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.has(twoChar)) {
      push(TokenType.Operator, twoChar, index);
      index += 2;
      continue;
    }
    if (SINGLE_CHAR_OPERATORS.has(char)) {
      push(TokenType.Operator, char, index);
      index += 1;
      continue;
    }

    switch (char) {
      case '(':
        push(TokenType.LParen, char, index);
        index += 1;
        continue;
      case ')':
        push(TokenType.RParen, char, index);
        index += 1;
        continue;
      case ',':
        push(TokenType.Comma, char, index);
        index += 1;
        continue;
      case '[':
        push(TokenType.LBracket, char, index);
        index += 1;
        continue;
      case ']':
        push(TokenType.RBracket, char, index);
        index += 1;
        continue;
      default:
        throw new FormulaSyntaxError(
          `Unexpected character "${char}" in formula`,
          index,
        );
    }
  }

  push(TokenType.EOF, '', input.length);
  return tokens;
}
