# Wasmer Edge Deployment Guide

Votion deploys directly to **Wasmer Edge** using remote builds (`wasmer deploy --build-remote`) — **zero Docker containers, zero Dockerfiles, and zero local container daemons required**.

This guide walks through installing the Wasmer CLI, creating authentication tokens, provisioning production environment secrets, running manual or CI/CD deployments, and verifying edge security headers.

---

## 1. Architecture Overview

| Tier | Service / Provider | Configuration |
| :--- | :--- | :--- |
| **Edge Compute & Routing** | Wasmer Edge (`web` & `api` HTTP services) | Root [`wasmer.toml`](../wasmer.toml) |
| **Relational Database** | Neon Serverless Postgres 16 / Supabase | `DATABASE_URL` secret (`neon-websocket` driver) |
| **Cache & Realtime Pub/Sub** | Upstash Serverless Redis 7 | `REDIS_URL` secret |
| **Object Storage** | Cloudflare R2 / AWS S3 | `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` secrets |
| **Full-Text Search** | Meilisearch Cloud | `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` secrets |

Routing rules declared in `wasmer.toml`:
- `/api/*`, `/v1/*`, `/health` $\rightarrow$ Fastify Transaction & Developer API service (`api`)
- `/*` $\rightarrow$ Next.js Workspace Web Application (`web`)

---

## 2. Install & Verify the Wasmer CLI

Install the official Wasmer CLI on Linux or macOS:

```bash
curl https://get.wasmer.io -sSfL | sh
```

Reload your shell (or add `~/.wasmer/bin` to `PATH`) and confirm installation:

```bash
~/.wasmer/bin/wasmer --version
```

---

## 3. Generate & Configure `WASMER_TOKEN`

