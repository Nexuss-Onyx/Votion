/**
 * Bidirectional mappers between Votion records and Notion API objects.
 *
 * Votion stores blocks/collections in its own compact JSONB shapes; the public
 * `/v1` API speaks Notion's wire format so unmodified Notion SDKs, Zapier,
 * Make and n8n can connect. Every function here is pure and deterministic.
 */

import { randomUUID } from 'node:crypto';

import type {
  BlockFormat,
  BlockProperties,
  BlockType,
  CollectionProperty,
  CollectionSchema,
  OptionColor,
  ParentTable,
  PropertyOption,
  PropertyType,
  RichText,
  TextModifier,
  UUID,
} from '@votion/types';
import { isRichText, plainTextToRichText, richTextToPlainText } from '@votion/types';


import type { BlockRecord, CollectionRecord } from '../../store/types.js';

// ---------------------------------------------------------------------------
// Notion wire types
// ---------------------------------------------------------------------------

export interface NotionTextLink {
  url: string;
}

export interface NotionTextContent {
  content: string;
  link?: NotionTextLink | null;
}

export interface NotionAnnotations {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  underline: boolean;
  code: boolean;
  color: string;
}

export interface NotionRichTextItem {
  type: 'text' | 'mention' | 'equation';
  text?: NotionTextContent;
  annotations?: NotionAnnotations;
  plain_text?: string;
  href?: string | null;
  [key: string]: unknown;
}

export interface NotionUserObject {
  object: 'user';
  id: string;
}

export type NotionParent =
  | { type: 'database_id'; database_id: UUID }
  | { type: 'page_id'; page_id: UUID }
  | { type: 'workspace'; workspace: true };

export interface NotionBlockObject {
  object: 'block';
  id: UUID;
  parent: NotionParent;
  created_time: string;
  last_edited_time: string;
  created_by: NotionUserObject;
  last_edited_by: NotionUserObject;
  has_children: boolean;
  archived: boolean;
  type: string;
  [key: string]: unknown;
}

export interface NotionPageObject {
  object: 'page';
  id: UUID;
  created_time: string;
  last_edited_time: string;
  created_by: NotionUserObject;
  last_edited_by: NotionUserObject;
  cover: unknown;
  icon: unknown;
  parent: NotionParent;
  archived: boolean;
  in_trash: boolean;
  url: string;
  public_url: null;
  properties: Record<string, unknown>;
}

export interface NotionDatabaseObject {
  object: 'database';
  id: UUID;
  created_time: string;
  last_edited_time: string;
  created_by: NotionUserObject;
  last_edited_by: NotionUserObject;
  title: NotionRichTextItem[];
  description: NotionRichTextItem[];
  icon: unknown;
  cover: unknown;
  parent: NotionParent;
  archived: boolean;
  is_inline: boolean;
  properties: Record<string, unknown>;
  url: string;
}

/** Public base URL used for generated record URLs. */
export const PUBLIC_URL = 'https://votion.app';

function iso(date: Date): string {
  return date.toISOString();
}

