/**
 * Property registry: the single source of truth for collection property types.
 *
 * Every property type declares how it is created, formatted, validated and
 * compared. Views and the query engine both go through this registry so a
 * `number` cell is formatted and sorted identically everywhere.
 */

import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import type {
  CollectionProperty,
  DateFormat,
  NumberFormat,
  OptionColor,
  PropertyType,
  RichText,
} from '@votion/types';
import { richTextToString } from '../types.js';

/** Editor kinds used by the table cell editor. */
export type PropertyEditorKind =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'file'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'readonly';

/** Options accepted by cell formatters. */
export interface FormatOptions {
  locale?: string;
  now?: Date;
}

/** Behavioural definition of one property type. */
export interface PropertyTypeDefinition {
  type: PropertyType;
  label: string;
  editor: PropertyEditorKind;
  /** Whether the value is computed by the engine and cannot be edited. */
  computed: boolean;
  /** Whether the table footer can aggregate this property. */
  aggregatable: boolean;
  defaultValue: () => unknown;
  format: (value: unknown, property: CollectionProperty, options?: FormatOptions) => string;
  validate: (value: unknown, property: CollectionProperty) => string | null;
  isEmpty: (value: unknown) => boolean;
  toComparable: (value: unknown, property: CollectionProperty) => string | number | null;
}

/** Canonical option colour order used when generating default options. */
export const OPTION_COLORS: readonly OptionColor[] = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

/** Lucide icon name associated with each property type. */
export const PROPERTY_TYPE_ICONS: Record<PropertyType, string> = {
  title: 'Type',
  text: 'AlignLeft',
  number: 'Hash',
  select: 'ChevronDownCircle',
  multi_select: 'ListChecks',
  status: 'CircleDot',
  date: 'Calendar',
  person: 'User',
  file: 'Paperclip',
  checkbox: 'CheckSquare',
  url: 'Link',
  email: 'Mail',
  phone_number: 'Phone',
  formula: 'Sigma',
  relation: 'ArrowLeftRight',
  rollup: 'Calculator',
  created_time: 'Clock',
  created_by: 'UserPlus',
  last_edited_time: 'History',
  last_edited_by: 'UserCog',
  unique_id: 'Fingerprint',
};

/** Empty rich-text value. */
function emptyRichText(): RichText {
  return [];
}

/** Parses any accepted date value into a `Date`, or `null`. */
export function toDate(value: unknown, now: Date = new Date()): Date | null {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return isValid(value) ? value : null;
  }
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return isValid(fromNumber) ? fromNumber : null;
  }
  if (typeof value === 'string') {
    const parsed = parseISO(value);
    if (isValid(parsed)) {
      return parsed;
    }
    const fallback = new Date(value);
    return isValid(fallback) ? fallback : null;
  }
  if (typeof value === 'object' && 'start' in (value as Record<string, unknown>)) {
    return toDate((value as { start: unknown }).start, now);
  }
  return null;
}

/** Extracts the inclusive start timestamp of a date value. */
export function toTimestamp(value: unknown): number | null {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

/** Extracts the exclusive end timestamp of a date range value. */
export function toEndTimestamp(value: unknown): number | null {
  if (value != null && typeof value === 'object' && 'end' in (value as object)) {
    const end = (value as { end?: unknown }).end;
    if (end != null && end !== '') {
      return toTimestamp(end);
    }
  }
  return toTimestamp(value);
}

function formatNumberValue(
  value: number,
  numberFormat: NumberFormat | undefined,
  locale = 'en-US',
): string {
  switch (numberFormat) {
    case 'percent':
      return `${(value * 100).toFixed(2).replace(/\.00$/, '')}%`;
    case 'dollar':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
      }).format(value);
    case 'euro':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EUR',
      }).format(value);
    case 'pound':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'GBP',
      }).format(value);
    case 'yen':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'JPY',
      }).format(value);
    case 'rupee':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'INR',
      }).format(value);
    case 'bitcoin':
      return `${value} BTC`;
    case 'progress': {
      const pct = Math.max(0, Math.min(100, value * 100));
      return `${pct.toFixed(0)}%`;
    }
    case 'number_with_commas':
      return new Intl.NumberFormat(locale).format(value);
    case 'number':
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
  }
}

