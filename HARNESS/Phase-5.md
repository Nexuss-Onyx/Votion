# Autonomous Agent Harness Prompt: Phase 5 (Backend API & Transaction Server)

> **File Location**: `HARNESS/Phase-5.md`  
> **Target Subsystem**: Phase 5 — Backend API & Transaction Server (`apps/server`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-5 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 14 deliverables defined in **Phase 5** of `TODO.md`. You will create `apps/server`, a high-throughput Fastify API server running on Node.js / Wasmer Edge that executes the core `POST /api/v3/saveTransactions` pipeline, user authentication with JWTs, `POST /api/v3/loadPageChunk`, database query execution, presigned URL generation for Cloudflare R2 / AWS S3, and Redis Pub/Sub invalidation publishing.

### Operational Guardrails
- **Committer Identity**: You **MUST** commit, push, and open Pull Requests with identity:
  - Name: `Nexuss-Onyx`
  - Email: `tadd4212@gmail.com`
  - Setup command: `git config user.name "Nexuss-Onyx" && git config user.email "tadd4212@gmail.com"`
- **Automatic Pull Request (Zero-Approval Required)**: When all verification checks pass and work is complete, you **MUST automatically open a Pull Request against `main`** without waiting for manual approval.
1. **ACID Transaction Atomicity**: All operations in a transaction batch must execute in a single SQL transaction. If one fails, the entire batch rolls back.
2. **Zero-Docker Rule**: Connect directly to cloud serverless PostgreSQL (Neon) and Upstash Redis via environment variables. Do not use local Docker containers.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-5-backend-transaction-server
```

### Step 1: Application Setup (`apps/server`)
* Create `apps/server/package.json` with dependencies: `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/jwt`, `@fastify/rate-limit`, `@votion/types`, `@votion/db`, `ioredis` (or `@upstash/redis`), `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `zod`, `argon2`.
* Configure `src/index.ts` bootstrapping Fastify with graceful shutdown hooks.

### Step 2: Authentication & Sessions (`src/plugins/auth.ts`, `src/routes/auth.ts`)
* User signup and login routes (`POST /api/auth/register`, `POST /api/auth/login`).
* Password hashing with Argon2.
* JWT access token (15m expiry) and refresh token rotation.
* Fastify auth decorator verifying bearer tokens on protected endpoints.

### Step 3: Core Transaction Pipeline (`src/routes/transactions.route.ts`)
* Implement `POST /api/v3/saveTransactions`:
  1. **Schema Validation**: Parse request body against `Zod` transaction schema.
  2. **Authorization**: Verify the authenticated user is a member of `space_id`.
  3. **Atomic Execution**: In a PostgreSQL transaction:
     - For each operation:
       - Fetch current record version.
       - If `command === 'set'`: Update target path using PostgreSQL `jsonb_set`.
       - If `command === 'update'`: Deep merge JSONB keys.
       - If `command === 'listAfter'`: Mutate array ordering at path.
       - If `command === 'listRemove'`: Remove target ID from array.
       - Increment `version = version + 1`, update `last_edited_time`.
     - Insert record into `transaction_records` (WAL).
  4. **Redis Invalidation**: Publish message to Redis channel `space:<space_id>:events`.
  5. **Response**: Return 200 OK with map of updated record versions.

### Step 4: Record Retrieval & Queries (`src/routes/records.route.ts`)
* Implement `POST /api/v3/loadPageChunk`:
  - Fetch root block by `pageId`.
  - Recursively fetch child blocks up to specified depth limit.
  - Return normalized record payload: `{ recordMap: { block: {...}, collection: {...}, collection_view: {...} } }`.
* Implement `POST /api/v3/queryCollection`:
  - Server-side execution of collection queries with filters, sorts, and pagination.

### Step 5: Object Storage Presigned URLs (`src/routes/assets.route.ts`)
* Implement `POST /api/v3/getUploadFileUrl`:
  - Validate requested file MIME type and size limit.
  - Generate S3 PutObject presigned URL using `@aws-sdk/s3-request-presigner` configured for Cloudflare R2 / AWS S3.
  - Return presigned upload URL and public CDN asset URL.

---

## 3. Strict Verification & Gate Checklist

Run automated API integration tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/server run build` | Compiles Fastify application. Exit 0. |
| **V-02** | `pnpm --filter @votion/server run test:auth` | Authentication registration, login, and JWT tests pass. Exit 0. |
| **V-03** | `pnpm --filter @votion/server run test:transactions` | `saveTransactions` atomic execution and rollback tests pass. Exit 0. |
| **V-04** | `pnpm --filter @votion/server run test:records` | `loadPageChunk` normalized tree response tests pass. Exit 0. |
| **V-05** | `pnpm turbo run typecheck` | Monorepo typecheck passes with 0 errors. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 5: Backend API & Transactions** | `apps/server` | ✅ Completed | 14 / 14 |
   ```
2. Check off all tasks under `## Phase 5: Backend API & Transaction Server`.

---

## 5. Pull Request & Delivery Report Template

```bash
# 1. Enforce author & committer identity
git config user.name "Nexuss-Onyx"
git config user.email "tadd4212@gmail.com"

# 2. Stage, commit, and push
git add .
git commit -m "feat(server): implement Fastify transaction API, loadPageChunk, auth, and S3 presigned URLs"
git push -u origin feature/phase-5-backend-transaction-server

# 3. Automatically open Pull Request against main (Zero manual approval required)
if command -v gh >/dev/null 2>&1; then
  gh pr create --base main --head feature/phase-5-backend-transaction-server \
    --title "feat(server): implement Fastify transaction API, loadPageChunk, auth, and S3 presigned URLs" \
    --body "Automated delivery report for this phase. All verification gates passed with exit code 0."
else
  curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN:-$GH_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/Nexuss-Onyx/Votion/pulls \
    -d '{
      "title": "feat(server): implement Fastify transaction API, loadPageChunk, auth, and S3 presigned URLs",
      "head": "feature/phase-5-backend-transaction-server",
      "base": "main",
      "body": "Automated delivery report for this phase. All verification gates passed with exit code 0."
    }'
fi
```

Output format:
```markdown
# 🚀 Phase 5 Delivery Report & Pull Request

### PR Title
`feat(server): implement Fastify transaction API, loadPageChunk, auth, and S3 presigned URLs`

### Branch
`feature/phase-5-backend-transaction-server` ➡️ `main`

### Summary of Changes
- Built `apps/server` with Fastify, CORS, Helmet, and rate limiting.
- Implemented JWT authentication and session management with Argon2 password hashing.
- Implemented atomic `POST /api/v3/saveTransactions` with JSONB operation patching, version increments, and WAL logging.
- Implemented `POST /api/v3/loadPageChunk` returning normalized `recordMap` trees.
- Implemented S3 presigned PUT URL generation for Cloudflare R2 / AWS S3.
- Integrated Redis Pub/Sub publishing for cross-node realtime invalidation.

### Verification Evidence
- [x] Fastify route integration test suite passed (Exit 0)
- [x] Atomic transaction rollback & versioning tests passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