function asRichText(value: unknown): RichText {
  if (isRichText(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return plainTextToRichText(value);
  }
  if (Array.isArray(value)) {
    return value as RichText;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

const DEFAULT_ANNOTATIONS: NotionAnnotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default',
};

/** Converts Votion rich text into Notion rich text items. */
export function toNotionRichText(value: unknown): NotionRichTextItem[] {
  const richText = asRichText(value);
  const result: NotionRichTextItem[] = [];
  for (const segment of richText) {
    const content = typeof segment?.[0] === 'string' ? segment[0] : '';
    const annotations: NotionAnnotations = { ...DEFAULT_ANNOTATIONS };
    let link: string | null = null;
    for (const modifier of segment?.[1] ?? []) {
      const [tag, argument] = modifier as unknown as [string, unknown];
      if (typeof tag !== 'string') {
        continue;
      }
      switch (tag) {
        case 'b':
          annotations.bold = true;
          break;
        case 'i':
          annotations.italic = true;
          break;
        case 's':
          annotations.strikethrough = true;
          break;
        case '_':
          annotations.underline = true;
          break;
        case 'c':
          annotations.code = true;
          break;
        case 'h':
          if (typeof argument === 'string') {
            annotations.color = argument;
          }
          break;
        case 'a':
          if (typeof argument === 'string') {
            link = argument;
          }
          break;
        default:
          break;
      }
    }
    result.push({
      type: 'text',
      text: { content, link: link ? { url: link } : null },
      annotations,
      plain_text: content,
      href: link,
    });
  }
  return result;
}

/** Converts Notion rich text items into Votion rich text. */
export function toVotionRichText(value: unknown): RichText {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: RichText = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as NotionRichTextItem;
    const content =
      record.plain_text ??
      (typeof record.text?.content === 'string' ? record.text.content : '');
    const annotations = (record.annotations ?? {}) as Partial<NotionAnnotations>;
    const modifiers: TextModifier[] = [];
    if (annotations.bold) modifiers.push(['b']);
    if (annotations.italic) modifiers.push(['i']);
    if (annotations.strikethrough) modifiers.push(['s']);
    if (annotations.underline) modifiers.push(['_']);
    if (annotations.code) modifiers.push(['c']);
    if (annotations.color && annotations.color !== 'default') {
      modifiers.push(['h', annotations.color as never]);
    }
    const link = record.text?.link?.url ?? (typeof record.href === 'string' ? record.href : null);
    if (link) modifiers.push(['a', link]);
    result.push(modifiers.length > 0 ? [content, modifiers] : [content]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Notion block type → Votion block type. */
const VOTION_TYPE_BY_NOTION: Record<string, BlockType> = {
  paragraph: 'text',
  child_page: 'page',
  child_database: 'collection_view',
  heading_1: 'heading_1',
  heading_2: 'heading_2',
  heading_3: 'heading_3',
  bulleted_list_item: 'bulleted_list_item',
  numbered_list_item: 'numbered_list_item',
  to_do: 'to_do',
  toggle: 'toggle',
  quote: 'quote',
  callout: 'callout',
  divider: 'divider',
  code: 'code',
  math: 'math',
  image: 'image',
  video: 'video',
  audio: 'audio',
  file: 'file',
  pdf: 'pdf',
  bookmark: 'bookmark',
  embed: 'embed',
  synced_block: 'synced_block',
  table: 'table',
  table_row: 'table',
  column_list: 'column_list',
  column: 'column',
};

/** Votion block type → Notion block type. */
const NOTION_TYPE_BY_VOTION: Record<string, string> = {
  page: 'child_page',
  text: 'paragraph',
  collection_view: 'child_database',
};

/** Maps a Notion block type string onto a Votion block type. */
export function notionBlockTypeToVotion(type: string): BlockType | null {
  return VOTION_TYPE_BY_NOTION[type] ?? null;
}

/** Maps a Votion block type onto a Notion block type. */
export function votionBlockTypeToNotion(type: BlockType): string {
  return NOTION_TYPE_BY_VOTION[type] ?? type;
}

/** Text-like Votion block types carrying a `title` rich-text payload. */
const TEXT_LIKE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'toggle',
  'quote',
  'callout',
  'code',
]);

/** Media types whose payload is a single source URL. */
const MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image',
  'video',
  'audio',
  'file',
  'pdf',
  'bookmark',
  'embed',
]);

function toNotionParent(parentId: UUID, parentTable: ParentTable): NotionParent {
  if (parentTable === 'collection') {
    return { type: 'database_id', database_id: parentId };
  }
  if (parentTable === 'block') {
    return { type: 'page_id', page_id: parentId };
  }
  return { type: 'workspace', workspace: true };
}

function toNotionUser(id: UUID | null): NotionUserObject {
  return { object: 'user', id: id ?? '' };
}

