import { describe, expect, it } from 'vitest';

import {
  InMemoryAclStore,
  InMemoryRedisClient,
  InheritanceCache,
  PermissionChecker,
} from '../src/index.js';

const SPACE_ID = '00000000-0000-4000-8000-000000000010';
const OWNER_ID = '10000000-0000-4000-8000-000000000011';
const MEMBER_ID = '10000000-0000-4000-8000-000000000012';
const GUEST_ID = '10000000-0000-4000-8000-000000000013';
const TEAMSPACE_ENG = '11111111-0000-4000-8000-000000000001';
const TEAMSPACE_EXEC = '11111111-0000-4000-8000-000000000002';

const ROOT_PAGE = '20000000-0000-4000-8000-000000000011';
const RESTRICTED_PAGE = '20000000-0000-4000-8000-000000000012';
const OPEN_PAGE = '20000000-0000-4000-8000-000000000013';
const NESTED_SECTION = '20000000-0000-4000-8000-000000000014';
const NESTED_LEAF = '20000000-0000-4000-8000-000000000015';

function setupOverrideFixture() {
  let nowMs = Date.parse('2026-11-22T12:00:00.000Z');
  const store = new InMemoryAclStore();
  const redis = new InMemoryRedisClient(() => nowMs);
  const cache = new InheritanceCache({ redis, ttlSeconds: 300 });
  store.onInvalidate(cache.createInvalidationHook(store));

  const checker = new PermissionChecker({
    store,
    cache,
    now: () => new Date(nowMs),
  });

  store.addWorkspace({
    id: SPACE_ID,
    name: 'Votion HQ',
    domain: 'votion-hq',
    settings: {},
  });
  store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: OWNER_ID, role: 'owner' });
  store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: MEMBER_ID, role: 'member' });
  store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: GUEST_ID, role: 'guest' });

  store.addBlock({
    id: ROOT_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: SPACE_ID,
    parentTable: 'space',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: RESTRICTED_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: ROOT_PAGE,
    parentTable: 'block',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: OPEN_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: ROOT_PAGE,
    parentTable: 'block',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: NESTED_SECTION,
    spaceId: SPACE_ID,
    type: 'toggle',
    parentId: RESTRICTED_PAGE,
    parentTable: 'block',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: NESTED_LEAF,
    spaceId: SPACE_ID,
    type: 'text',
    parentId: NESTED_SECTION,
    parentTable: 'block',
    content: [],
    alive: true,
  });

  return {
    store,
    redis,
    cache,
    checker,
    advanceTimeMs(deltaMs: number) {
      nowMs += deltaMs;
    },
  };
}

