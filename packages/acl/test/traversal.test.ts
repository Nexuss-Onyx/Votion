import { describe, expect, it } from 'vitest';

import {
  InMemoryAclStore,
  PermissionChecker,
  Traverser,
} from '../src/index.js';

const SPACE_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_SPACE_ID = '00000000-0000-4000-8000-000000000099';

const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const ADMIN_ID = '10000000-0000-4000-8000-000000000002';
const MEMBER_ID = '10000000-0000-4000-8000-000000000003';
const GUEST_ID = '10000000-0000-4000-8000-000000000004';
const OUTSIDER_ID = '10000000-0000-4000-8000-000000000005';

// 5-level nested block tree under SPACE_ID:
// Level 1: rootPage -> parent: space
// Level 2: subPage -> parent: rootPage
// Level 3: toggleBlock -> parent: subPage
// Level 4: calloutBlock -> parent: toggleBlock
// Level 5: leafTextBlock -> parent: calloutBlock
const LEVEL_1_PAGE = '20000000-0000-4000-8000-000000000001';
const LEVEL_2_PAGE = '20000000-0000-4000-8000-000000000002';
const LEVEL_3_TOGGLE = '20000000-0000-4000-8000-000000000003';
const LEVEL_4_CALLOUT = '20000000-0000-4000-8000-000000000004';
const LEVEL_5_LEAF = '20000000-0000-4000-8000-000000000005';

function createFiveLevelTreeStore(): InMemoryAclStore {
  const store = new InMemoryAclStore();

  store.addWorkspace({
    id: SPACE_ID,
    name: 'Acme Engineering',
    domain: 'acme',
    settings: {},
  });

  store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: OWNER_ID, role: 'owner' });
  store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: ADMIN_ID, role: 'admin' });
  store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: MEMBER_ID, role: 'member' });
  store.addWorkspaceMember({ workspaceId: SPACE_ID, userId: GUEST_ID, role: 'guest' });

  store.addBlock({
    id: LEVEL_1_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: SPACE_ID,
    parentTable: 'space',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: LEVEL_2_PAGE,
    spaceId: SPACE_ID,
    type: 'page',
    parentId: LEVEL_1_PAGE,
    parentTable: 'block',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: LEVEL_3_TOGGLE,
    spaceId: SPACE_ID,
    type: 'toggle',
    parentId: LEVEL_2_PAGE,
    parentTable: 'block',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: LEVEL_4_CALLOUT,
    spaceId: SPACE_ID,
    type: 'callout',
    parentId: LEVEL_3_TOGGLE,
    parentTable: 'block',
    content: [],
    alive: true,
  });
  store.addBlock({
    id: LEVEL_5_LEAF,
    spaceId: SPACE_ID,
    type: 'text',
    parentId: LEVEL_4_CALLOUT,
    parentTable: 'block',
    content: [],
    alive: true,
  });

  return store;
}