function mediaUrl(payload: Record<string, unknown>): string {
  const external = payload['external'];
  if (external && typeof external === 'object') {
    const url = (external as Record<string, unknown>)['url'];
    if (typeof url === 'string') return url;
  }
  const file = payload['file'];
  if (file && typeof file === 'object') {
    const url = (file as Record<string, unknown>)['url'];
    if (typeof url === 'string') return url;
  }
  if (typeof payload['url'] === 'string') return payload['url'];
  if (typeof payload['source'] === 'string') return payload['source'];
  return '';
}

function sourceFromProperties(block: BlockRecord): string {
  const source = block.properties['source'];
  if (typeof source === 'string') return source;
  if (Array.isArray(source) && Array.isArray(source[0]) && typeof source[0][0] === 'string') {
    return source[0][0];
  }
  if (source && typeof source === 'object') {
    const url = (source as unknown as Record<string, unknown>)['url'];
    if (typeof url === 'string') return url;
  }
  return '';
}

function captionFromProperties(block: BlockRecord): NotionRichTextItem[] {
  return toNotionRichText(block.properties['caption']);
}

function codeLanguage(block: BlockRecord): string {
  const language = block.properties['language'];
  if (typeof language === 'string') return language;
  if (Array.isArray(language) && Array.isArray(language[0]) && typeof language[0][0] === 'string') {
    return language[0][0];
  }
  return 'plain text';
}

function todoChecked(block: BlockRecord): boolean {
  const checked = block.properties['checked'];
  if (typeof checked === 'boolean') return checked;
  if (Array.isArray(checked) && Array.isArray(checked[0])) {
    return checked[0][0] === 'yes';
  }
  return false;
}

/** Builds the type-specific payload of a Notion block object. */
function notionBlockPayload(
  block: BlockRecord,
  collection?: CollectionRecord | null,
): Record<string, unknown> {
  const type = block.type;
  if (type === 'page') {
    return { child_page: { title: richTextToPlainText(asRichText(block.properties['title'])) } };
  }
  if (type === 'collection_view') {
    const title = collection ? richTextToPlainText(collection.name) : '';
    return { child_database: { title } };
  }
  if (type === 'divider') {
    return { divider: {} };
  }
  if (type === 'synced_block') {
    const syncedFrom = block.properties['synced_from_block_id'];
    return {
      synced_block:
        typeof syncedFrom === 'string'
          ? { synced_from: { type: 'block_id', block_id: syncedFrom } }
          : { synced_from: null },
    };
  }
  if (type === 'code') {
    return {
      code: {
        rich_text: toNotionRichText(block.properties['title']),
        language: codeLanguage(block),
        caption: captionFromProperties(block),
      },
    };
  }
  if (type === 'to_do') {
    return {
      to_do: {
        rich_text: toNotionRichText(block.properties['title']),
        checked: todoChecked(block),
        caption: captionFromProperties(block),
      },
    };
  }
  if (MEDIA_TYPES.has(type)) {
    const url = sourceFromProperties(block);
    return {
      [votionBlockTypeToNotion(type)]: {
        type: 'external',
        external: { url },
        caption: captionFromProperties(block),
      },
    };
  }
  if (TEXT_LIKE_TYPES.has(type)) {
    return {
      [votionBlockTypeToNotion(type)]: {
        rich_text: toNotionRichText(block.properties['title']),
        color: 'default',
      },
    };
  }
  return {
    [votionBlockTypeToNotion(type)]: {
      rich_text: toNotionRichText(block.properties['title']),
    },
  };
}

/** Converts a Votion block into a Notion block object. */
export function toNotionBlock(
  block: BlockRecord,
  options: { hasChildren?: boolean; collection?: CollectionRecord | null } = {},
): NotionBlockObject {
  return {
    object: 'block',
    id: block.id,
    parent: toNotionParent(block.parentId, block.parentTable),
    created_time: iso(block.createdTime),
    last_edited_time: iso(block.lastEditedTime),
    created_by: toNotionUser(block.createdById),
    last_edited_by: toNotionUser(block.lastEditedById),
    has_children: options.hasChildren ?? block.content.length > 0,
    archived: !block.alive,
    type: votionBlockTypeToNotion(block.type),
    ...notionBlockPayload(block, options.collection ?? null),
  };
}

