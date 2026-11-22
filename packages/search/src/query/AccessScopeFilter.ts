/**
 * ACL-aware filter construction.
 *
 * Permission scoping is the single most important invariant of the search
 * subsystem: a Quick Find hit must never reveal a document the querying user
 * cannot read. The strategy is **deny-by-default and filter-only** — access is
 * expressed entirely through Meilisearch filterable attributes, never through
 * client-side post-filtering (which would leak `totalHits` and ranking scores).
 *
 * The resolved filter always contains:
 *
 * ```
 * alive = true
 *   AND space_id IN [<member workspaces>]
 *   AND (root_page_id IN [<readable trees>] OR ancestor_ids IN [<shared sub-trees>])
 *   AND (access_principals IN [<explicit grants>])   // only when supplied
 * ```
 */

import type { QuickFindAccessScope } from '../types.js';
import {
  allOf,
  anyOf,
  booleanFilter,
  inFilter,
  type FilterAttribute,
} from './FacetFilter.js';

/** Result of resolving an access scope into a Meilisearch filter. */
export interface ResolvedAccessFilter {
  /** Filter clause, or an empty string when the scope is unsatisfiable. */
  filter: string;
  /** `false` — and therefore no request — when the user can read nothing. */
  hasAccess: boolean;
  /** Human-readable reason when access was denied (diagnostics only). */
  reason?: string;
}

/** Attributes that carry ACL information inside a search document. */
export const ACL_FILTER_ATTRIBUTES: readonly FilterAttribute[] = [
  'space_id',
  'root_page_id',
  'ancestor_ids',
  'access_principals',
  'alive',
];

function clean(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/**
 * Resolves a {@link QuickFindAccessScope} into a filter clause.
 *
 * Fail-closed rules:
 *  - no user id → denied;
 *  - no workspace membership → denied;
 *  - an explicitly empty `readableRootPageIds` **and** no shared sub-trees →
 *    denied (an empty list means "nothing is readable", not "no restriction").
 */
export function buildAccessScopeFilter(
  scope: QuickFindAccessScope,
): ResolvedAccessFilter {
  if (typeof scope.userId !== 'string' || scope.userId.trim().length === 0) {
    return { filter: '', hasAccess: false, reason: 'Missing querying user' };
  }

  const spaceIds = clean(scope.spaceIds);
  if (spaceIds.length === 0) {
    return {
      filter: '',
      hasAccess: false,
      reason: 'User is not a member of any workspace',
    };
  }

  const rootPageIds = clean(scope.readableRootPageIds);
  const subtreeIds = clean(scope.readableSubtreeIds);
  const rootsSupplied = scope.readableRootPageIds !== undefined;
  const subtreesSupplied = scope.readableSubtreeIds !== undefined;

  if (rootsSupplied && rootPageIds.length === 0 && subtreeIds.length === 0) {
    return {
      filter: '',
      hasAccess: false,
      reason: 'No readable pages in scope',
    };
  }
  if (!rootsSupplied && subtreesSupplied && subtreeIds.length === 0) {
    return {
      filter: '',
      hasAccess: false,
      reason: 'No readable sub-trees in scope',
    };
  }

  const treeClauses: string[] = [];
  if (rootPageIds.length > 0) {
    treeClauses.push(inFilter('root_page_id', rootPageIds));
  }
  if (subtreeIds.length > 0) {
    // A document deep inside a shared page matches through `ancestor_ids`;
    // the shared page itself matches through the root/sub-tree id.
    treeClauses.push(inFilter('ancestor_ids', subtreeIds));
    treeClauses.push(inFilter('root_page_id', subtreeIds));
  }

  const principals = clean(scope.principals);

  const filter = allOf([
    booleanFilter('alive', true),
    inFilter('space_id', spaceIds),
    anyOf(treeClauses),
    principals.length > 0
      ? inFilter('access_principals', principals)
      : undefined,
  ]);

  return { filter, hasAccess: filter.length > 0 };
}