describe('explicit permission overrides & precedence', () => {
  it('allows an explicit page override to downgrade a workspace member from write to read', async () => {
    const { store, checker } = setupOverrideFixture();

    // Baseline: workspace member inherits `write` on RESTRICTED_PAGE and its descendants.
    expect(await checker.canWrite(MEMBER_ID, NESTED_LEAF)).toBe(true);

    // Apply explicit `read` override on RESTRICTED_PAGE for MEMBER_ID.
    await store.setPermission({
      id: 'perm-downgrade-member',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'user',
      principalId: MEMBER_ID,
      role: 'read',
    });

    // Descendant inherits the page override (`read`), overriding workspace default (`write`).
    const resolution = await checker.resolve(MEMBER_ID, NESTED_LEAF);
    expect(resolution.role).toBe('read');
    expect(resolution.source).toBe('explicit_user');
    expect(resolution.resolvedAtEntityId).toBe(RESTRICTED_PAGE);
    expect(await checker.canRead(MEMBER_ID, NESTED_LEAF)).toBe(true);
    expect(await checker.canComment(MEMBER_ID, NESTED_LEAF)).toBe(false);
    expect(await checker.canWrite(MEMBER_ID, NESTED_LEAF)).toBe(false);

    // Sibling page unaffected: member still retains workspace default `write`.
    expect(await checker.canWrite(MEMBER_ID, OPEN_PAGE)).toBe(true);
  });

  it('allows an explicit page override to upgrade a member to admin and grant guests scoped access', async () => {
    const { store, checker } = setupOverrideFixture();

    await store.setPermission({
      id: 'perm-upgrade-member',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: OPEN_PAGE,
      principalType: 'user',
      principalId: MEMBER_ID,
      role: 'admin',
    });

    await store.setPermission({
      id: 'perm-guest-comment',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'user',
      principalId: GUEST_ID,
      role: 'comment',
    });

    expect(await checker.canAdmin(MEMBER_ID, OPEN_PAGE)).toBe(true);
    expect(await checker.canAdmin(MEMBER_ID, ROOT_PAGE)).toBe(false);

    // Guest can read & comment on RESTRICTED_PAGE and its descendants, but cannot write or see ROOT_PAGE/OPEN_PAGE.
    expect(await checker.canRead(GUEST_ID, NESTED_LEAF)).toBe(true);
    expect(await checker.canComment(GUEST_ID, NESTED_LEAF)).toBe(true);
    expect(await checker.canWrite(GUEST_ID, NESTED_LEAF)).toBe(false);
    expect(await checker.canRead(GUEST_ID, ROOT_PAGE)).toBe(false);
    expect(await checker.canRead(GUEST_ID, OPEN_PAGE)).toBe(false);
  });

  it('gives closer descendant overrides precedence over ancestor overrides and supports explicit DENY', async () => {
    const { store, checker } = setupOverrideFixture();

    // Parent page grants `read` to guest, nested leaf grants `write`.
    await store.setPermission({
      id: 'perm-page-read',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'user',
      principalId: GUEST_ID,
      role: 'read',
    });
    await store.setPermission({
      id: 'perm-leaf-write',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: NESTED_LEAF,
      principalType: 'user',
      principalId: GUEST_ID,
      role: 'write',
    });

    expect(await checker.canWrite(GUEST_ID, NESTED_LEAF)).toBe(true);
    expect(await checker.canWrite(GUEST_ID, NESTED_SECTION)).toBe(false);
    expect(await checker.canRead(GUEST_ID, NESTED_SECTION)).toBe(true);

    // Explicit DENY override halts inheritance even for the workspace owner.
    await store.setPermission({
      id: 'perm-owner-deny',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'user',
      principalId: OWNER_ID,
      role: 'read',
      metadata: { deny: true },
    });

    const ownerDenied = await checker.resolve(OWNER_ID, NESTED_LEAF);
    expect(ownerDenied.allowed).toBe(false);
    expect(ownerDenied.role).toBeNull();
    expect(ownerDenied.source).toBe('explicit_deny');
    expect(ownerDenied.reason).toBe('explicit_deny');
    expect(await checker.canRead(OWNER_ID, NESTED_LEAF)).toBe(false);
  });

  it('evaluates teamspace overrides and prioritizes direct user overrides on the same entity', async () => {
    const { store, checker } = setupOverrideFixture();

    store.addUserToTeamspace(SPACE_ID, GUEST_ID, TEAMSPACE_ENG);
    store.addUserToTeamspace(SPACE_ID, GUEST_ID, TEAMSPACE_EXEC);

    await store.setPermission({
      id: 'perm-ts-eng',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'teamspace',
      principalId: TEAMSPACE_ENG,
      role: 'read',
    });
    await store.setPermission({
      id: 'perm-ts-exec',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'teamspace',
      principalId: TEAMSPACE_EXEC,
      role: 'write',
    });

    // Highest teamspace privilege (`write`) applies across descendants.
    const teamRes = await checker.resolve(GUEST_ID, NESTED_LEAF);
    expect(teamRes.role).toBe('write');
    expect(teamRes.source).toBe('explicit_teamspace');

    // Direct user override on the same page takes precedence over teamspace rules.
    await store.setPermission({
      id: 'perm-direct-guest',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'user',
      principalId: GUEST_ID,
      role: 'comment',
    });

    const directRes = await checker.resolve(GUEST_ID, NESTED_LEAF);
    expect(directRes.role).toBe('comment');
    expect(directRes.source).toBe('explicit_user');
  });

  it('ignores expired permission overrides and invalidates Redis subtree cache immediately on edits and block moves', async () => {
    const { store, checker, advanceTimeMs } = setupOverrideFixture();

    // Grant guest temporary `write` access expiring in 60 seconds.
    await store.setPermission({
      id: 'perm-expiring',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'user',
      principalId: GUEST_ID,
      role: 'write',
      metadata: {
        expires_at: new Date(Date.parse('2026-11-22T12:01:00.000Z')).toISOString(),
      },
    });

    // First read populates cache; second read hits cache.
    const first = await checker.resolve(GUEST_ID, NESTED_LEAF);
    expect(first.role).toBe('write');
    expect(first.fromCache).toBe(false);

    const cached = await checker.resolve(GUEST_ID, NESTED_LEAF);
    expect(cached.role).toBe('write');
    expect(cached.fromCache).toBe(true);

    // Mutate permission on ancestor RESTRICTED_PAGE -> immediately invalidates NESTED_LEAF in cache!
    await store.setPermission({
      id: 'perm-expiring',
      workspaceId: SPACE_ID,
      entityTable: 'block',
      entityId: RESTRICTED_PAGE,
      principalType: 'user',
      principalId: GUEST_ID,
      role: 'read',
      metadata: {
        expires_at: new Date(Date.parse('2026-11-22T12:01:00.000Z')).toISOString(),
      },
    });

    const afterEdit = await checker.resolve(GUEST_ID, NESTED_LEAF);
    expect(afterEdit.fromCache).toBe(false);
    expect(afterEdit.role).toBe('read');

    // Move NESTED_SECTION (and its child NESTED_LEAF) from RESTRICTED_PAGE to OPEN_PAGE (where guest has no grant).
    await store.moveBlock(NESTED_SECTION, OPEN_PAGE, 'block');

    const afterMove = await checker.resolve(GUEST_ID, NESTED_LEAF);
    expect(afterMove.fromCache).toBe(false);
    expect(afterMove.allowed).toBe(false);
    expect(afterMove.role).toBeNull();

    // Move back, advance past expiration (and bypass/expire cache) -> expired grant is rejected.
    await store.moveBlock(NESTED_SECTION, RESTRICTED_PAGE, 'block');
    advanceTimeMs(120_000); // +2 minutes -> past `expires_at`
    const expiredRes = await checker.resolve(GUEST_ID, NESTED_LEAF, {
      bypassCache: true,
    });
    expect(expiredRes.allowed).toBe(false);
    expect(expiredRes.role).toBeNull();
  });
});