// ---------------------------------------------------------------------------
// Property values
// ---------------------------------------------------------------------------

/** Maps a Votion property type onto Notion's property type name. */
export function notionPropertyType(type: PropertyType): string {
  switch (type) {
    case 'text':
      return 'rich_text';
    case 'person':
      return 'people';
    case 'file':
      return 'files';
    default:
      return type;
  }
}

function optionObject(
  property: CollectionProperty | undefined,
  name: string,
): { id: string; name: string; color: OptionColor } {
  const option = property?.options?.find((entry) => entry.value === name);
  if (option) {
    return { id: option.id, name: option.value, color: option.color };
  }
  return { id: name, name, color: 'default' };
}

function extractName(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') return first;
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['select', 'status', 'name', 'value']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
  }
  return null;
}

function extractMultiNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    const names: string[] = [];
    for (const entry of value) {
      const name = extractName(entry);
      if (name) names.push(name);
    }
    if (names.length > 0) return names;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const multi = record['multi_select'];
    if (Array.isArray(multi)) {
      return multi
        .map((entry) => (typeof entry === 'string' ? entry : extractName(entry)))
        .filter((entry): entry is string => typeof entry === 'string');
    }
  }
  return [];
}

function extractString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['url', 'email', 'phone_number', 'start', 'string', 'name']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
  }
  return null;
}

function extractChecked(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value) && Array.isArray(value[0])) {
    return value[0][0] === 'yes' || value[0][0] === true;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['checked'] === 'boolean') return record['checked'];
  }
  return false;
}

function extractNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['number'] === 'number') return record['number'];
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Converts a stored Votion property value into a Notion property value object. */
export function toNotionPropertyValue(
  type: PropertyType,
  value: unknown,
  property?: CollectionProperty,
): Record<string, unknown> {
  const notionType = notionPropertyType(type);
  switch (type) {
    case 'title':
    case 'text':
      return { [notionType]: toNotionRichText(value) };
    case 'number':
      return { number: extractNumber(value) };
    case 'select': {
      const name = extractName(value);
      return { select: name ? optionObject(property, name) : null };
    }
    case 'status': {
      const name = extractName(value);
      return { status: name ? optionObject(property, name) : null };
    }
    case 'multi_select': {
      const names = extractMultiNames(value);
      return {
        multi_select: names.map((name) => optionObject(property, name)),
      };
    }
    case 'date': {
      const start = extractString(value);
      const end =
        value && typeof value === 'object' && typeof (value as Record<string, unknown>)['end'] === 'string'
          ? ((value as Record<string, unknown>)['end'] as string)
          : null;
      return {
        date: start ? { start, end, time_zone: null } : null,
      };
    }
    case 'checkbox':
      return { checkbox: extractChecked(value) };
    case 'url':
      return { url: extractString(value) };
    case 'email':
      return { email: extractString(value) };
    case 'phone_number':
      return { phone_number: extractString(value) };
    case 'person': {
      const people = value && typeof value === 'object'
        ? (value as Record<string, unknown>)['people']
        : null;
      return {
        people: Array.isArray(people)
          ? people.map((entry) =>
              typeof entry === 'string'
                ? { object: 'user', id: entry }
                : { object: 'user', id: String((entry as Record<string, unknown>)['id'] ?? '') },
            )
          : [],
      };
    }
    case 'file': {
      const files = value && typeof value === 'object'
        ? (value as Record<string, unknown>)['files']
        : null;
      return { files: Array.isArray(files) ? files : [] };
    }
    case 'relation': {
      const relation = value && typeof value === 'object'
        ? (value as Record<string, unknown>)['relation']
        : null;
      return { relation: Array.isArray(relation) ? relation : [] };
    }
    case 'formula': {
      const formula = value && typeof value === 'object'
        ? (value as Record<string, unknown>)['formula']
        : value;
      return { formula: { type: 'string', string: extractString(formula) } };
    }
    case 'rollup': {
      const rollup = value && typeof value === 'object'
        ? (value as Record<string, unknown>)['rollup']
        : value;
      return { rollup };
    }
    default:
      return { [notionType]: value ?? null };
  }
}