/** Maps a date format preset to a date-fns pattern. */
export function datePattern(dateFormat: DateFormat | undefined): string {
  switch (dateFormat) {
    case 'short':
      return 'PP';
    case 'month_day_year':
      return 'MMMM d, yyyy';
    case 'day_month_year':
      return 'd MMMM yyyy';
    case 'year_month_day':
      return 'yyyy-MM-dd';
    case 'full':
      return 'PP p';
    case 'relative':
    default:
      return 'PP';
  }
}

function formatDateValue(
  value: unknown,
  property: CollectionProperty,
  options?: FormatOptions,
): string {
  const date = toDate(value, options?.now);
  if (!date) {
    return '';
  }
  if (property.date_format === 'relative') {
    return formatDistanceToNow(date, {
      addSuffix: true,
      ...(options?.now ? { now: options.now } : {}),
    });
  }
  try {
    return format(date, datePattern(property.date_format));
  } catch {
    return date.toISOString();
  }
}

function optionLabel(property: CollectionProperty, value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const option = property.options?.find((candidate) => candidate.id === value);
  return option ? option.value : value;
}

function isRichText(value: unknown): value is RichText {
  return Array.isArray(value);
}

function richTextOrString(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (isRichText(value)) {
    return richTextToString(value);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => richTextOrString(entry)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object' && 'url' in (value as Record<string, unknown>)) {
    return String((value as { url?: unknown }).url ?? '');
  }
  return '';
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object' && 'start' in (value as Record<string, unknown>)) {
    return (value as { start?: unknown }).start == null;
  }
  return false;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateOption(property: CollectionProperty, value: unknown): string | null {
  if (value == null || value === '') {
    return null;
  }
  const options = property.options ?? [];
  if (typeof value === 'string') {
    const exists =
      options.some((option) => option.id === value) ||
      options.some((option) => option.value === value);
    return exists ? null : `Unknown option "${value}"`;
  }
  return 'Expected an option id or value';
}

function validateMultiOption(property: CollectionProperty, value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    return 'Expected a list of option ids';
  }
  for (const entry of value) {
    const error = validateOption(property, entry);
    if (error) {
      return error;
    }
  }
  return null;
}

function textComparable(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (isRichText(value)) {
    return richTextToString(value).toLowerCase();
  }
  return String(value).toLowerCase();
}

function optionIndex(property: CollectionProperty, value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const index = (property.options ?? []).findIndex(
    (option) => option.id === value || option.value === value,
  );
  return index >= 0 ? index : null;
}

function multiOptionIndexes(property: CollectionProperty, value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => optionIndex(property, entry))
    .filter((index): index is number => index !== null)
    .sort((a, b) => a - b);
}

