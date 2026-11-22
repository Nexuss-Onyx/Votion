/**
 * Hit hydration: `RawSearchHit` -> `QuickFindHit`.
 *
 * Meilisearch returns highlighted fields under `_formatted` as strings wrapped
 * in the configured tags. Those strings are parsed into segments (never
 * injected as HTML) so the modal can render `<mark>` elements safely even when
 * a page title contains angle brackets or quotes.
 */

import type { BlockType } from '@votion/types';

import { parseHighlightedText, stripHighlightTags } from '../highlight.js';
import type { QuickFindHit, SearchDocument } from '../types.js';
import type { RawSearchHit } from './SearchTransport.js';

/** Reads the first string value of a `_formatted` field. */
function formattedString(
  formatted: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = formatted?.[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

/** Reads a plain string field, tolerating array payloads. */
function plainString(hit: RawSearchHit, key: keyof SearchDocument): string {
  const value = hit[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    return typeof first === 'string' ? first : '';
  }
  return '';
}

/** `true` when the body snippet adds information beyond the title. */
function snippetIsUseful(snippet: string, title: string): boolean {
  const normalised = snippet.trim();
  if (normalised.length === 0) {
    return false;
  }
  if (title.length === 0) {
    return true;
  }
  return normalised.toLowerCase() !== title.toLowerCase();
}

/**
 * Hydrates a raw hit. Returns `null` when the hit has no usable id, which can
 * happen after a schema change if stale documents are still indexed.
 */
export function hydrateHit(
  hit: RawSearchHit,
  options: { preTag?: string; postTag?: string } = {},
): QuickFindHit | null {
  const id =
    typeof hit.id === 'string' && hit.id.length > 0 ? hit.id : undefined;
  if (!id) {
    return null;
  }

  const formatted = hit._formatted;
  const titleSource = formattedString(formatted, 'title');
  const bodySource = formattedString(formatted, 'plain_text');

  const plainTitle = stripHighlightTags(
    titleSource ?? plainString(hit, 'title'),
    options.preTag,
    options.postTag,
  );
  const bodyText = stripHighlightTags(
    bodySource ?? plainString(hit, 'plain_text'),
    options.preTag,
    options.postTag,
  );

  // Titles are highlighted in place; the snippet only shows when it carries
  // information the title does not already display.
  const title = parseHighlightedText(
    titleSource ?? plainTitle,
    options.preTag,
    options.postTag,
  );
  const snippet = snippetIsUseful(bodyText, plainTitle)
    ? parseHighlightedText(
        bodySource ?? bodyText,
        options.preTag,
        options.postTag,
      )
    : [];

  const hit_: QuickFindHit = {
    id,
    spaceId: plainString(hit, 'space_id'),
    parentId: plainString(hit, 'parent_id'),
    rootPageId: plainString(hit, 'root_page_id'),
    type: (plainString(hit, 'type') || 'text') as BlockType,
    title,
    snippet,
    plainTitle,
    createdBy: plainString(hit, 'created_by'),
    lastEditedTime:
      typeof hit.last_edited_time === 'number' &&
      Number.isFinite(hit.last_edited_time)
        ? hit.last_edited_time
        : 0,
  };

  const breadcrumb = plainString(hit, 'breadcrumb');
  if (breadcrumb.length > 0) {
    hit_.breadcrumb = breadcrumb;
  }
  if (
    typeof hit._rankingScore === 'number' &&
    Number.isFinite(hit._rankingScore)
  ) {
    hit_.rankingScore = hit._rankingScore;
  }
  return hit_;
}

/** Hydrates a batch of hits, dropping unusable documents. */
export function hydrateHits(
  hits: readonly RawSearchHit[],
  options: { preTag?: string; postTag?: string } = {},
): QuickFindHit[] {
  const hydrated: QuickFindHit[] = [];
  for (const hit of hits) {
    const result = hydrateHit(hit, options);
    if (result) {
      hydrated.push(result);
    }
  }
  return hydrated;
}