/** Converts a Notion property value object into the Votion storage shape. */
export function toVotionPropertyValue(type: PropertyType, notionValue: unknown): unknown {
  const payload =
    notionValue && typeof notionValue === 'object'
      ? (notionValue as Record<string, unknown>)[notionPropertyType(type)]
      : undefined;
  switch (type) {
    case 'title':
    case 'text':
      return toVotionRichText(payload);
    case 'number':
      return { number: typeof payload === 'number' ? payload : null };
    case 'select':
      return { select: (payload as { name?: string } | null)?.name ?? null };
    case 'status':
      return { status: (payload as { name?: string } | null)?.name ?? null };
    case 'multi_select':
      return {
        multi_select: Array.isArray(payload)
          ? payload.map((entry) => (entry as { name?: string })?.name ?? '').filter(Boolean)
          : [],
      };
    case 'date': {
      const date = payload as { start?: string; end?: string } | null;
      return date?.start ? { start: date.start, end: date.end ?? undefined } : { start: null };
    }
    case 'checkbox':
      return { checked: Boolean(payload) };
    case 'url':
      return { url: (payload as string | null) ?? null };
    case 'email':
      return { email: (payload as string | null) ?? null };
    case 'phone_number':
      return { phone_number: (payload as string | null) ?? null };
    case 'person':
      return {
        people: Array.isArray(payload)
          ? payload.map((entry) => ({ object: 'user', id: String(entry?.id ?? '') }))
          : [],
      };
    case 'file':
      return { files: Array.isArray(payload) ? payload : [] };
    case 'relation':
      return { relation: Array.isArray(payload) ? payload : [] };
    case 'formula':
      return { formula: payload ?? null };
    case 'rollup':
      return { rollup: payload ?? null };
    default:
      return payload ?? null;
  }
}

/**
 * Coerces a plain automation action value into the Votion storage shape for
 * the target property type.
 */
