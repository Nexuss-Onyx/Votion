import type { Redis } from 'ioredis';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { createDatabase } from '@votion/db';

import {
  DEFAULT_ACL_CACHE_TTL_SECONDS,
  DrizzleAclStore,
  InMemoryAclStore,
  InMemoryRedisClient,
  InheritanceCache,
  PermissionChecker,
  PermissionDeniedError,
  ROLE_CAPABILITIES,
  VOTION_ACL_VERSION,
  WORKSPACE_ROLE_CAPABILITIES,
  hasEntityCapability,
  hasWorkspaceCapability,
  type RedisClientLike,
} from '../src/index.js';

const SPACE_ID = '00000000-0000-4000-8000-000000000030';
const OWNER_ID = '10000000-0000-4000-8000-000000000031';
const ADMIN_ID = '10000000-0000-4000-8000-000000000032';
const MEMBER_ID = '10000000-0000-4000-8000-000000000033';
const GUEST_ID = '10000000-0000-4000-8000-000000000034';
const PAGE_ID = '20000000-0000-4000-8000-000000000031';

describe('workspace RBAC & role capability matrix', () => {
  it('enforces the entity role capability matrix and throws PermissionDeniedError on assertPermission', async () => {
    expect(VOTION_ACL_VERSION).toBe('0.1.0');
    expect(ROLE_CAPABILITIES.read.has('export')).toBe(true);
    expect(ROLE_CAPABILITIES.read.has('comment')).toBe(false);
    expect(ROLE_CAPABILITIES.comment.has('comment')).toBe(true);
    expect(ROLE_CAPABILITIES.comment.has('write')).toBe(false);
    expect(ROLE_CAPABILITIES.write.has('create_child')).toBe(true);
    expect(ROLE_CAPABILITIES.write.has('delete')).toBe(false);
    expect(ROLE_CAPABILITIES.admin.has('manage_permissions')).toBe(true);
    expect(ROLE_CAPABILITIES.admin.has('delete')).toBe(true);
    expect(hasEntityCapability(null, 'read')).toBe(false);

    const store = new InMemoryAclStore();
    store.addWorkspace({ id: SPACE_ID, name: 'RBAC Space', domain: 'rbac', settings: {} });
    store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: MEMBER_ID, role: 'member' });
    store.addBlock({
      id: PAGE_ID,
      spaceId: SPACE_ID,
      type: 'page',
      parentId: SPACE_ID,
      parentTable: 'space',
      content: [],
      alive: true,
    });

    const checker = new PermissionChecker({ store });
    await expect(checker.assertPermission(MEMBER_ID, PAGE_ID, 'write')).resolves.toMatchObject({
      allowed: true,
      role: 'write',
    });
    await expect(checker.assertPermission(MEMBER_ID, PAGE_ID, 'admin')).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('enforces workspace RBAC for owner, admin, member, and guest roles', async () => {
    expect(WORKSPACE_ROLE_CAPABILITIES.owner.has('delete_workspace')).toBe(true);
    expect(WORKSPACE_ROLE_CAPABILITIES.admin.has('delete_workspace')).toBe(false);
    expect(hasWorkspaceCapability(null, 'view_workspace')).toBe(false);

    const store = new InMemoryAclStore();
    store.addWorkspace({
      id: SPACE_ID,
      name: 'RBAC Space',
      domain: 'rbac',
      settings: { guests_can_invite: false },
    });
    store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: OWNER_ID, role: 'owner' });
    store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: ADMIN_ID, role: 'admin' });
    store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: MEMBER_ID, role: 'member' });
    store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: GUEST_ID, role: 'guest' });

    const checker = new PermissionChecker({ store });

    expect(await checker.canPerformWorkspaceAction(OWNER_ID, SPACE_ID, 'delete_workspace')).toBe(true);
    expect(await checker.canPerformWorkspaceAction(ADMIN_ID, SPACE_ID, 'manage_members')).toBe(true);
    expect(await checker.canPerformWorkspaceAction(ADMIN_ID, SPACE_ID, 'delete_workspace')).toBe(false);
    expect(await checker.canPerformWorkspaceAction(MEMBER_ID, SPACE_ID, 'create_root_page')).toBe(true);
    expect(await checker.canPerformWorkspaceAction(MEMBER_ID, SPACE_ID, 'manage_members')).toBe(false);
    expect(await checker.canPerformWorkspaceAction(GUEST_ID, SPACE_ID, 'invite_guests')).toBe(false);

    // Workspace setting `guests_can_invite: true` dynamically unlocks guest invitations.
    await store.updateWorkspaceSettings(SPACE_ID, { guests_can_invite: true });
    expect(await checker.canPerformWorkspaceAction(GUEST_ID, SPACE_ID, 'invite_guests')).toBe(true);

    expect(await checker.hasWorkspaceRole(OWNER_ID, SPACE_ID, 'admin')).toBe(true);
    expect(await checker.hasWorkspaceRole(MEMBER_ID, SPACE_ID, 'admin')).toBe(false);
  });
});

describe('Redis InheritanceCache key schema, TTL, and ioredis compatibility', () => {
  it('uses canonical key schema `acl:space:<space_id>:user:<user_id>:entity:<entity_id>` with 5-minute TTL', async () => {
    // Compile-time check: production ioredis `Redis` satisfies `RedisClientLike`.
    expectTypeOf<Redis>().toMatchTypeOf<RedisClientLike>();

    let nowMs = 1_700_000_000_000;
    const redis = new InMemoryRedisClient(() => nowMs);
    const cache = new InheritanceCache({ redis });

    expect(DEFAULT_ACL_CACHE_TTL_SECONDS).toBe(300);
    expect(cache.buildKey(SPACE_ID, MEMBER_ID, PAGE_ID)).toBe(
      `acl:space:${SPACE_ID}:user:${MEMBER_ID}:entity:${PAGE_ID}`,
    );
    expect(cache.buildKey(SPACE_ID, null, PAGE_ID)).toBe(
      `acl:space:${SPACE_ID}:user:anonymous:entity:${PAGE_ID}`,
    );

    await cache.set(SPACE_ID, MEMBER_ID, PAGE_ID, {
      role: 'write',
      source: 'workspace_member',
      reason: 'granted',
      resolvedAtEntityTable: 'space',
      resolvedAtEntityId: SPACE_ID,
    });

    // Cached entry valid at t = +299s.
    nowMs += 299_000;
    expect(await cache.get(SPACE_ID, MEMBER_ID, PAGE_ID)).toMatchObject({
      role: 'write',
      source: 'workspace_member',
    });

    // Expires at t = +300s (5 minutes).
    nowMs += 1_000;
    expect(await cache.get(SPACE_ID, MEMBER_ID, PAGE_ID)).toBeNull();
  });

  it('instantiates DrizzleAclStore against @votion/db without opening a live socket', () => {
    const handle = createDatabase({
      connectionString:
        'postgresql://votion:test@ep-votion-pooler.us-east-1.aws.neon.tech/votion?sslmode=require',
      driver: 'neon-http',
      env: {},
    });
    const store = new DrizzleAclStore({ db: handle.db });
    expect(store).toBeInstanceOf(DrizzleAclStore);
  });
});