1. Sign in to [wasmer.io](https://wasmer.io) and navigate to **Settings → Access Tokens**.
2. Generate a new deploy-capable access token.
3. **Never commit your token to Git.** Supply it strictly via:
   - **Local shell session** (ephemeral environment variable):
     ```bash
     export WASMER_TOKEN="<YOUR_WASMER_TOKEN>"
     ```
   - **GitHub Actions** (encrypted repository secret):
     1. Open your GitHub repository → **Settings → Secrets and variables → Actions**.
     2. Click **New repository secret**.
     3. Set Name to `WASMER_TOKEN` and paste your token value.

---

## 4. Provision Edge Environment Secrets

`wasmer.toml` binds sensitive runtime configuration from Wasmer Edge encrypted app secrets rather than plain-text config:

```toml
[env]
DATABASE_URL = { secret = "DATABASE_URL" }
REDIS_URL = { secret = "REDIS_URL" }
S3_ENDPOINT = { secret = "S3_ENDPOINT" }
S3_ACCESS_KEY = { secret = "S3_ACCESS_KEY" }
S3_SECRET_KEY = { secret = "S3_SECRET_KEY" }
JWT_SECRET = { secret = "JWT_SECRET" }
WS_JWT_SECRET = { secret = "WS_JWT_SECRET" }
MEILISEARCH_HOST = { secret = "MEILISEARCH_HOST" }
MEILISEARCH_API_KEY = { secret = "MEILISEARCH_API_KEY" }
```

Create or rotate these secrets using the Wasmer CLI (or via the Wasmer Edge web dashboard under **App → Secrets**):

```bash
export WASMER_TOKEN="<YOUR_WASMER_TOKEN>"

~/.wasmer/bin/wasmer app secrets create DATABASE_URL "postgresql://<user>:<pass>@<neon-host>/votion?sslmode=require"
~/.wasmer/bin/wasmer app secrets create REDIS_URL "rediss://default:<pass>@<upstash-host>:6379"
~/.wasmer/bin/wasmer app secrets create S3_ENDPOINT "https://<account-id>.r2.cloudflarestorage.com"
~/.wasmer/bin/wasmer app secrets create S3_ACCESS_KEY "<YOUR_R2_ACCESS_KEY>"
~/.wasmer/bin/wasmer app secrets create S3_SECRET_KEY "<YOUR_R2_SECRET_KEY>"
~/.wasmer/bin/wasmer app secrets create JWT_SECRET "<LONG_RANDOM_PRODUCTION_SECRET>"
~/.wasmer/bin/wasmer app secrets create WS_JWT_SECRET "<LONG_RANDOM_WS_JWT_SECRET>"
~/.wasmer/bin/wasmer app secrets create MEILISEARCH_HOST "https://<project>.meilisearch.io"
~/.wasmer/bin/wasmer app secrets create MEILISEARCH_API_KEY "<YOUR_MEILISEARCH_KEY>"
```

Verify that all secret names are registered (values remain encrypted and hidden):

```bash
~/.wasmer/bin/wasmer app secrets list
```

---

## 5. Manual & Scripted Deployment

### Step 1: Run Pre-Flight Dry-Run Verification

Before triggering a remote build, verify the manifest, required secret bindings, and CLI target:

```bash
./tooling/wasmer/deploy.sh --dry-run
```

### Step 2: Execute Remote Build & Deploy

Run the deployment helper script (which validates `WASMER_TOKEN`, locates `~/.wasmer/bin/wasmer` or `wasmer` in `$PATH`, executes `wasmer deploy --build-remote`, and prints the live edge URL):

```bash
export WASMER_TOKEN="<YOUR_WASMER_TOKEN>"
./tooling/wasmer/deploy.sh --non-interactive
```

Or run the underlying Wasmer CLI command directly from the repository root:

```bash
export WASMER_TOKEN="<YOUR_WASMER_TOKEN>" && ~/.wasmer/bin/wasmer deploy --build-remote
```

---

## 6. Automated GitHub Actions CI/CD

Votion ships two GitHub Actions workflows in [`.github/workflows/`](../.github/workflows):

1. **Pull Request Verification (`ci.yml`)**:
   - Triggered on every PR targeting `main`.
   - Installs `pnpm@9.15.0` and Node.js 20 with store caching.
   - Runs `pnpm turbo run build`, `pnpm turbo run lint`, `pnpm turbo run typecheck`, `pnpm turbo run test`, and `./tooling/wasmer/deploy.sh --dry-run`.
2. **Production Wasmer Edge Release (`deploy.yml`)**:
   - Triggered automatically on push to `main` (and supports manual `workflow_dispatch`).
   - Serializes production releases via `concurrency: wasmer-edge-production-main`.
   - Builds workspace artifacts, installs the Wasmer CLI, and runs:
     ```bash
     wasmer deploy --build-remote --non-interactive --token="${WASMER_TOKEN}"
     ```

---

## 7. Edge Security Checklist

Before opening your deployment to production traffic, confirm:

- **CORS Allowlist**: Set `CORS_ORIGIN` to your exact custom domain and/or `https://*.wasmer.app` (in `NODE_ENV=production`, wildcard `*` reflection is automatically disabled).
- **Content Security Policy (CSP)**: Both `apps/web` (`next.config.mjs`) and `apps/server` (`@fastify/helmet`) emit strict `Content-Security-Policy` headers restricting `frame-src` to YouTube, Figma, GitHub, and CodePen and `connect-src` to `'self'`, `https://*.wasmer.app`, and `wss://*.wasmer.app`.
- **Rate Limiting**: Authentication endpoints (`/api/auth/*`), API key provisioning (`/api/api-keys`), uploads (`/api/v3/getUploadFileUrl`), and transactions (`/api/v3/saveTransactions`) enforce tiered sliding-window limits with `Retry-After` headers.
- **Health Check**: Confirm `GET https://<your-app>.wasmer.app/health` returns `200 OK` (`{"ok":true,"service":"votion-server"}`) with `Content-Security-Policy` and `X-Content-Type-Options: nosniff` headers.
