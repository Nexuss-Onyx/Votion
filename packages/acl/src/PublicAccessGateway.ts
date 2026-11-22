/**
 * Public Web Sharing & Publishing Gateway.
 *
 * Validates public page permissions, resolves custom workspace/page URL slugs
 * (e.g. `votion.dev/@workspace/my-public-doc`) and custom domains, strictly
 * enforces anonymous read-only access, and attaches SEO / security headers
 * (including `X-Robots-Tag: noindex, nofollow` when search indexing is disabled).
 */

import type { PermissionRole, UUID } from '@votion/types';

import type { InheritanceCache } from './InheritanceCache.js';
import { isPermissionGrantActive } from './roles.js';
import { Traverser } from './Traverser.js';
import type {
  AclBlockNode,
  AclPermissionRule,
  AclStore,
  AclWorkspace,
} from './types.js';

/** Default primary Votion hostnames treated as `@workspace/slug` routers. */
export const DEFAULT_PUBLIC_BASE_HOSTS: readonly string[] = [
  'votion.dev',
  'www.votion.dev',
];

/** Default Cache-Control header applied to publicly shared pages. */
export const DEFAULT_PUBLIC_CACHE_CONTROL =
  'public, max-age=60, stale-while-revalidate=300';

/** HTTP response headers produced by {@link PublicAccessGateway}. */
export interface PublicResponseHeaders {
  'X-Robots-Tag': 'index, follow' | 'noindex, nofollow';
  'Cache-Control': string;
  'X-Content-Type-Options': 'nosniff';
  'X-Votion-Access': 'public-read';
}

/** Parsed components of a public Votion URL or path. */
export interface ParsedPublicUrl {
  kind: 'workspace_slug' | 'custom_domain';
  workspaceDomain: string | null;
  customDomain: string | null;
  slug: string;
}

/** Machine-readable reason why a public access request was rejected. */
export type PublicAccessDenialReason =
  | 'invalid_url'
  | 'workspace_not_found'
  | 'public_sharing_disabled'
  | 'not_published'
  | 'grant_expired'
  | 'entity_not_found'
  | 'entity_deleted'
  | 'anonymous_write_forbidden';

/** Successful public access gateway decision (always read-only). */
export interface PublicAccessAllowed {
  allowed: true;
  statusCode: 200;
  role: 'read';
  workspace: AclWorkspace;
  block: AclBlockNode;
  rule: AclPermissionRule;
  slug: string | null;
  allowSearchIndexing: boolean;
  allowDuplicateAsTemplate: boolean;
  headers: PublicResponseHeaders;
}

/** Denied public access gateway decision. */
export interface PublicAccessDenied {
  allowed: false;
  statusCode: 400 | 403 | 404;
  role: null;
  reason: PublicAccessDenialReason;
  headers: {
    'X-Robots-Tag': 'noindex, nofollow';
    'Cache-Control': 'no-store';
    'X-Content-Type-Options': 'nosniff';
  };
}

export type PublicAccessResult = PublicAccessAllowed | PublicAccessDenied;

/** Configuration accepted by {@link PublicAccessGateway}. */
export interface PublicAccessGatewayOptions {
  store: AclStore;
  traverser?: Traverser;
  cache?: InheritanceCache;
  baseHosts?: readonly string[];
  cacheControl?: string;
  now?: () => Date;
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-_]{0,126}[a-z0-9])?$/i;

