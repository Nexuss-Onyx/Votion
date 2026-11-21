/**
 * Primitive & graph-level identifier contracts shared by every Votion entity.
 *
 * These aliases are intentionally structural (not nominal) so that records can
 * cross the client/server boundary as plain JSON without casting.
 */

/** Canonical unique identifier (UUID v4) used across all Votion records. */
export type UUID = string;

/** Epoch milliseconds (UTC) timestamp used by the client data model. */
export type Timestamp = number;

/** ISO-8601 calendar date or date-time string (e.g. `2026-11-21`). */
export type ISODateString = string;

/** URL pointing at an external resource (hyperlink, media source, cover art). */
export type URLString = string;

/** Emoji glyph, uploaded image URL, or inline SVG string used as an icon. */
export type IconString = string;

/** Scalar values permitted inside a JSON document. */
export type JsonPrimitive = string | number | boolean | null;

/** Any value that survives `JSON.parse(JSON.stringify(value))` unchanged. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Plain JSON object (the canonical shape of a JSONB column payload). */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Soft-deletable record marker: Votion never hard-deletes user content. */
export interface AliveRecord {
  alive: boolean;
}

/** Record carrying its canonical identifier. */
export interface Identified {
  id: UUID;
}

/** Record carrying an optimistic-concurrency version counter. */
export interface Versioned {
  version: number;
}

/** Audit metadata attached to every persisted record. */
export interface AuditedRecord {
  created_time: Timestamp;
  last_edited_time: Timestamp;
  created_by_id: UUID;
  last_edited_by_id: UUID;
}

/** Base record shape shared by every persisted Votion entity. */
export interface VotionRecord extends Identified, AliveRecord {}

/**
 * Logical table a record lives in. Mirrors the PostgreSQL tables owned by
 * `@votion/db` while staying low-case/snake-case on the wire.
 */
export type RecordTable =
  | 'block'
  | 'collection'
  | 'collection_view'
  | 'space'
  | 'permission';

/** Table names that may be addressed by a transaction operation pointer. */
export type OperationTable = Exclude<RecordTable, 'permission'>;

/** Discriminated union of the tables a block may be parented to. */
export type ParentTable = 'block' | 'collection' | 'space';

/** Deep-partial helper used for JSONB patch payloads. */
export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Extracts the element type of an array (readonly-safe). */
export type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;

/** Compile-time exhaustiveness guard: fails to compile if a case is missed. */
export function assertNever(value: never, message = 'Unhandled variant'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