describe('recursive permission hierarchy traversal (5-level nested block tree)', () => {
  it('climbs all 5 block levels up to the workspace root and resolves owner/admin/member roles', async () => {
    const store = createFiveLevelTreeStore();
    const traverser = new Traverser({ store });
    const checker = new PermissionChecker({ store, traverser });

    // Owner inherits `admin` at level 5 via 6-node climb (5 blocks + space).
    const ownerRes = await traverser.resolveBlockPermission(OWNER_ID, LEVEL_5_LEAF);
    expect(ownerRes.allowed).toBe(true);
    expect(ownerRes.role).toBe('admin');
    expect(ownerRes.source).toBe('workspace_member');
    expect(ownerRes.resolvedAtEntityTable).toBe('space');
    expect(ownerRes.resolvedAtEntityId).toBe(SPACE_ID);
    expect(ownerRes.path.map((s) => `${s.entityTable}:${s.entityId}`)).toEqual([
      `block:${LEVEL_5_LEAF}`,
      `block:${LEVEL_4_CALLOUT}`,
      `block:${LEVEL_3_TOGGLE}`,
      `block:${LEVEL_2_PAGE}`,
      `block:${LEVEL_1_PAGE}`,
      `space:${SPACE_ID}`,
    ]);
    expect(await checker.canAdmin(OWNER_ID, LEVEL_5_LEAF)).toBe(true);
    expect(await checker.canWrite(OWNER_ID, LEVEL_5_LEAF)).toBe(true);
    expect(await checker.canComment(OWNER_ID, LEVEL_5_LEAF)).toBe(true);
    expect(await checker.canRead(OWNER_ID, LEVEL_5_LEAF)).toBe(true);

    // Admin also inherits `admin`.
    expect(await checker.canAdmin(ADMIN_ID, LEVEL_5_LEAF)).toBe(true);

    // Member inherits `write` (read + comment + write, but NOT admin).
    const memberRes = await traverser.resolveBlockPermission(MEMBER_ID, LEVEL_5_LEAF);
    expect(memberRes.role).toBe('write');
    expect(await checker.canRead(MEMBER_ID, LEVEL_5_LEAF)).toBe(true);
    expect(await checker.canComment(MEMBER_ID, LEVEL_5_LEAF)).toBe(true);
    expect(await checker.canWrite(MEMBER_ID, LEVEL_5_LEAF)).toBe(true);
    expect(await checker.canAdmin(MEMBER_ID, LEVEL_5_LEAF)).toBe(false);
  });

  it('denies workspace guests and non-members by default when no explicit grant exists', async () => {
    const store = createFiveLevelTreeStore();
    const checker = new PermissionChecker({ store });

    const guestRes = await checker.resolve(GUEST_ID, LEVEL_5_LEAF);
    expect(guestRes.allowed).toBe(false);
    expect(guestRes.role).toBeNull();
    expect(guestRes.reason).toBe('guest_no_explicit_grant');
    expect(await checker.canRead(GUEST_ID, LEVEL_5_LEAF)).toBe(false);

    const outsiderRes = await checker.resolve(OUTSIDER_ID, LEVEL_5_LEAF);
    expect(outsiderRes.allowed).toBe(false);
    expect(outsiderRes.role).toBeNull();
    expect(outsiderRes.reason).toBe('not_a_member');
    expect(await checker.canRead(OUTSIDER_ID, LEVEL_5_LEAF)).toBe(false);
  });

  it('traverses through collection parents (`parent_table === "collection"`) and evaluates collection permissions', async () => {
    const store = createFiveLevelTreeStore();
    const collectionViewBlockId = '30000000-0000-4000-8000-000000000001';
    const collectionId = '30000000-0000-4000-8000-000000000002';
    const rowPageId = '30000000-0000-4000-8000-000000000003';
    const rowTextId = '30000000-0000-4000-8000-000000000004';

    store.addBlock({
      id: collectionViewBlockId,
      spaceId: SPACE_ID,
      type: 'collection_view',
      parentId: LEVEL_1_PAGE,
      parentTable: 'block',
      content: [],
      alive: true,
    });
    store.addCollection({
      id: collectionId,
      spaceId: SPACE_ID,
      parentId: collectionViewBlockId,
      alive: true,
    });
    store.addBlock({
      id: rowPageId,
      spaceId: SPACE_ID,
      type: 'page',
      parentId: collectionId,
      parentTable: 'collection',
      content: [],
      alive: true,
    });
    store.addBlock({
      id: rowTextId,
      spaceId: SPACE_ID,
      type: 'text',
      parentId: rowPageId,
      parentTable: 'block',
      content: [],
      alive: true,
    });

    const traverser = new Traverser({ store });

    // Without a collection override, climbs: rowText -> rowPage -> collection -> collectionView -> rootPage -> space.
    const memberRes = await traverser.resolveBlockPermission(MEMBER_ID, rowTextId);
    expect(memberRes.role).toBe('write');
    expect(memberRes.path.map((s) => `${s.entityTable}:${s.entityId}`)).toEqual([
      `block:${rowTextId}`,
      `block:${rowPageId}`,
      `collection:${collectionId}`,
      `block:${collectionViewBlockId}`,
      `block:${LEVEL_1_PAGE}`,
      `space:${SPACE_ID}`,
    ]);

    // Adding an explicit permission directly on the collection grants the guest access to all rows/cells.
    await store.setPermission({
      id: '40000000-0000-4000-8000-000000000001',
      workspaceId: SPACE_ID,
      entityTable: 'collection',
      entityId: collectionId,
      principalType: 'user',
      principalId: GUEST_ID,
      role: 'comment',
    });

    const guestRowRes = await traverser.resolveBlockPermission(GUEST_ID, rowTextId);
    expect(guestRowRes.allowed).toBe(true);
    expect(guestRowRes.role).toBe('comment');
    expect(guestRowRes.resolvedAtEntityTable).toBe('collection');
    expect(guestRowRes.resolvedAtEntityId).toBe(collectionId);
  });

  it('fails closed on missing, soft-deleted, cyclic, over-depth, and cross-workspace graphs', async () => {
    const store = createFiveLevelTreeStore();
    const traverser = new Traverser({ store, maxDepth: 4 });

    // 1. Missing block -> DENY
    const missing = await traverser.resolveBlockPermission(
      OWNER_ID,
      '99999999-0000-4000-8000-000000000000',
    );
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toBe('entity_not_found');

    // 2. Exceeds maxDepth (5-level tree needs 5 hops to reach space, maxDepth is 4) -> DENY
    const tooDeep = await traverser.resolveBlockPermission(OWNER_ID, LEVEL_5_LEAF);
    expect(tooDeep.allowed).toBe(false);
    expect(tooDeep.reason).toBe('max_depth_exceeded');

    // 3. Soft-deleted ancestor -> DENY even for workspace owner
    const fullTraverser = new Traverser({ store });
    await store.softDeleteBlock(LEVEL_3_TOGGLE);
    const deletedAncestor = await fullTraverser.resolveBlockPermission(
      OWNER_ID,
      LEVEL_5_LEAF,
    );
    expect(deletedAncestor.allowed).toBe(false);
    expect(deletedAncestor.reason).toBe('parent_deleted');

    // 4. Cyclic parent pointers -> DENY without hanging
    const cycleA = '50000000-0000-4000-8000-000000000001';
    const cycleB = '50000000-0000-4000-8000-000000000002';
    store.addBlock({
      id: cycleA,
      spaceId: SPACE_ID,
      type: 'text',
      parentId: cycleB,
      parentTable: 'block',
      content: [],
      alive: true,
    });
    store.addBlock({
      id: cycleB,
      spaceId: SPACE_ID,
      type: 'text',
      parentId: cycleA,
      parentTable: 'block',
      content: [],
      alive: true,
    });
    const cyclic = await fullTraverser.resolveBlockPermission(OWNER_ID, cycleA);
    expect(cyclic.allowed).toBe(false);
    expect(cyclic.reason).toBe('cycle_detected');

    // 5. Cross-workspace parent pointer spoofing -> DENY
    store.addWorkspace({
      id: OTHER_SPACE_ID,
      name: 'Other Workspace',
      domain: 'other',
      settings: {},
    });
    const spoofedBlock = '60000000-0000-4000-8000-000000000001';
    store.addBlock({
      id: spoofedBlock,
      spaceId: OTHER_SPACE_ID,
      type: 'text',
      parentId: LEVEL_1_PAGE, // belongs to SPACE_ID!
      parentTable: 'block',
      content: [],
      alive: true,
    });
    const mismatch = await fullTraverser.resolveBlockPermission(
      OWNER_ID,
      spoofedBlock,
    );
    expect(mismatch.allowed).toBe(false);
    expect(mismatch.reason).toBe('workspace_mismatch');
  });
});