function relationComparable(value: unknown): number | string | null {
  if (Array.isArray(value)) {
    return value.length;
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

/**
 * The registry. Keyed by {@link PropertyType}; every entry is complete so the
 * UI can render a property without special-casing.
 */
export const PROPERTY_TYPE_REGISTRY: Record<PropertyType, PropertyTypeDefinition> = {
  title: {
    type: 'title',
    label: 'Title',
    editor: 'title',
    computed: false,
    aggregatable: false,
    defaultValue: emptyRichText,
    format: (_value, property, _options) => richTextOrString(_value) || property.name,
    validate: () => null,
    isEmpty: (value) => isEmptyValue(value) || richTextOrString(value).trim() === '',
    toComparable: (value) => textComparable(value),
  },
  text: {
    type: 'text',
    label: 'Text',
    editor: 'text',
    computed: false,
    aggregatable: false,
    defaultValue: emptyRichText,
    format: (value) => richTextOrString(value),
    validate: () => null,
    isEmpty: (value) => isEmptyValue(value) || richTextOrString(value).trim() === '',
    toComparable: (value) => textComparable(value),
  },
  number: {
    type: 'number',
    label: 'Number',
    editor: 'number',
    computed: false,
    aggregatable: true,
    defaultValue: () => null,
    format: (value, property, options) => {
      const numeric = toNumberOrNull(value);
      return numeric == null
        ? ''
        : formatNumberValue(numeric, property.number_format, options?.locale);
    },
    validate: (value) => {
      if (value == null || value === '') {
        return null;
      }
      return toNumberOrNull(value) == null ? 'Expected a number' : null;
    },
    isEmpty: (value) => value == null || value === '' || toNumberOrNull(value) == null,
    toComparable: (value) => toNumberOrNull(value),
  },
  select: {
    type: 'select',
    label: 'Select',
    editor: 'select',
    computed: false,
    aggregatable: false,
    defaultValue: () => null,
    format: (value, property) => optionLabel(property, value),
    validate: (value, property) => validateOption(property, value),
    isEmpty: (value) => value == null || value === '',
    toComparable: (value, property) => optionIndex(property, value),
  },
  multi_select: {
    type: 'multi_select',
    label: 'Multi-select',
    editor: 'multi_select',
    computed: false,
    aggregatable: false,
    defaultValue: () => [],
    format: (value, property) => {
      if (!Array.isArray(value)) {
        return '';
      }
      return value.map((entry) => optionLabel(property, entry)).filter(Boolean).join(', ');
    },
    validate: (value, property) => validateMultiOption(property, value),
    isEmpty: (value) => !Array.isArray(value) || value.length === 0,
    toComparable: (value, property) => multiOptionIndexes(property, value)[0] ?? null,
  },
  status: {
    type: 'status',
    label: 'Status',
    editor: 'status',
    computed: false,
    aggregatable: false,
    defaultValue: () => null,
    format: (value, property) => optionLabel(property, value),
    validate: (value, property) => validateOption(property, value),
    isEmpty: (value) => value == null || value === '',
    toComparable: (value, property) => optionIndex(property, value),
  },
  date: {
    type: 'date',
    label: 'Date',
    editor: 'date',
    computed: false,
    aggregatable: false,
    defaultValue: () => null,
    format: (value, property, options) => formatDateValue(value, property, options),
    validate: (value) => {
      if (value == null || value === '') {
        return null;
      }
      if (typeof value === 'object' && 'start' in (value as Record<string, unknown>)) {
        return toDate((value as { start: unknown }).start) ? null : 'Invalid date';
      }
      return toDate(value) ? null : 'Invalid date';
    },
    isEmpty: (value) => toDate(value) == null,
    toComparable: (value) => toTimestamp(value),
  },
  person: {
    type: 'person',
    label: 'Person',
    editor: 'person',
    computed: false,
    aggregatable: false,
    defaultValue: () => [],
    format: (value) => {
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry)).join(', ');
      }
      return value == null ? '' : String(value);
    },
    validate: (value) => {
      if (value == null) {
        return null;
      }
      return Array.isArray(value) || typeof value === 'string'
        ? null
        : 'Expected a person id or list of person ids';
    },
    isEmpty: (value) =>
      value == null || (Array.isArray(value) && value.length === 0) || value === '',
    toComparable: (value) => (Array.isArray(value) ? value.length : value == null ? null : 1),
  },
  file: {
    type: 'file',
    label: 'Files',
    editor: 'file',
    computed: false,
    aggregatable: false,
    defaultValue: () => [],
    format: (value) => {
      if (!Array.isArray(value)) {
        return '';
      }
      return value
        .map((entry) =>
          typeof entry === 'object' && entry != null && 'name' in entry
            ? String((entry as { name?: unknown }).name ?? '')
            : '',
        )
        .filter(Boolean)
        .join(', ');
    },
    validate: () => null,
    isEmpty: (value) => !Array.isArray(value) || value.length === 0,
    toComparable: (value) => (Array.isArray(value) ? value.length : null),
  },
  checkbox: {
    type: 'checkbox',
    label: 'Checkbox',
    editor: 'checkbox',
    computed: false,
    aggregatable: true,
    defaultValue: () => false,
    format: (value) => (value === true ? 'Yes' : value === false ? 'No' : ''),
    validate: (value) =>
      value == null || typeof value === 'boolean' ? null : 'Expected a boolean',
    isEmpty: () => false,
    toComparable: (value) => (value === true ? 1 : value === false ? 0 : null),
  },
  url: {
    type: 'url',
    label: 'URL',
    editor: 'url',
    computed: false,
    aggregatable: false,
    defaultValue: () => null,
    format: (value) => (value == null ? '' : String(value)),
    validate: (value) => {
      if (value == null || value === '') {
        return null;
      }
      return /^https?:\/\/.+/i.test(String(value)) ? null : 'Expected an http(s) URL';
    },
    isEmpty: (value) => value == null || value === '',
    toComparable: (value) => (value == null ? null : String(value).toLowerCase()),
  },
  email: {
    type: 'email',
    label: 'Email',
    editor: 'email',
    computed: false,
    aggregatable: false,
    defaultValue: () => null,
    format: (value) => (value == null ? '' : String(value)),
    validate: (value) => {
      if (value == null || value === '') {
        return null;
      }
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)) ? null : 'Invalid email';
    },
    isEmpty: (value) => value == null || value === '',
    toComparable: (value) => (value == null ? null : String(value).toLowerCase()),
  },
  phone_number: {
    type: 'phone_number',
    label: 'Phone',
    editor: 'phone',
    computed: false,
    aggregatable: false,
    defaultValue: () => null,
    format: (value) => (value == null ? '' : String(value)),
    validate: () => null,
    isEmpty: (value) => value == null || value === '',
    toComparable: (value) => (value == null ? null : String(value)),
  },
  formula: {
    type: 'formula',
    label: 'Formula',
    editor: 'readonly',
    computed: true,
    aggregatable: true,
    defaultValue: () => null,
    format: (value) => richTextOrString(value),
    validate: () => null,
    isEmpty: (value) => isEmptyValue(value),
    toComparable: (value) => {
      const numeric = toNumberOrNull(value);
      return numeric ?? textComparable(value);
    },
  },
  relation: {
    type: 'relation',
    label: 'Relation',
    editor: 'readonly',
    computed: false,
    aggregatable: false,
    defaultValue: () => [],
    format: (value) => {
      if (Array.isArray(value)) {
        return `${value.length} linked`;
      }
      return value == null ? '' : String(value);
    },
    validate: (value) =>
      value == null || Array.isArray(value) ? null : 'Expected a list of record ids',
    isEmpty: (value) => !Array.isArray(value) || value.length === 0,
    toComparable: (value) => relationComparable(value),
  },
  rollup: {
    type: 'rollup',
    label: 'Rollup',
    editor: 'readonly',
    computed: true,
    aggregatable: true,
    defaultValue: () => null,
    format: (value) => richTextOrString(value),
    validate: () => null,
    isEmpty: (value) => isEmptyValue(value),
    toComparable: (value) => {
      const numeric = toNumberOrNull(value);
      return numeric ?? textComparable(value);
    },
  },
  created_time: {
    type: 'created_time',
    label: 'Created time',
    editor: 'readonly',
    computed: true,
    aggregatable: false,
    defaultValue: () => null,
    format: (value, property, options) =>
      value == null ? '' : formatDateValue(value, property, options),
    validate: () => null,
    isEmpty: (value) => value == null,
    toComparable: (value) => toTimestamp(value),
  },
  created_by: {
    type: 'created_by',
    label: 'Created by',
    editor: 'readonly',
    computed: true,
    aggregatable: false,
    defaultValue: () => null,
    format: (value) => (value == null ? '' : String(value)),
    validate: () => null,
    isEmpty: (value) => value == null || value === '',
    toComparable: (value) => (value == null ? null : String(value)),
  },
  last_edited_time: {
    type: 'last_edited_time',
    label: 'Last edited time',
    editor: 'readonly',
    computed: true,
    aggregatable: false,
    defaultValue: () => null,
    format: (value, property, options) =>
      value == null ? '' : formatDateValue(value, property, options),
    validate: () => null,
    isEmpty: (value) => value == null,
    toComparable: (value) => toTimestamp(value),
  },
  last_edited_by: {
    type: 'last_edited_by',
    label: 'Last edited by',
    editor: 'readonly',
    computed: true,
    aggregatable: false,
    defaultValue: () => null,
    format: (value) => (value == null ? '' : String(value)),
    validate: () => null,
    isEmpty: (value) => value == null || value === '',
    toComparable: (value) => (value == null ? null : String(value)),
  },
  unique_id: {
    type: 'unique_id',
    label: 'Unique ID',
    editor: 'readonly',
    computed: true,
    aggregatable: false,
    defaultValue: () => null,
    format: (value) => (value == null ? '' : String(value)),
    validate: () => null,
    isEmpty: (value) => value == null || value === '',
    toComparable: (value) => (value == null ? null : String(value)),
  },
};