function deniedResult(
  statusCode: 400 | 403 | 404,
  reason: PublicAccessDenialReason,
): PublicAccessDenied {
  return {
    allowed: false,
    statusCode,
    role: null,
    reason,
    headers: {
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  };
}

/**
 * Builds deterministic SEO & security headers for a published public page.
 * Defaults to `X-Robots-Tag: noindex, nofollow` unless `allowSearchIndexing` is
 * explicitly `true`.
 */
export function buildPublicResponseHeaders(
  allowSearchIndexing: boolean,
  cacheControl: string = DEFAULT_PUBLIC_CACHE_CONTROL,
): PublicResponseHeaders {
  return {
    'X-Robots-Tag': allowSearchIndexing ? 'index, follow' : 'noindex, nofollow',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'X-Votion-Access': 'public-read',
  };
}

/**
 * Parses a public Votion URL or path into either:
 * - `{ kind: 'workspace_slug', workspaceDomain, slug }` for forms like:
 *   - `https://votion.dev/@workspace/my-public-doc`
 *   - `votion.dev/@workspace/my-public-doc`
 *   - `/@workspace/my-public-doc`
 *   - `@workspace/my-public-doc`
 * - `{ kind: 'custom_domain', customDomain, slug }` for forms like:
 *   - `https://docs.acme.com/my-public-doc`
 *   - `docs.acme.com/my-public-doc`
 *
 * Returns `null` for malformed URLs or path-traversal attempts.
 */
export function parsePublicUrl(
  input: string,
  baseHosts: readonly string[] = DEFAULT_PUBLIC_BASE_HOSTS,
): ParsedPublicUrl | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Reject path traversal and null bytes up front.
  if (trimmed.includes('..') || trimmed.includes('\0')) {
    return null;
  }

  const normalizedBaseHosts = new Set(baseHosts.map((h) => h.toLowerCase()));

  // Path-only form: `/@workspace/slug` or `@workspace/slug`
  if (trimmed.startsWith('/@') || trimmed.startsWith('@')) {
    const cleanPath = trimmed
      .split(/[?#]/, 1)[0]
      ?.replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!cleanPath) return null;
    const segments = cleanPath.split('/');
    if (segments.length !== 2) return null;
    const rawWorkspace = segments[0];
    const slug = segments[1];
    if (!rawWorkspace || !rawWorkspace.startsWith('@') || !slug) {
      return null;
    }
    const workspaceDomain = rawWorkspace.slice(1).toLowerCase();
    if (!SLUG_PATTERN.test(workspaceDomain) || !SLUG_PATTERN.test(slug)) {
      return null;
    }
    return {
      kind: 'workspace_slug',
      workspaceDomain,
      customDomain: null,
      slug: slug.toLowerCase(),
    };
  }

  // Full URL or schemeless host/path: `votion.dev/@workspace/slug` or `docs.acme.com/slug`
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || !hostname.includes('.')) {
    return null;
  }

  const segments = parsed.pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment.length > 0);

  if (normalizedBaseHosts.has(hostname)) {
    if (segments.length !== 2) {
      return null;
    }
    const rawWorkspace = segments[0];
    const slug = segments[1];
    if (!rawWorkspace || !rawWorkspace.startsWith('@') || !slug) {
      return null;
    }
    const workspaceDomain = rawWorkspace.slice(1).toLowerCase();
    if (!SLUG_PATTERN.test(workspaceDomain) || !SLUG_PATTERN.test(slug)) {
      return null;
    }
    return {
      kind: 'workspace_slug',
      workspaceDomain,
      customDomain: null,
      slug: slug.toLowerCase(),
    };
  }

  // Custom domain route: `https://docs.acme.com/` or `https://docs.acme.com/my-doc`
  if (segments.length > 1) {
    return null;
  }
  const slug = segments[0] ? segments[0].toLowerCase() : '';
  if (slug.length > 0 && !SLUG_PATTERN.test(slug)) {
    return null;
  }

  return {
    kind: 'custom_domain',
    workspaceDomain: null,
    customDomain: hostname,
    slug,
  };
}

/**
 * Validates public page access, resolves custom slugs/domains, enforces
 * anonymous read-only semantics, and constructs SEO headers.
 */
export class PublicAccessGateway {
  private readonly store: AclStore;
  private readonly traverser: Traverser;
  private readonly baseHosts: readonly string[];
  private readonly cacheControl: string;
  private readonly now: () => Date;

  constructor(options: PublicAccessGatewayOptions) {
    this.store = options.store;
    this.baseHosts = options.baseHosts ?? DEFAULT_PUBLIC_BASE_HOSTS;
    this.cacheControl = options.cacheControl ?? DEFAULT_PUBLIC_CACHE_CONTROL;
    this.now = options.now ?? (() => new Date());
    this.traverser =
      options.traverser ??
      new Traverser({
        store: options.store,
        cache: options.cache,
        now: this.now,
      });
  }

