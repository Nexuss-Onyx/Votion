# `@votion/acl`

Hierarchical access control, recursive permission inheritance, Redis-backed ACL
caching, and public web sharing gateway for Votion.

## Modules

| Module | Responsibility |
| :-- | :-- |
| `Traverser.ts` | Recursive upward graph climb (`block` -> `block` / `collection` -> `space`) with cycle, depth, soft-delete, and workspace-isolation guards |
| `PermissionChecker.ts` | Role capability checks (`canRead`, `canComment`, `canWrite`, `canAdmin`), `assertPermission`, and Workspace RBAC (`owner`, `admin`, `member`, `guest`) |
| `InheritanceCache.ts` | Redis ACL path cache (`acl:space:<space_id>:user:<user_id>:entity:<entity_id>`, 5-minute TTL) with subtree invalidation hooks |
| `PublicAccessGateway.ts` | Public slug (`votion.dev/@workspace/doc`) and custom-domain resolver, strict anonymous read-only enforcement, and SEO `X-Robots-Tag` headers |
| `roles.ts` | Entity (`ROLE_CAPABILITIES`) and workspace (`WORKSPACE_ROLE_CAPABILITIES`) capability matrices |
| `store.ts` | `DrizzleAclStore` (`@votion/db` PostgreSQL) and `InMemoryAclStore` (deterministic unit tests) |

## Security Model

- **Deny by default**: Missing, soft-deleted, cyclic, over-depth, cross-workspace, or ungranted lookups fail closed (`null` / `false`).
- **Nearest override wins**: Explicit `user` or `teamspace` overrides on a block/page take precedence over ancestor and workspace defaults (for both upgrades and downgrades), and `metadata.deny = true` halts upward inheritance immediately.
- **Immediate cache invalidation**: Permission changes, block moves, membership edits, and workspace settings changes evict affected sub-trees from Redis immediately.
- **Strict anonymous read-only**: Public shares are always capped to `'read'` for anonymous visitors and default to `X-Robots-Tag: noindex, nofollow`.

## Verification

```bash
pnpm --filter @votion/acl run build
pnpm --filter @votion/acl run test:traversal
pnpm --filter @votion/acl run test:overrides
pnpm --filter @votion/acl run test:public
pnpm --filter @votion/acl run test
pnpm turbo run typecheck
```