/** Returns the definition for a property type. */
export function getPropertyTypeDefinition(type: PropertyType): PropertyTypeDefinition {
  const definition = PROPERTY_TYPE_REGISTRY[type];
  if (!definition) {
    throw new Error(`Unknown property type: ${String(type)}`);
  }
  return definition;
}

/** Creates a collection property with type-appropriate defaults. */
export function createProperty(
  type: PropertyType,
  name: string,
  overrides: Partial<CollectionProperty> = {},
): CollectionProperty {
  const base: CollectionProperty = { name, type };
  if (type === 'number' && !overrides.number_format) {
    base.number_format = 'number';
  }
  if (type === 'date' && !overrides.date_format) {
    base.date_format = 'month_day_year';
  }
  if (type === 'formula' && !overrides.formula) {
    base.formula = '';
  }
  if (type === 'status' && !overrides.groups) {
    base.groups = [
      { id: 'todo', name: 'To-do', color: 'gray', option_ids: [] },
      { id: 'in_progress', name: 'In progress', color: 'blue', option_ids: [] },
      { id: 'complete', name: 'Complete', color: 'green', option_ids: [] },
    ];
  }
  return { ...base, ...overrides };
}

/** Formats a property value for display. */
export function formatPropertyValue(
  value: unknown,
  property: CollectionProperty,
  options?: FormatOptions,
): string {
  return getPropertyTypeDefinition(property.type).format(value, property, options);
}