  /**
   * Resolves a public URL or path (e.g. `votion.dev/@workspace/my-public-doc`
   * or `https://docs.acme.com/guide`) and validates anonymous read access.
   */
  async resolvePublicUrl(urlOrPath: string): Promise<PublicAccessResult> {
    const parsed = parsePublicUrl(urlOrPath, this.baseHosts);
    if (!parsed) {
      return deniedResult(400, 'invalid_url');
    }

    if (parsed.kind === 'workspace_slug' && parsed.workspaceDomain) {
      return this.resolvePublicSlug(parsed.workspaceDomain, parsed.slug);
    }

    if (parsed.kind === 'custom_domain' && parsed.customDomain) {
      return this.resolveCustomDomain(parsed.customDomain, parsed.slug);
    }

    return deniedResult(400, 'invalid_url');
  }

  /**
   * Resolves a public page by workspace domain/slug and public document slug.
   */
  async resolvePublicSlug(
    workspaceDomain: string,
    slug: string,
  ): Promise<PublicAccessResult> {
    const normalizedDomain = workspaceDomain.trim().toLowerCase();
    const normalizedSlug = slug.trim().toLowerCase();

    if (
      !SLUG_PATTERN.test(normalizedDomain) ||
      !SLUG_PATTERN.test(normalizedSlug)
    ) {
      return deniedResult(400, 'invalid_url');
    }

    const workspace = await this.store.getWorkspaceByDomain(normalizedDomain);
    if (!workspace) {
      return deniedResult(404, 'workspace_not_found');
    }

    if (workspace.settings?.disable_public_sharing === true) {
      return deniedResult(403, 'public_sharing_disabled');
    }

    const rule = await this.store.getPublicPermissionBySlug(
      workspace.id,
      normalizedSlug,
    );
    if (!rule) {
      return deniedResult(404, 'not_published');
    }

    return this.finalizePublicRuleAccess(workspace, rule, normalizedSlug);
  }

  /**
   * Resolves a public page mapped to a custom domain (with optional path slug).
   */
  async resolveCustomDomain(
    customDomain: string,
    slug = '',
  ): Promise<PublicAccessResult> {
    const normalizedHost = customDomain.trim().toLowerCase();
    const normalizedSlug = slug.trim().toLowerCase();

    if (!normalizedHost || !this.store.getPublicPermissionByCustomDomain) {
      return deniedResult(404, 'not_published');
    }

    const rule = await this.store.getPublicPermissionByCustomDomain(
      normalizedHost,
      normalizedSlug.length > 0 ? normalizedSlug : undefined,
    );
    if (!rule) {
      return deniedResult(404, 'not_published');
    }

    const workspace = await this.store.getWorkspace(rule.workspaceId);
    if (!workspace) {
      return deniedResult(404, 'workspace_not_found');
    }

    if (workspace.settings?.disable_public_sharing === true) {
      return deniedResult(403, 'public_sharing_disabled');
    }

    return this.finalizePublicRuleAccess(
      workspace,
      rule,
      normalizedSlug.length > 0
        ? normalizedSlug
        : (rule.metadata?.public_slug ?? null),
    );
  }

