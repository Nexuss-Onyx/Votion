# Autonomous Agent Harness Prompt: Phase 12 (Wasmer Edge Deployment & Production Release)

> **File Location**: `HARNESS/Phase-12.md`  
> **Target Subsystem**: Phase 12 — Wasmer Edge Deployment Pipeline & Production Release (`wasmer.toml`, CI/CD)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)
> - [wasmer.toml](file:///home/nexuss0781/Desktop/Nex/Votion/wasmer.toml)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-12 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 8 deliverables defined in **Phase 12** of `TODO.md`. You will establish the production deployment pipeline targeting **Wasmer Edge** without Docker containers or local daemons: refining `wasmer.toml`, configuring GitHub Actions CI/CD for automated remote builds (`wasmer deploy --build-remote`), securing edge environment secrets, applying CSP/CORS security hardening, and authoring the project documentation (`README.md`, `CONTRIBUTING.md`, Wasmer Deployment Guide).

### Operational Guardrails
- **Committer Identity**: You **MUST** commit, push, and open Pull Requests with identity:
  - Name: `Nexuss-Onyx`
  - Email: `tadd4212@gmail.com`
  - Setup command: `git config user.name "Nexuss-Onyx" && git config user.email "tadd4212@gmail.com"`
- **Automatic Pull Request (Zero-Approval Required)**: When all verification checks pass and work is complete, you **MUST automatically open a Pull Request against `main`** without waiting for manual approval.
1. **Zero-Docker Rule**: Deployments must rely exclusively on Wasmer Edge remote building (`wasmer deploy --build-remote`). Do not create or run Docker containers.
2. **Secret Hygiene**: Real tokens (such as `WASMER_TOKEN`) must only be read from local environment variables or GitHub repository secrets. Never commit tokens to source code or git history.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-12-wasmer-deployment-production
```

### Step 1: Wasmer Package Manifest & Capabilities (`wasmer.toml`)
* Refine the root `wasmer.toml` package manifest:
  - Configure HTTP service annotations and routing rules (`/*` to web application).
  - Configure environment secret definitions (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`).
  - Declare package capabilities, metadata, and license (`MIT`).

### Step 2: Automated Deployment Script (`tooling/wasmer/deploy.sh`)
* Implement `tooling/wasmer/deploy.sh`:
  - Validates that `WASMER_TOKEN` is present in the environment.
  - Validates Wasmer CLI presence (`~/.wasmer/bin/wasmer` or `wasmer` in `$PATH`).
  - Executes:
    ```bash
    ~/.wasmer/bin/wasmer deploy --build-remote
    ```
  - Logs deployment status and output URL.
  - Ensure executable permissions (`chmod +x tooling/wasmer/deploy.sh`).

### Step 3: GitHub Actions CI/CD Pipeline (`.github/workflows/`)
* `.github/workflows/ci.yml`:
  - Runs on pull requests to `main`.
  - Installs `pnpm`, executes `pnpm install`, `turbo run lint`, `turbo run typecheck`, and `turbo run test`.
* `.github/workflows/deploy.yml`:
  - Runs on push to `main`.
  - Installs Wasmer CLI.
  - Deploys application to Wasmer Edge using repository secret `secrets.WASMER_TOKEN`:
    ```bash
    wasmer deploy --build-remote --token=${{ secrets.WASMER_TOKEN }}
    ```

### Step 4: Edge Security Hardening
* Configure Content Security Policy (CSP) headers in Next.js / Fastify:
  - Restrict script sources.
  - Allow iframe embedding only for trusted embed providers (YouTube, Figma, GitHub, CodePen).
  - Restrict connect sources to Wasmer Edge backend and WebSocket servers.
* Implement rate limiting on sensitive API routes using Fastify / edge middleware.
* Sanitize all Rich Text and KaTeX expressions to prevent XSS.

### Step 5: Comprehensive Project Documentation
* `README.md`:
  - Overview of Votion, features, and screenshots/diagrams.
  - Architecture highlights (uniform Block model, local-first cache, Wasmer Edge deployment).
  - Quickstart guide for developers (`pnpm install`, `pnpm dev`).
  - Wasmer deployment instructions.
* `CONTRIBUTING.md`:
  - Contribution guidelines, branch naming conventions, PR templates, and coding standards.
* `docs/wasmer-deployment.md`:
  - Step-by-step guide on setting up Wasmer CLI, creating tokens, and managing environment secrets.

---

## 3. Strict Verification & Gate Checklist

Run automated CI/CD and deployment configuration checks. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm turbo run build` | Full monorepo production build succeeds. Exit 0. |
| **V-02** | `pnpm turbo run test` | All unit and integration test suites pass across all packages. Exit 0. |
| **V-03** | `action-validator` or syntax check on `.github/workflows/*.yml` | GitHub Actions YAML files are syntactically valid. Exit 0. |
| **V-04** | `tooling/wasmer/deploy.sh --dry-run` or syntax verification | Wasmer deploy script syntax is valid. Exit 0. |
| **V-05** | `grep -rn "wap_" . && grep -rn "ghp_" .` | **Must return exit code 1** (zero exposed secrets audit). |
| **V-06** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds with 0 errors. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 12: Wasmer Edge Deployment** | `wasmer.toml`, Wasmer CLI | ✅ Completed | 8 / 8 |
   ```
2. Check off all tasks under `## Phase 12: Wasmer Edge Deployment Pipeline & Production Release`.

---

## 5. Pull Request & Delivery Report Template

```bash
# 1. Enforce author & committer identity
git config user.name "Nexuss-Onyx"
git config user.email "tadd4212@gmail.com"

# 2. Stage, commit, and push
git add .
git commit -m "feat(deploy): implement Wasmer Edge deployment pipeline, GitHub Actions CI/CD, and docs"
git push -u origin feature/phase-12-wasmer-deployment-production

# 3. Automatically open Pull Request against main (Zero manual approval required)
if command -v gh >/dev/null 2>&1; then
  gh pr create --base main --head feature/phase-12-wasmer-deployment-production \
    --title "feat(deploy): implement Wasmer Edge deployment pipeline, GitHub Actions CI/CD, and docs" \
    --body "Automated delivery report for this phase. All verification gates passed with exit code 0."
else
  curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN:-$GH_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/Nexuss-Onyx/Votion/pulls \
    -d '{
      "title": "feat(deploy): implement Wasmer Edge deployment pipeline, GitHub Actions CI/CD, and docs",
      "head": "feature/phase-12-wasmer-deployment-production",
      "base": "main",
      "body": "Automated delivery report for this phase. All verification gates passed with exit code 0."
    }'
fi
```

Output format:
```markdown
# 🚀 Phase 12 Delivery Report & Pull Request

### PR Title
`feat(deploy): implement Wasmer Edge deployment pipeline, GitHub Actions CI/CD, and docs`

### Branch
`feature/phase-12-wasmer-deployment-production` ➡️ `main`

### Summary of Changes
- Refined `wasmer.toml` package manifest for zero-Docker edge deployments with remote building.
- Created automated deployment script `tooling/wasmer/deploy.sh`.
- Set up GitHub Actions CI/CD workflows (`.github/workflows/ci.yml` and `deploy.yml`) using `WASMER_TOKEN`.
- Configured Content Security Policy (CSP) and rate limiting security hardening.
- Authored comprehensive project documentation: `README.md`, `CONTRIBUTING.md`, and Wasmer Deployment Guide.

### Verification Evidence
- [x] Full monorepo build and test suite passed (Exit 0)
- [x] GitHub Actions workflow syntax validation passed (Exit 0)
- [x] Secret audit passed (0 credentials in repository) (Exit 1 on grep)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
