# Autonomous Agent Harness Prompt: Phase 2 (Client State & Offline Engine)

> **File Location**: `HARNESS/Phase-2.md`  
> **Target Subsystem**: Phase 2 — Client-Side State, Cache & Offline Engine (`@votion/sync-client`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-2 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all deliverables defined in **Phase 2** of `TODO.md`. You will create `@votion/sync-client`, which provides the local-first engine of Votion: normalized in-memory caching with Zustand, persistent IndexedDB storage with Dexie.js, the command-pattern `TransactionBuilder`, the `OptimisticPatcher`, the offline `OutboxQueue`, and the `SyncManager`.

### Operational Guardrails
- **Committer Identity**: You **MUST** commit, push, and open Pull Requests with identity:
  - Name: `Nexuss-Onyx`
  - Email: `tadd4212@gmail.com`
  - Setup command: `git config user.name "Nexuss-Onyx" && git config user.email "tadd4212@gmail.com"`
- **Automatic Pull Request (Zero-Approval Required)**: When all verification checks pass and work is complete, you **MUST automatically open a Pull Request against `main`** without waiting for manual approval.
1. **Local-First Reliability**: Mutations must execute against local state in 0ms without waiting for network responses.
2. **Network Resilience**: Outbox queue must persist across page refreshes via IndexedDB and guarantee in-order delivery upon reconnect.
3. **Strict Verification**: No task may be marked complete in `TODO.md` until all automated tests pass with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-2-client-sync-engine
```

### Step 1: Package Scaffolding (`packages/sync-client`)
* Create `packages/sync-client/package.json` with dependencies: `zustand`, `dexie`, `@votion/types`, `nanoid`.
* Configure `tsconfig.json` extending `@votion/typescript-config/base.json`.

### Step 2: Normalized In-Memory Store (`src/store/`)
* `RecordStore.ts`:
  - Normalized state slices:
    - `blocks: Record<UUID, Block>`
    - `collections: Record<UUID, Collection>`
    - `collectionViews: Record<UUID, CollectionView>`
  - Action methods: `setRecord`, `updateRecord`, `removeRecord`, `loadRecords`.
* `Selectors.ts`:
  - Memoized queries: `selectBlock(id)`, `selectChildBlocks(parentId)`, `selectCollection(id)`.

### Step 3: IndexedDB Persistence Layer (`src/storage/`)
* `IndexedDBStorage.ts`:
  - Dexie database class `VotionDatabase`:
    - Tables: `blocks`, `collections`, `collectionViews`, `outbox`.
    - Primary key: `id`. Indexes: `space_id`, `parent_id`.
  - Methods: `persistRecord`, `loadAllLocalRecords`, `clearLocalData`.
* `OutboxStorage.ts`:
  - Table: `outbox` storing pending `Transaction[]` objects ordered by timestamp.
  - Methods: `enqueueTransaction`, `peekTransactions`, `dequeueTransactions`.

### Step 4: Transaction & Mutation Engine (`src/transaction/`)
* `TransactionBuilder.ts`:
  - Generates serializable operations:
    - `set(pointer, path, args)`
    - `update(pointer, path, args)`
    - `listAfter(pointer, path, targetId, newId)`
    - `listBefore(pointer, path, targetId, newId)`
    - `listRemove(pointer, path, targetId)`
  - Packages operations into an atomic `Transaction` with UUID and space ID.
* `OptimisticPatcher.ts`:
  - Applies transaction operations directly to the local Zustand `RecordStore` before network dispatch.

### Step 5: Sync Manager & Reconciler (`src/sync/`)
* `SyncManager.ts`:
  - Manages the synchronization lifecycle:
    1. Apply mutation locally via `OptimisticPatcher`.
    2. Write to `IndexedDBStorage` and `OutboxStorage`.
    3. If online, dispatch `POST /api/v3/saveTransactions`.
    4. On success, remove from outbox.
    5. On offline / failure, retain in outbox and register window `online` listener.
* `Reconciler.ts`:
  - Compares remote record version with local version; applies non-conflicting field patches.

### Step 6: Presence Client (`src/presence/`)
* `PresenceClient.ts`:
  - Throttles mouse coordinate emissions (max 20Hz).
  - Emits active block selection ID and character range.
  - Stores incoming peer presence records in local ephemeral state.

---

## 3. Strict Verification & Gate Checklist

Run unit tests and verification commands. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/sync-client run build` | Builds TypeScript library. Exit 0. |
| **V-02** | `pnpm --filter @votion/sync-client run test` | Vitest / Jest tests pass for store, patcher, and outbox. Exit 0. |
| **V-03** | Automated outbox test | Verifies offline enqueue $\rightarrow$ simulate reconnect $\rightarrow$ flush in sequence. Exit 0. |
| **V-04** | `pnpm turbo run typecheck` | Monorepo typecheck passes. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 2: Client State & Offline Engine**| `@votion/sync-client` | ✅ Completed | 10 / 10 |
   ```
2. Check off all tasks under `## Phase 2: Client-Side State, Cache & Offline Engine`.

---

## 5. Pull Request & Delivery Report Template

```bash
# 1. Enforce author & committer identity
git config user.name "Nexuss-Onyx"
git config user.email "tadd4212@gmail.com"

# 2. Stage, commit, and push
git add .
git commit -m "feat(sync-client): implement normalized store, IndexedDB cache, and optimistic transaction engine"
git push -u origin feature/phase-2-client-sync-engine

# 3. Automatically open Pull Request against main (Zero manual approval required)
if command -v gh >/dev/null 2>&1; then
  gh pr create --base main --head feature/phase-2-client-sync-engine \
    --title "feat(sync-client): implement normalized store, IndexedDB cache, and optimistic transaction engine" \
    --body "Automated delivery report for this phase. All verification gates passed with exit code 0."
else
  curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN:-$GH_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/Nexuss-Onyx/Votion/pulls \
    -d '{
      "title": "feat(sync-client): implement normalized store, IndexedDB cache, and optimistic transaction engine",
      "head": "feature/phase-2-client-sync-engine",
      "base": "main",
      "body": "Automated delivery report for this phase. All verification gates passed with exit code 0."
    }'
fi
```

Output format:
```markdown
# 🚀 Phase 2 Delivery Report & Pull Request

### PR Title
`feat(sync-client): implement normalized store, IndexedDB cache, and optimistic transaction engine`

### Branch
`feature/phase-2-client-sync-engine` ➡️ `main`

### Summary of Changes
- Built `@votion/sync-client` with normalized Zustand record cache and memoized tree selectors.
- Integrated Dexie.js for IndexedDB browser persistence.
- Implemented `TransactionBuilder` and `OptimisticPatcher` for zero-latency local updates.
- Built persistent `OutboxStorage` for offline transaction queueing and automatic replay upon reconnect.
- Implemented `PresenceClient` for ephemeral multi-cursor sharing.

### Verification Evidence
- [x] Store mutation & optimistic patching unit tests passed (Exit 0)
- [x] Dexie IndexedDB read/write serialization passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