export function coerceAutomationValue(value: unknown, type: PropertyType): unknown {
  switch (type) {
    case 'title':
    case 'text':
      if (typeof value === 'string') return plainTextToRichText(value);
      if (Array.isArray(value)) return value;
      return toVotionRichText(value);
    case 'number':
      return { number: extractNumber(value) };
    case 'select':
      return { select: extractName(value) ?? (typeof value === 'string' ? value : null) };
    case 'status':
      return { status: extractName(value) ?? (typeof value === 'string' ? value : null) };
    case 'multi_select':
      return { multi_select: extractMultiNames(value) };
    case 'date':
      return { start: extractString(value) };
    case 'checkbox':
      return { checked: extractChecked(value) };
    case 'url':
      return { url: extractString(value) };
    case 'email':
      return { email: extractString(value) };
    case 'phone_number':
      return { phone_number: extractString(value) };
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Builds the Notion `properties` map of a collection row. */
export function toNotionRowProperties(
  block: BlockRecord,
  collection: CollectionRecord,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [propertyId, definition] of Object.entries(collection.schema)) {
    properties[definition.name] = {
      id: propertyId,
      type: notionPropertyType(definition.type),
      ...toNotionPropertyValue(definition.type, block.properties[propertyId], definition),
    };
  }
  return properties;
}

/** Converts a Votion page/row block into a Notion page object. */
export function toNotionPage(
  block: BlockRecord,
  collection?: CollectionRecord | null,
): NotionPageObject {
  const properties = collection
    ? toNotionRowProperties(block, collection)
    : {
        title: {
          id: 'title',
          type: 'title',
          title: toNotionRichText(block.properties['title']),
        },
      };
  const format = block.format ?? {};
  const icon =
    typeof format['page_icon'] === 'string' && format['page_icon'].length > 0
      ? { type: 'emoji', emoji: format['page_icon'] }
      : null;
  const cover =
    typeof format['page_cover'] === 'string' && format['page_cover'].length > 0
      ? { type: 'external', external: { url: format['page_cover'] } }
      : null;
  return {
    object: 'page',
    id: block.id,
    created_time: iso(block.createdTime),
    last_edited_time: iso(block.lastEditedTime),
    created_by: toNotionUser(block.createdById),
    last_edited_by: toNotionUser(block.lastEditedById),
    cover,
    icon,
    parent: toNotionParent(block.parentId, block.parentTable),
    archived: !block.alive,
    in_trash: !block.alive,
    url: `${PUBLIC_URL}/${block.id}`,
    public_url: null,
    properties,
  };
}

// ---------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------

function toNotionDatabaseProperty(
  propertyId: string,
  definition: CollectionProperty,
): Record<string, unknown> {
  const notionType = notionPropertyType(definition.type);
  const base: Record<string, unknown> = {
    id: propertyId,
    name: definition.name,
    type: notionType,
  };
  const options = (definition.options ?? []).map((option) => ({
    id: option.id,
    name: option.value,
    color: option.color,
  }));
  switch (definition.type) {
    case 'title':
      return { ...base, title: {} };
    case 'text':
      return { ...base, rich_text: {} };
    case 'number':
      return { ...base, number: { format: definition.number_format ?? 'number' } };
    case 'select':
      return { ...base, select: { options } };
    case 'multi_select':
      return { ...base, multi_select: { options } };
    case 'status': {
      const groups = (definition.groups ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        option_ids: group.option_ids,
      }));
      return { ...base, status: { options, groups } };
    }
    case 'date':
      return { ...base, date: {} };
    case 'checkbox':
      return { ...base, checkbox: {} };
    case 'url':
      return { ...base, url: {} };
    case 'email':
      return { ...base, email: {} };
    case 'phone_number':
      return { ...base, phone_number: {} };
    case 'person':
      return { ...base, people: {} };
    case 'file':
      return { ...base, files: {} };
    case 'formula':
      return { ...base, formula: { expression: definition.formula ?? '' } };
    case 'relation':
      return {
        ...base,
        relation: {
          database_id: definition.collection_id ?? definition.relation?.collection_id ?? '',
          type: 'single_property',
          single_property: {},
        },
      };
    case 'rollup':
      return {
        ...base,
        rollup: {
          relation_property_id: definition.relation_property_id ?? '',
          target_property_id: definition.target_property_id ?? '',
          aggregation: definition.rollup?.aggregation ?? 'count',
        },
      };
    case 'created_time':
      return { ...base, created_time: {} };
    case 'created_by':
      return { ...base, created_by: {} };
    case 'last_edited_time':
      return { ...base, last_edited_time: {} };
    case 'last_edited_by':
      return { ...base, last_edited_by: {} };
    case 'unique_id':
      return { ...base, unique_id: { prefix: null } };
    default:
      return { ...base, [notionType]: {} };
  }
}

/** Builds the Notion `properties` map of a database object. */
export function toNotionDatabaseProperties(
  schema: CollectionSchema,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [propertyId, definition] of Object.entries(schema)) {
    properties[definition.name] = toNotionDatabaseProperty(propertyId, definition);
  }
  return properties;
}

/** Converts a Votion collection into a Notion database object. */
export function toNotionDatabase(
  collection: CollectionRecord,
  options: { parentPageId?: UUID } = {},
): NotionDatabaseObject {
  return {
    object: 'database',
    id: collection.id,
    created_time: iso(collection.createdAt),
    last_edited_time: iso(collection.updatedAt),
    created_by: toNotionUser(null),
    last_edited_by: toNotionUser(null),
    title: toNotionRichText(collection.name),
    description: toNotionRichText(collection.description),
    icon: collection.icon ? { type: 'emoji', emoji: collection.icon } : null,
    cover: collection.cover ? { type: 'external', external: { url: collection.cover } } : null,
    parent: {
      type: 'page_id',
      page_id: options.parentPageId ?? collection.parentId,
    },
    archived: !collection.alive,
    is_inline: false,
    properties: toNotionDatabaseProperties(collection.schema),
    url: `${PUBLIC_URL}/${collection.id}`,
  };
}

