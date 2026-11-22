/**
 * Formula runtime values and safe coercion helpers.
 *
 * The evaluator never touches `eval`, `Function`, or dynamic property access on
 * arbitrary objects. All conversions are explicit and type-checked.
 */

import { isValid, parseISO } from 'date-fns';
import type { PropertyType, RichText } from '@votion/types';
import { richTextToString } from '../types.js';

/** Thrown for runtime formula errors (unknown function, type mismatch, ...). */
export class FormulaError extends Error {
  constructor(
    message: string,
    public position?: number,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

/** Opaque date value used inside formulas. */
export class FormulaDate {
  constructor(public readonly epochMs: number) {}

  /** Parses any accepted date representation, returning `null` when invalid. */
  static from(value: unknown): FormulaDate | null {
    if (value instanceof FormulaDate) {
      return value;
    }
    if (value instanceof Date) {
      return isValid(value) ? new FormulaDate(value.getTime()) : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value);
      return isValid(date) ? new FormulaDate(date.getTime()) : null;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = parseISO(value);
      if (isValid(parsed)) {
        return new FormulaDate(parsed.getTime());
      }
      const fallback = new Date(value);
      return isValid(fallback) ? new FormulaDate(fallback.getTime()) : null;
    }
    return null;
  }

  valueOf(): number {
    return this.epochMs;
  }

  getTime(): number {
    return this.epochMs;
  }

  toISOString(): string {
    return new Date(this.epochMs).toISOString();
  }

  toString(): string {
    return this.toISOString();
  }
}

/** Every runtime value a formula can produce. */
export type FormulaValue =
  | number
  | string
  | boolean
  | null
  | FormulaDate
  | FormulaValue[];

/** Returns `true` for formula date values. */
export function isFormulaDate(value: unknown): value is FormulaDate {
  return value instanceof FormulaDate;
}

/** Converts a raw stored property value into a formula runtime value. */
export function toFormulaValue(value: unknown, type?: PropertyType): FormulaValue {
  if (value == null) {
    return null;
  }
  if (value instanceof FormulaDate) {
    return value;
  }
  if (value instanceof Date) {
    return FormulaDate.from(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (
      type === 'date' ||
      type === 'created_time' ||
      type === 'last_edited_time'
    ) {
      const date = FormulaDate.from(value);
      return date ?? value;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      return richTextToString(value as RichText);
    }
    return value.map((entry) => toFormulaValue(entry));
  }
  if (typeof value === 'object' && 'start' in (value as Record<string, unknown>)) {
    const start = (value as { start?: unknown }).start;
    const date = FormulaDate.from(start);
    return date ?? null;
  }
  return null;
}

/** Converts a formula runtime value back to a JSON-safe value. */
export function fromFormulaValue(value: FormulaValue): unknown {
  if (value instanceof FormulaDate) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => fromFormulaValue(entry));
  }
  return value;
}

/** Coerces a formula value to a finite number, or `null`. */
export function formulaToNumber(value: FormulaValue): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value instanceof FormulaDate) {
    return value.epochMs;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Coerces a formula value to a display string. */
export function formulaToString(value: FormulaValue): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof FormulaDate) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formulaToString(entry)).join(', ');
  }
  return '';
}

/** Truthiness used by `if`, `and`, `or`, `not`. */
export function formulaTruthy(value: FormulaValue): boolean {
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

/** Structural equality, with date and list support. */
export function formulaEquals(left: FormulaValue, right: FormulaValue): boolean {
  if (left instanceof FormulaDate || right instanceof FormulaDate) {
    const a = left instanceof FormulaDate ? left.epochMs : null;
    const b = right instanceof FormulaDate ? right.epochMs : null;
    if (a != null && b != null) {
      return a === b;
    }
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => formulaEquals(entry, right[index] as FormulaValue));
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return false;
  }
  return left === right;
}
