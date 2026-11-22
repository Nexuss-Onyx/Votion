import { describe, expect, it } from 'vitest';

import {
  InMemoryAclStore,
  InMemoryRedisClient,
  InheritanceCache,
  PermissionChecker,
  PublicAccessGateway,
  parsePublicUrl,
} from '../src/index.js';

const SPACE_ID = '00000000-0000-4000-8000-000000000020';
const MEMBER_ID = '10000000-0000-4000-8000-000000000021';

const PUBLIC_PAGE = '20000000-0000-4000-8000-000000000021';
const PUBLIC_CHILD_BLOCK = '20000000-0000-4000-8000-000000000022';
const INDEXED_PAGE = '20000000-0000-4000-8000-000000000023';
const PRIVATE_PAGE = '20000000-0000-4000-8000-000000000024';
const CUSTOM_DOMAIN_PAGE = '20000000-0000-4000-8000-000000000025';

function setupPublicFixture() {
  const now = () => new Date('2026-11-22T12:00:00.000Z');
  const store = new InMemoryAclStore();
  const redis = new InMemoryRedisClient(() => now().getTime());
  const cache = new InheritanceCache({ redis });
  store.onInvalidate(cache.createInvalidationHook(store));

  const checker = new PermissionChecker({ store, cache, now });
  const gateway = new PublicAccessGateway({
    store,
    traverser: checker.traverser,
    cache,
    now,
  });

  store.addWorkspace({
    id: SPACE_ID,
    name: 'Acme Public Docs',
    domain: 'workspace',
    settings: { disable_public_sharing: false },
  });
  store.addWorkspaceMember({
    workspaceId: SPACE_ID,
    userId: MEMBER_ID,
    role: 'member',
  });

  store.addBlock({
    id: PUBLIC_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: SPACE_ID,
    parentTable: 'space',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: PUBLIC_CHILD_BLOCK,
    spaceId: SPACE_ID,
    type: 'text',
    parentId: PUBLIC_PAGE,
    parentTable: 'block',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: INDEXED_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: SPACE_ID,
    parentTable: 'space',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: PRIVATE_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: SPACE_ID,
    parentTable: 'space',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: CUSTOM_DOMAIN_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: SPACE_ID,
    parentTable: 'space',
    content: [],
    alive: true,
  });

  return { store, checker, gateway };
}