/** Validates a property value, returning an error message or `null`. */
export function validatePropertyValue(
  value: unknown,
  property: CollectionProperty,
): string | null {
  return getPropertyTypeDefinition(property.type).validate(value, property);
}

/** Returns `true` when a property value is empty. */
export function isPropertyValueEmpty(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === 'object' && 'start' in (value as Record<string, unknown>)) {
    return (value as { start?: unknown }).start == null;
  }
  return false;
}

/** Returns a comparable primitive for a property value, or `null` when empty. */
export function propertyValueToComparable(
  value: unknown,
  property: CollectionProperty,
): string | number | null {
  return getPropertyTypeDefinition(property.type).toComparable(value, property);
}

/** Creates a default value for a property type. */
export function defaultPropertyValue(type: PropertyType): unknown {
  return getPropertyTypeDefinition(type).defaultValue();
}

/** Returns the default options for a select/status property. */
export function createDefaultOptions(count = 3): { id: string; value: string; color: OptionColor }[] {
  const labels = ['Option 1', 'Option 2', 'Option 3', 'Option 4', 'Option 5'];
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    id: `option_${index + 1}_${Math.random().toString(36).slice(2, 8)}`,
    value: labels[index] ?? `Option ${index + 1}`,
    color: OPTION_COLORS[index % OPTION_COLORS.length] ?? 'default',
  }));
}