// ---------------------------------------------------------------------------
// Notion → Votion input conversion
// ---------------------------------------------------------------------------

/** Notion block input payload (`{ type, <type>: {...} }`). */
export interface NotionBlockInput {
  object?: 'block';
  type: string;
  [key: string]: unknown;
}

/** Extracts the type-specific payload from a Notion block input. */
function blockPayload(input: NotionBlockInput): Record<string, unknown> {
  const payload = input[input.type];
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

/** Converts a Notion block input into a Votion block payload. */
export function notionBlockInputToVotion(
  input: NotionBlockInput,
): { type: BlockType; properties: BlockProperties; format: BlockFormat } | null {
  const type = notionBlockTypeToVotion(input.type);
  if (!type) {
    return null;
  }
  const payload = blockPayload(input);
  const properties: BlockProperties = {};
  const format: BlockFormat = {};

  if (type === 'page') {
    const title = payload['title'];
    properties['title'] =
      typeof title === 'string' ? plainTextToRichText(title) : toVotionRichText(title);
  } else if (type === 'divider') {
    /* no payload */
  } else if (type === 'to_do') {
    properties['title'] = toVotionRichText(payload['rich_text']);
    properties['checked'] = [[payload['checked'] === true ? 'yes' : 'no']];
  } else if (type === 'code') {
    properties['title'] = toVotionRichText(payload['rich_text']);
    properties['language'] = [[typeof payload['language'] === 'string' ? payload['language'] : 'plain text']];
    if (payload['caption']) properties['caption'] = toVotionRichText(payload['caption']);
  } else if (MEDIA_TYPES.has(type)) {
    const url = mediaUrl(payload);
    properties['source'] = [[url]];
    if (payload['caption']) properties['caption'] = toVotionRichText(payload['caption']);
  } else if (type === 'bookmark') {
    properties['source'] = [[typeof payload['url'] === 'string' ? payload['url'] : mediaUrl(payload)]];
  } else if (type === 'synced_block') {
    const syncedFrom = payload['synced_from'];
    if (syncedFrom && typeof syncedFrom === 'object') {
      const id = (syncedFrom as Record<string, unknown>)['block_id'];
      if (typeof id === 'string') properties['synced_from_block_id'] = id;
    }
  } else if (TEXT_LIKE_TYPES.has(type)) {
    properties['title'] = toVotionRichText(payload['rich_text'] ?? payload['title']);
  }

  const color = payload['color'];
  if (typeof color === 'string' && color !== 'default') {
    format['block_color'] = color as BlockFormat['block_color'];
  }
  return { type, properties, format };
}

/** Converts a Notion block input plus its nested children into a creation payload. */
export function notionBlockTreeToVotion(
  input: NotionBlockInput,
): { type: BlockType; properties: BlockProperties; format: BlockFormat; children: NotionBlockInput[] } | null {
  const converted = notionBlockInputToVotion(input);
  if (!converted) {
    return null;
  }
  const children = Array.isArray(input['children'])
    ? (input['children'] as NotionBlockInput[])
    : [];
  return { ...converted, children };
}

/** Converts a Notion database property definition into a Votion schema entry. */
export function notionPropertyDefinitionToVotion(
  name: string,
  definition: unknown,
): CollectionProperty | null {
  if (!definition || typeof definition !== 'object') {
    return null;
  }
  const record = definition as Record<string, unknown>;
  const typeKey = Object.keys(record).find((key) => key !== 'name' && key !== 'id');
  if (!typeKey) {
    return null;
  }
  const config = (record[typeKey] ?? {}) as Record<string, unknown>;
  const options: PropertyOption[] = Array.isArray(config['options'])
    ? (config['options'] as unknown[]).flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const option = entry as Record<string, unknown>;
        const optionName = option['name'];
        if (typeof optionName !== 'string') return [];
        const color = typeof option['color'] === 'string' ? (option['color'] as OptionColor) : 'default';
        return [{ id: randomUUID(), value: optionName, color }];
      })
    : [];

  switch (typeKey) {
    case 'title':
      return { name, type: 'title' };
    case 'rich_text':
      return { name, type: 'text' };
    case 'number':
      return {
        name,
        type: 'number',
        number_format:
          typeof config['format'] === 'string'
            ? (config['format'] as CollectionProperty['number_format'])
            : 'number',
      };
    case 'select':
      return { name, type: 'select', options };
    case 'multi_select':
      return { name, type: 'multi_select', options };
    case 'status': {
      const groups = Array.isArray(config['groups'])
        ? (config['groups'] as unknown[]).flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const group = entry as Record<string, unknown>;
            return [{
              id: typeof group['id'] === 'string' ? group['id'] : randomUUID(),
              name: typeof group['name'] === 'string' ? group['name'] : '',
              color: typeof group['color'] === 'string' ? (group['color'] as OptionColor) : 'default',
              option_ids: Array.isArray(group['option_ids'])
                ? (group['option_ids'] as string[])
                : [],
            }];
          })
        : [];
      return { name, type: 'status', options, groups };
    }
    case 'date':
      return { name, type: 'date', date_format: 'full' };
    case 'checkbox':
      return { name, type: 'checkbox' };
    case 'url':
      return { name, type: 'url' };
    case 'email':
      return { name, type: 'email' };
    case 'phone_number':
      return { name, type: 'phone_number' };
    case 'people':
      return { name, type: 'person' };
    case 'files':
      return { name, type: 'file' };
    case 'formula':
      return { name, type: 'formula', formula: typeof config['expression'] === 'string' ? config['expression'] : '' };
    case 'relation':
      return { name, type: 'relation', collection_id: typeof config['database_id'] === 'string' ? config['database_id'] : undefined };
    case 'rollup':
      return { name, type: 'rollup' };
    case 'created_time':
      return { name, type: 'created_time' };
    case 'created_by':
      return { name, type: 'created_by' };
    case 'last_edited_time':
      return { name, type: 'last_edited_time' };
    case 'last_edited_by':
      return { name, type: 'last_edited_by' };
    case 'unique_id':
      return { name, type: 'unique_id' };
    default:
      return null;
  }
}

