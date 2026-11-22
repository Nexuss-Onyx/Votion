/**
 * Shared presentation helpers for the six projections.
 */

import type { JSX } from 'react';
import type {
  CollectionProperty,
  CollectionSchema,
  OptionColor,
  PropertyOption,
} from '@votion/types';
import { formatPropertyValue } from '../schema/PropertyRegistry.js';
import type { DatabaseRecord } from '../types.js';
import { useCellValue } from './engineContext.js';

/** Inline colour swatches for option badges. */
export const OPTION_COLOR_HEX: Record<OptionColor, string> = {
  default: '#9b9b9b',
  gray: '#9b9b9b',
  brown: '#a5795e',
  orange: '#d9730d',
  yellow: '#cb912f',
  green: '#448361',
  blue: '#337ea9',
  purple: '#9065b0',
  pink: '#c14c8a',
  red: '#d44c47',
};

/** Resolves an option by id or display value. */
export function findOption(
  property: CollectionProperty,
  value: unknown,
): PropertyOption | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return (
    property.options?.find((option) => option.id === value) ??
    property.options?.find(
      (option) => option.value.toLowerCase() === value.toLowerCase(),
    )
  );
}

/** Small coloured tag used for select/status/multi-select values. */
export function OptionBadge({
  property,
  value,
}: {
  property: CollectionProperty;
  value: unknown;
}): JSX.Element | null {
  const option = findOption(property, value);
  const label = option ? option.value : typeof value === 'string' ? value : '';
  if (!label) {
    return null;
  }
  const color = option?.color ?? 'default';
  return (
    <span className="votion-option-badge" style={{ color: OPTION_COLOR_HEX[color] }}>
      <span
        className="votion-option-dot"
        style={{ backgroundColor: OPTION_COLOR_HEX[color] }}
      />
      {label}
    </span>
  );
}

/** Renders a property value for a record, including computed properties. */
export function CellValue({
  record,
  schema,
  propertyId,
  property,
}: {
  record: DatabaseRecord;
  schema: CollectionSchema;
  propertyId: string;
  property: CollectionProperty;
}): JSX.Element {
  const value = useCellValue(record, schema, propertyId, property);
  const text = formatPropertyValue(value, property);
  return <span title={text}>{text}</span>;
}

/** Returns a plain display string for a property value. */
export function displayValue(
  value: unknown,
  property: CollectionProperty,
): string {
  return formatPropertyValue(value, property);
}

/** Renders a list of option badges. */
export function OptionBadgeList({
  property,
  values,
}: {
  property: CollectionProperty;
  values: unknown;
}): JSX.Element | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  return (
    <span className="votion-option-badge-list">
      {values.map((value, index) => (
        <OptionBadge key={`${String(value)}-${index}`} property={property} value={value} />
      ))}
    </span>
  );
}
