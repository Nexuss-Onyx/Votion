# Autonomous Agent Harness Prompt: Phase 7 (Access Control & Permissions)

> **File Location**: `HARNESS/Phase-7.md`  
> **Target Subsystem**: Phase 7 — Access Control & Permissions (`@votion/acl`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-7 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 8 deliverables defined in **Phase 7** of `TODO.md`. You will create `@votion/acl`, which implements Notion's hierarchical permission inheritance engine: workspace roles (Owner, Admin, Member, Guest), recursive tree traversal from blocks up to the workspace root, explicit entity permission overrides, Redis-backed ACL caching, and the public web sharing gateway.

### Operational Guardrails
1. **Security by Default**: If permission cannot be positively verified through explicit rules or upward tree inheritance, access must default to DENY.
2. **Cache Invalidation**: Whenever a permission record or parent pointer changes, the corresponding cached paths in Redis must be invalidated immediately.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-7-access-control-permissions
```

### Step 1: Package Scaffolding (`packages/acl`)
* Create `packages/acl/package.json` with dependencies: `@votion/types`, `@votion/db`, `ioredis` (or `@upstash/redis`).

### Step 2: Recursive Tree Traverser (`src/Traverser.ts`)
* Implement upward graph climb:
  1. For a given `blockId`, check for an explicit row in the `permissions` table for `(entity_id = blockId, user_id = userId)`.
  2. If found $\rightarrow$ return granted access level (`read`, `comment`, `write`, `admin`).
  3. If not found $\rightarrow$ retrieve block's `parent_id` and `parent_table`:
     - If `parent_table === 'block'`: recurse to parent block.
     - If `parent_table === 'collection'`: check collection permissions.
     - If `parent_table === 'space'`: evaluate user's role in `workspace_members`.
  4. Return final resolved permission.

### Step 3: Permission Checker & Roles (`src/PermissionChecker.ts`)
* Define role capabilities matrix:
  - `admin`: Can modify permissions, delete page, read, write, comment.
  - `write`: Can edit block content and create child blocks.
  - `comment`: Can view content and add inline/page comments.
  - `read`: Can view content and export.
* Methods:
  - `canRead(userId, blockId): Promise<boolean>`
  - `canWrite(userId, blockId): Promise<boolean>`
  - `canComment(userId, blockId): Promise<boolean>`
  - `canAdmin(userId, blockId): Promise<boolean>`

### Step 4: Redis Inheritance Cache (`src/InheritanceCache.ts`)
* Key schema: `acl:space:<space_id>:user:<user_id>:entity:<entity_id>`.
* TTL: 5 minutes.
* Invalidation: Hook listening to permission changes or block moves that clears all keys for that sub-tree.

### Step 5: Public Web Gateway (`src/PublicAccessGateway.ts`)
* Validates public sharing permissions:
  - Checks if a page block has an explicit `public` role in `permissions`.
  - Resolves custom public URL slugs (e.g., `votion.dev/@workspace/my-public-doc`).
  - Enforces anonymous read-only access and attaches SEO headers (e.g. `X-Robots-Tag: noindex` if indexing is toggled off).

---

## 3. Strict Verification & Gate Checklist

Run unit and permission traversal tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/acl run build` | Compiles ACL library. Exit 0. |
| **V-02** | `pnpm --filter @votion/acl run test:traversal` | Verifies recursive permission inheritance across a 5-level nested block tree. Exit 0. |
| **V-03** | `pnpm --filter @votion/acl run test:overrides` | Verifies explicit page overrides take precedence over workspace default. Exit 0. |
| **V-04** | `pnpm --filter @votion/acl run test:public` | Verifies public slug resolution and anonymous read permission. Exit 0. |
| **V-05** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 7: Access Control & Permissions** | `@votion/acl` | ✅ Completed | 8 / 8 |
   ```
2. Check off all tasks under `## Phase 7: Access Control & Permissions`.

---

## 5. Pull Request & Delivery Report Template

```bash
git add .
git commit -m "feat(acl): implement recursive permission traverser, explicit overrides, and public web sharing"
git push -u origin feature/phase-7-access-control-permissions
```

Output format:
```markdown
# 🚀 Phase 7 Delivery Report & Pull Request

### PR Title
`feat(acl): implement recursive permission traverser, explicit overrides, and public web sharing`

### Branch
`feature/phase-7-access-control-permissions` ➡️ `main`

### Summary of Changes
- Built `@votion/acl` package implementing hierarchical permission inheritance.
- Implemented `Traverser` climbing block parent edges up to workspace root.
- Built `PermissionChecker` with role verification (`admin`, `write`, `comment`, `read`).
- Implemented Redis-backed ACL cache with invalidation hooks on permission mutations.
- Built `PublicAccessGateway` handling custom public slugs and anonymous read-only access.

### Verification Evidence
- [x] Recursive hierarchy tree traversal tests passed (Exit 0)
- [x] Explicit permission override precedence tests passed (Exit 0)
- [x] Public sharing & slug resolution tests passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