/** Converts a Notion database schema input into a Votion collection schema. */
export function notionDatabaseSchemaToVotion(
  input: unknown,
): { schema: CollectionSchema; titlePropertyId: string | null } {
  const schema: CollectionSchema = {};
  let titlePropertyId: string | null = null;
  if (!input || typeof input !== 'object') {
    return { schema, titlePropertyId };
  }
  for (const [name, definition] of Object.entries(input as Record<string, unknown>)) {
    const property = notionPropertyDefinitionToVotion(name, definition);
    if (!property) {
      continue;
    }
    if (property.type === 'title') {
      titlePropertyId = 'title';
      schema['title'] = property;
    } else {
      schema[randomUUID()] = property;
    }
  }
  if (!titlePropertyId) {
    titlePropertyId = 'title';
    schema['title'] = { name: 'Title', type: 'title' };
  }
  return { schema, titlePropertyId };
}

/** Flattens a stored property value to the plain text used by automation guards. */
export function storedValueToPlainText(value: unknown): string {
  const name = extractName(value);
  if (name !== null) {
    return name;
  }
  const text = extractString(value);
  return text ?? '';
}

/** Resolves a property name (or id) to the schema property id. */
export function resolvePropertyId(
  schema: CollectionSchema,
  nameOrId: string,
): { propertyId: string; definition: CollectionProperty } | null {
  if (schema[nameOrId]) {
    return { propertyId: nameOrId, definition: schema[nameOrId] };
  }
  for (const [propertyId, definition] of Object.entries(schema)) {
    if (definition.name === nameOrId) {
      return { propertyId, definition };
    }
  }
  return null;
}

/** Resolves a Notion page-properties map onto Votion property ids. */
export function resolvePropertiesToIds(
  schema: CollectionSchema,
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const resolved = resolvePropertyId(schema, key);
    if (!resolved) {
      continue;
    }
    result[resolved.propertyId] = toVotionPropertyValue(resolved.definition.type, value);
  }
  return result;
}
