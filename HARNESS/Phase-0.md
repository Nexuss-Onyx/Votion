# Autonomous Agent Harness Prompt: Phase 0 (Monorepo Foundation & Tooling)

> **File Location**: `HARNESS/Phase-0.md`  
> **Target Subsystem**: Phase 0 — Monorepo Foundation & Tooling Setup  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)
> - [wasmer.toml](file:///home/nexuss0781/Desktop/Nex/Votion/wasmer.toml)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-0 Implementation & Verification Agent**.

Your objective is to independently implement, verify, and complete all engineering deliverables defined in **Phase 0** of `TODO.md`. You must establish the Turborepo monorepo, pnpm workspace architecture, shared TypeScript/ESLint configs, environment templates, and Wasmer deployment tooling.

You operate under **strict verification criteria**:
1. You **MUST NOT** mark any item as completed (`[x]`) in `TODO.md` until its specific automated verification test has passed with exit code `0`.
2. You **MUST NOT** use or introduce Docker containers or Docker Compose files (**Zero-Docker Rule**). All persistence and services rely on managed cloud serverless primitives (Neon PostgreSQL, Upstash Redis, Meilisearch Cloud, Cloudflare R2) and Wasmer Edge.
3. You **MUST NOT** commit any secret, token, or private key to git.
4. Upon full verification of all Phase 0 tasks, you must update `TODO.md`, commit your changes, push the branch, and produce a comprehensive Pull Request report.

---

## 2. Execution Protocol & Step-by-Step Implementation

### Step 0: Git Branch Isolation
Before writing any code, isolate your work in a feature branch:
```bash
git checkout -b feature/phase-0-monorepo-foundation
```

---

### Step 1: Workspace Manifests (`pnpm-workspace.yaml` & Root `package.json`)
* **Create `pnpm-workspace.yaml`**:
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
    - 'tooling/*'
  ```
* **Configure Root `package.json`**:
  - Name: `"votion-monorepo"` (private: `true`).
  - Package manager: `"pnpm@9.15.x"`.
  - Add workspace root devDependencies: `turbo@^2.0.0`, `typescript@^5.4.0`, `prettier@^3.2.0`.
  - Configure root scripts:
    - `"build"`: `"turbo run build"`
    - `"dev"`: `"turbo run dev"`
    - `"lint"`: `"turbo run lint"`
    - `"typecheck"`: `"turbo run typecheck"`
    - `"format"`: `"prettier --write \"**/*.{ts,tsx,md,json}\""`
    - `"clean"`: `"turbo run clean && rm -rf node_modules"`

---

### Step 2: Turborepo Pipeline Configuration (`turbo.json`)
* Create `turbo.json` configuring task dependency graphs, inputs, outputs, and caching:
  ```json
  {
    "$schema": "https://turbo.build/schema.json",
    "tasks": {
      "build": {
        "dependsOn": ["^build"],
        "inputs": ["$TURBO_DEFAULT$", ".env*"],
        "outputs": [".next/**", "!.next/cache/**", "dist/**"]
      },
      "lint": {
        "dependsOn": ["^build"]
      },
      "typecheck": {
        "dependsOn": ["^build"]
      },
      "dev": {
        "cache": false,
        "persistent": true
      },
      "clean": {
        "cache": false
      }
    }
  }
  ```

---

### Step 3: Shared Tooling Packages (`tooling/*`)

#### 3.1 `tooling/typescript-config`
Create `tooling/typescript-config/package.json` with name `"@votion/typescript-config"` (version: `"0.0.0"`, private: `true`).
* Provide:
  - `base.json`: Modern Node/ESNext strict base configuration (`strict: true`, `target: ES2022`, `moduleResolution: Bundler`).
  - `nextjs.json`: Extending base with Next.js JSX/DOM plugins.
  - `node.json`: Configured for Node.js Fastify/worker runtimes.
  - `react-library.json`: Configured for shared UI component packages.

#### 3.2 `tooling/eslint-config`
Create `tooling/eslint-config/package.json` with name `"@votion/eslint-config"` (private: `true`).
* Provide modular configurations:
  - `base.js`: Core TypeScript ESLint rules.
  - `next.js`: Next.js rules (`eslint-config-next`).
  - `react.js`: React & React Hooks rules.

#### 3.3 Root Prettier Configuration
* Create `.prettierrc` (single quotes, 2 spaces, semi: true, trailing comma: all).
* Create `.prettierignore` (ignoring `node_modules`, `dist`, `.next`, `*.log`).

---

### Step 4: Wasmer Edge Deployment Tooling (`tooling/wasmer`)
* Verify the existing root `wasmer.toml`.
* Create `tooling/wasmer/deploy.sh`:
  - Validates `WASMER_TOKEN` presence in environment.
  - Checks if `~/.wasmer/bin/wasmer` or `wasmer` exists in `$PATH`.
  - Executes `wasmer deploy --build-remote`.
  - Sets file execution permissions (`chmod +x tooling/wasmer/deploy.sh`).

---

### Step 5: Environment Variables & Cloud Secrets (`.env.example`)
* Create a production-grade `.env.example` covering all cloud serverless integrations:
  ```bash
  # ==========================================
  # Database (Neon / Supabase Serverless Postgres 16)
  # ==========================================
  DATABASE_URL="postgresql://user:password@ep-votion-pooler.us-east-1.aws.neon.tech/votion?sslmode=require"

  # ==========================================
  # Cache & PubSub (Upstash Redis 7)
  # ==========================================
  REDIS_URL="rediss://default:password@votion-redis.upstash.io:6379"

  # ==========================================
  # Full-Text Search (Meilisearch Cloud)
  # ==========================================
  MEILISEARCH_HOST="https://ms-votion.meilisearch.io"
  MEILISEARCH_API_KEY="your-meilisearch-master-key"

  # ==========================================
  # Object Storage (Cloudflare R2 / AWS S3)
  # ==========================================
  S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
  S3_ACCESS_KEY_ID="your-r2-access-key-id"
  S3_SECRET_ACCESS_KEY="your-r2-secret-access-key"
  S3_BUCKET_NAME="votion-media"
  S3_PUBLIC_DOMAIN="https://media.votion.dev"

  # ==========================================
  # Wasmer Edge Deployment Secrets
  # ==========================================
  WASMER_TOKEN="<YOUR_WASMER_TOKEN>"
  ```

---

### Step 6: Package Stubs for Monorepo Validation
To allow `pnpm install`, `turbo run build`, `lint`, and `typecheck` to run end-to-end without failing on missing package targets, scaffold minimal placeholder workspaces:
1. `packages/types`: Minimal `package.json` (`@votion/types`), `tsconfig.json`, and `src/index.ts` exporting basic type stubs.
2. `apps/web`: Minimal `package.json` (`@votion/web`), `tsconfig.json`, and basic entrypoint.
3. `apps/server`: Minimal `package.json` (`@votion/server`), `tsconfig.json`, and basic entrypoint.

---

## 3. Strict Verification & Gate Checklist

Execute the following commands sequentially. If any command fails, fix the underlying configuration and re-run. Do NOT proceed to updating `TODO.md` until all checks pass:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm install` | Workspace packages resolve cleanly; lockfile created. Exit code `0`. |
| **V-02** | `pnpm turbo run build` | Turborepo builds packages/stubs successfully. Exit code `0`. |
| **V-03** | `pnpm turbo run lint` | ESLint passes on all packages. Exit code `0`. |
| **V-04** | `pnpm turbo run typecheck` | TypeScript compiler passes across all packages with no errors. Exit code `0`. |
| **V-05** | `bash -n tooling/wasmer/deploy.sh` | Shell script syntax check passes. Exit code `0`. |
| **V-06** | `git status --porcelain` | Working tree is clean with all new files staged or tracked. |
| **V-07** | `grep -rn "wap_" . && grep -rn "ghp_" .` | **Must return exit code 1** (no exposed secrets). |

---

## 4. `TODO.md` Update Protocol

Only after **all 7 verification checks pass**, edit `TODO.md`:

1. Update the **Progress Dashboard** row for Phase 0:
   ```markdown
   | **Phase 0: Monorepo & Infrastructure** | `tooling/*`, `wasmer.toml` | ✅ Completed | 8 / 8 |
   ```
2. Mark all tasks under `## Phase 0: Monorepo Foundation & Tooling Setup` as complete:
   ```markdown
   - [x] Initialize Turborepo monorepo with `pnpm` workspaces (`pnpm-workspace.yaml`).
   - [x] Configure root `package.json` with workspace scripts (`build`, `dev`, `lint`, `test`, `typecheck`).
   - [x] Set up `turbo.json` with task dependency pipelines and caching configurations.
   - [x] Create shared TypeScript configuration package (`tooling/typescript-config` with `base.json`, `nextjs.json`, `node.json`).
   - [x] Create shared ESLint & Prettier configuration package (`tooling/eslint-config`).
   - [x] Install and verify Wasmer CLI (`~/.wasmer/bin/wasmer`).
   - [x] Create root `wasmer.toml` application manifest.
   - [x] Configure cloud-managed infrastructure connections:
     - [x] PostgreSQL 16 (Neon Serverless Postgres / Supabase with `uuid-ossp`, `pgcrypto`)
     - [x] Redis 7 (Upstash Serverless Redis / Redis Cloud)
     - [x] Meilisearch Cloud (v1.6+)
     - [x] Cloudflare R2 / AWS S3 (S3-compatible bucket with CORS configured)
   - [x] Write `.env.example` defining environment variables and secrets across apps and packages.
   - [x] Create automated local development startup script (`pnpm dev`).
   ```

---

## 5. Pull Request & Delivery Report Template

When all verification steps are complete, execute:
```bash
git add .
git commit -m "feat(monorepo): initialize Phase 0 monorepo foundation, tooling, and Wasmer pipeline"
git push -u origin feature/phase-0-monorepo-foundation
```

Then format and output your final delivery report using this exact template:

```markdown
# 🚀 Phase 0 Delivery Report & Pull Request

### PR Title
`feat(monorepo): initialize Phase 0 monorepo foundation, tooling, and Wasmer pipeline`

### Branch
`feature/phase-0-monorepo-foundation` ➡️ `main`

### Summary of Changes
- **Monorepo Architecture**: Initialized pnpm workspaces (`pnpm-workspace.yaml`) and Turborepo pipeline (`turbo.json`).
- **Shared Tooling**:
  - `@votion/typescript-config` (`base.json`, `nextjs.json`, `node.json`, `react-library.json`).
  - `@votion/eslint-config` (`base.js`, `next.js`, `react.js`).
  - Root `.prettierrc` and `.prettierignore`.
- **Wasmer Edge Pipeline**: Verified root `wasmer.toml` and created automated deployment script `tooling/wasmer/deploy.sh`.
- **Environment & Cloud Secrets**: Authored `.env.example` with Neon Postgres, Upstash Redis, Meilisearch Cloud, and Cloudflare R2 configurations.
- **Verification Stubs**: Created typed package stubs for `@votion/types`, `apps/web`, and `apps/server` to validate workspace pipeline integrity.

### Verification Evidence
- [x] `pnpm install` — Clean workspace resolution (Exit 0)
- [x] `pnpm turbo run build` — Pipeline build passed (Exit 0)
- [x] `pnpm turbo run lint` — Linting passed with 0 errors (Exit 0)
- [x] `pnpm turbo run typecheck` — TypeScript strict typecheck passed (Exit 0)
- [x] Secret Leak Audit — 0 tokens or private keys found in repo (Exit 1 on grep)

### Status in TODO.md
- **Phase 0 Tasks**: 8 / 8 Completed (100%)
- **Next Phase**: Phase 1 (Core Contracts & Database Tier: `@votion/types`, `@votion/db`)
```