  /**
   * Validates anonymous read access to a specific block ID (either directly
   * published or nested inside a publicly shared ancestor page).
   */
  async resolvePublicBlock(blockId: UUID): Promise<PublicAccessResult> {
    const block = await this.store.getBlock(blockId);
    if (!block) {
      return deniedResult(404, 'entity_not_found');
    }
    if (!block.alive) {
      return deniedResult(404, 'entity_deleted');
    }

    const workspace = await this.store.getWorkspace(block.spaceId);
    if (!workspace) {
      return deniedResult(404, 'workspace_not_found');
    }
    if (workspace.settings?.disable_public_sharing === true) {
      return deniedResult(403, 'public_sharing_disabled');
    }

    const resolution = await this.traverser.resolveBlockPermission(
      null,
      blockId,
    );
    if (
      !resolution.allowed ||
      resolution.source !== 'public' ||
      resolution.resolvedAtEntityTable === null ||
      resolution.resolvedAtEntityId === null
    ) {
      if (resolution.reason === 'public_sharing_disabled') {
        return deniedResult(403, 'public_sharing_disabled');
      }
      if (
        resolution.reason === 'entity_deleted' ||
        resolution.reason === 'parent_deleted'
      ) {
        return deniedResult(404, 'entity_deleted');
      }
      return deniedResult(404, 'not_published');
    }

    const rules = await this.store.getPermissionsForEntity(
      workspace.id,
      resolution.resolvedAtEntityTable,
      resolution.resolvedAtEntityId,
    );
    const activePublicRule = rules.find(
      (r) =>
        r.principalType === 'public' &&
        r.principalId === null &&
        r.metadata?.deny !== true &&
        isPermissionGrantActive(r, this.now()),
    );

    if (!activePublicRule) {
      return deniedResult(404, 'not_published');
    }

    const allowSearchIndexing =
      activePublicRule.metadata?.allow_search_indexing === true;
    const allowDuplicateAsTemplate =
      activePublicRule.metadata?.allow_duplicate_as_template === true;

    return {
      allowed: true,
      statusCode: 200,
      role: 'read',
      workspace,
      block,
      rule: activePublicRule,
      slug: activePublicRule.metadata?.public_slug ?? null,
      allowSearchIndexing,
      allowDuplicateAsTemplate,
      headers: buildPublicResponseHeaders(
        allowSearchIndexing,
        this.cacheControl,
      ),
    };
  }

  /** Returns `true` iff an anonymous visitor may read `blockId`. */
  async canAnonymousRead(blockId: UUID): Promise<boolean> {
    const result = await this.resolvePublicBlock(blockId);
    return result.allowed;
  }

  /**
   * Enforces strict anonymous read-only access: only `'read'` may ever return
   * `true`; `'comment'`, `'write'`, and `'admin'` are unconditionally denied.
   */
  async canAnonymousPerform(
    blockId: UUID,
    action: PermissionRole,
  ): Promise<boolean> {
    if (action !== 'read') {
      return false;
    }
    return this.canAnonymousRead(blockId);
  }

  private async finalizePublicRuleAccess(
    workspace: AclWorkspace,
    rule: AclPermissionRule,
    slug: string | null,
  ): Promise<PublicAccessResult> {
    if (
      rule.principalType !== 'public' ||
      rule.principalId !== null ||
      rule.metadata?.deny === true
    ) {
      return deniedResult(404, 'not_published');
    }

    if (!isPermissionGrantActive(rule, this.now())) {
      return deniedResult(403, 'grant_expired');
    }

    const block = await this.store.getBlock(rule.entityId);
    if (!block) {
      return deniedResult(404, 'entity_not_found');
    }
    if (!block.alive || block.spaceId !== workspace.id) {
      return deniedResult(404, 'entity_deleted');
    }

    // Verify full ancestor chain is intact and alive via the traverser.
    const resolution = await this.traverser.resolveBlockPermission(
      null,
      block.id,
    );
    if (!resolution.allowed || resolution.role !== 'read') {
      if (resolution.reason === 'public_sharing_disabled') {
        return deniedResult(403, 'public_sharing_disabled');
      }
      if (resolution.reason === 'parent_deleted') {
        return deniedResult(404, 'entity_deleted');
      }
      return deniedResult(404, 'not_published');
    }

    const allowSearchIndexing = rule.metadata?.allow_search_indexing === true;
    const allowDuplicateAsTemplate =
      rule.metadata?.allow_duplicate_as_template === true;

    return {
      allowed: true,
      statusCode: 200,
      role: 'read',
      workspace,
      block,
      rule,
      slug,
      allowSearchIndexing,
      allowDuplicateAsTemplate,
      headers: buildPublicResponseHeaders(
        allowSearchIndexing,
        this.cacheControl,
      ),
    };
  }
}