describe('public web access gateway & slug resolution', () => {
  it('parses workspace slug URLs, relative paths, and custom domains while rejecting path traversal', () => {
    expect(parsePublicUrl('votion.dev/@workspace/my-public-doc')).toEqual({
      kind: 'workspace_slug',
      workspaceDomain: 'workspace',
      customDomain: null,
      slug: 'my-public-doc',
    });
    expect(parsePublicUrl('https://votion.dev/@Workspace/My-Public-Doc?ref=home')).toEqual({
      kind: 'workspace_slug',
      workspaceDomain: 'workspace',
      customDomain: null,
      slug: 'my-public-doc',
    });
    expect(parsePublicUrl('/@workspace/my-public-doc')).toEqual({
      kind: 'workspace_slug',
      workspaceDomain: 'workspace',
      customDomain: null,
      slug: 'my-public-doc',
    });
    expect(parsePublicUrl('https://docs.acme.com/getting-started')).toEqual({
      kind: 'custom_domain',
      workspaceDomain: null,
      customDomain: 'docs.acme.com',
      slug: 'getting-started',
    });

    expect(parsePublicUrl('votion.dev/@workspace/../secret')).toBeNull();
    expect(parsePublicUrl('')).toBeNull();
    expect(parsePublicUrl('votion.dev/missing-at-prefix/doc')).toBeNull();
  });

  it('resolves public URL slugs, enforces anonymous read-only access, and sets X-Robots-Tag: noindex by default', async () => {
    const { store, checker, gateway } = setupPublicFixture();

    await store.setPermission({
      id: 'pub-doc-1',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: PUBLIC_PAGE,
      principalType: 'public',
      principalId: null,
      // Even if a misconfigured public row had `write`, anonymous access must be capped to `read`.
      role: 'write',
      metadata: {
        public_slug: 'my-public-doc',
        allow_search_indexing: false,
        allow_duplicate_as_template: true,
      },
    });

    const result = await gateway.resolvePublicUrl(
      'votion.dev/@workspace/my-public-doc',
    );
    expect(result.allowed).toBe(true);
    if (!result.allowed) {
      throw new Error('Expected public access to be allowed');
    }
    expect(result.statusCode).toBe(200);
    expect(result.role).toBe('read');
    expect(result.block.id).toBe(PUBLIC_PAGE);
    expect(result.slug).toBe('my-public-doc');
    expect(result.allowSearchIndexing).toBe(false);
    expect(result.allowDuplicateAsTemplate).toBe(true);
    expect(result.headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(result.headers['X-Votion-Access']).toBe('public-read');
    expect(result.headers['X-Content-Type-Options']).toBe('nosniff');

    // Anonymous read succeeds for the public page and its nested child block, but writes/comments/admin are denied.
    expect(await gateway.canAnonymousRead(PUBLIC_PAGE)).toBe(true);
    expect(await gateway.canAnonymousRead(PUBLIC_CHILD_BLOCK)).toBe(true);
    expect(await gateway.canAnonymousPerform(PUBLIC_PAGE, 'read')).toBe(true);
    expect(await gateway.canAnonymousPerform(PUBLIC_PAGE, 'comment')).toBe(false);
    expect(await gateway.canAnonymousPerform(PUBLIC_PAGE, 'write')).toBe(false);
    expect(await gateway.canAnonymousPerform(PUBLIC_PAGE, 'admin')).toBe(false);

    // Direct PermissionChecker with anonymous user (`null`) also enforces read-only.
    expect(await checker.canRead(null, PUBLIC_CHILD_BLOCK)).toBe(true);
    expect(await checker.canComment(null, PUBLIC_CHILD_BLOCK)).toBe(false);
    expect(await checker.canWrite(null, PUBLIC_CHILD_BLOCK)).toBe(false);
    expect(await checker.canAdmin(null, PUBLIC_CHILD_BLOCK)).toBe(false);

    // Authenticated workspace member is NOT downgraded to read-only just because the page is public!
    expect(await checker.canWrite(MEMBER_ID, PUBLIC_CHILD_BLOCK)).toBe(true);

    // Private page remains inaccessible anonymously.
    expect(await gateway.canAnonymousRead(PRIVATE_PAGE)).toBe(false);
  });

  it('sets indexable SEO headers when allow_search_indexing is enabled and supports custom domains', async () => {
    const { store, gateway } = setupPublicFixture();

    await store.setPermission({
      id: 'pub-indexed',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: INDEXED_PAGE,
      principalType: 'public',
      principalId: null,
      role: 'read',
      metadata: {
        public_slug: 'seo-guide',
        allow_search_indexing: true,
      },
    });

    await store.setPermission({
      id: 'pub-custom-domain',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: CUSTOM_DOMAIN_PAGE,
      principalType: 'public',
      principalId: null,
      role: 'read',
      metadata: {
        custom_domain: 'docs.acme.com',
        public_slug: 'handbook',
        allow_search_indexing: true,
      },
    });

    const indexed = await gateway.resolvePublicSlug('workspace', 'seo-guide');
    expect(indexed.allowed).toBe(true);
    if (indexed.allowed) {
      expect(indexed.headers['X-Robots-Tag']).toBe('index, follow');
    }

    const custom = await gateway.resolvePublicUrl('https://docs.acme.com/handbook');
    expect(custom.allowed).toBe(true);
    if (custom.allowed) {
      expect(custom.block.id).toBe(CUSTOM_DOMAIN_PAGE);
      expect(custom.headers['X-Robots-Tag']).toBe('index, follow');
    }
  });

  it('blocks public access when workspace disables public sharing, page is deleted, or grant expires', async () => {
    const { store, gateway } = setupPublicFixture();

    await store.setPermission({
      id: 'pub-doc-2',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: PUBLIC_PAGE,
      principalType: 'public',
      principalId: null,
      role: 'read',
      metadata: { public_slug: 'roadmap' },
    });

    // Initially accessible.
    expect((await gateway.resolvePublicSlug('workspace', 'roadmap')).allowed).toBe(true);

    // Disable public sharing at the workspace level -> immediate 403 rejection (cache invalidated automatically).
    await store.updateWorkspaceSettings(SPACE_ID, { disable_public_sharing: true });
    const disabled = await gateway.resolvePublicSlug('workspace', 'roadmap');
    expect(disabled.allowed).toBe(false);
    if (!disabled.allowed) {
      expect(disabled.statusCode).toBe(403);
      expect(disabled.reason).toBe('public_sharing_disabled');
      expect(disabled.headers['X-Robots-Tag']).toBe('noindex, nofollow');
    }
    expect(await gateway.canAnonymousRead(PUBLIC_CHILD_BLOCK)).toBe(false);

    // Re-enable public sharing, then soft-delete the page -> 404 entity_deleted.
    await store.updateWorkspaceSettings(SPACE_ID, { disable_public_sharing: false });
    await store.softDeleteBlock(PUBLIC_PAGE);
    const deleted = await gateway.resolvePublicSlug('workspace', 'roadmap');
    expect(deleted.allowed).toBe(false);
    if (!deleted.allowed) {
      expect(deleted.statusCode).toBe(404);
      expect(deleted.reason).toBe('entity_deleted');
    }

    // Expired public grant -> 403 grant_expired.
    await store.setPermission({
      id: 'pub-expired',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: INDEXED_PAGE,
      principalType: 'public',
      principalId: null,
      role: 'read',
      metadata: {
        public_slug: 'expired-doc',
        expires_at: '2026-11-22T11:59:00.000Z',
      },
    });
    const expired = await gateway.resolvePublicSlug('workspace', 'expired-doc');
    expect(expired.allowed).toBe(false);
    if (!expired.allowed) {
      expect(expired.statusCode).toBe(403);
      expect(expired.reason).toBe('grant_expired');
    }
  });
});
