# Contributing to Votion

Thank you for your interest in contributing to **Votion**! This guide covers local workspace setup, monorepo package conventions, branch naming, security guardrails, and Pull Request verification gates.

---

## 1. Development Environment Setup

### Prerequisites

- **Node.js** `>= 20`
- **pnpm** `9.15.0` (managed automatically via Corepack)
- **Git**

### Bootstrap

```bash
git clone https://github.com/Nexuss-Onyx/Votion.git
cd Votion
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

### Useful Workspace Commands

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Start development servers in watch mode via Turborepo |
| `pnpm build` | Build all packages and applications (`turbo run build`) |
| `pnpm lint` | Run ESLint across all packages and apps (`turbo run lint`) |
| `pnpm typecheck` | Run strict TypeScript typechecking (`turbo run typecheck`) |
| `pnpm test` | Run all Vitest unit and integration suites (`turbo run test`) |
| `pnpm deploy:dry-run` | Validate `wasmer.toml` and deployment script (`--dry-run`) |
| `pnpm format` | Format TypeScript, Markdown, and JSON files with Prettier |

To target a single workspace package during development:

```bash
pnpm --filter @votion/editor run test
pnpm --filter @votion/server run test
```

---

## 2. Monorepo Package Boundaries

Keep dependencies acyclic and aligned with the layered architecture in [`Components.md`](./Components.md):

1. **`@votion/types`** (`packages/types`): Pure ES2022 data contracts, guards, transaction builders, and XSS/URL/CSP security helpers. **Must have zero runtime dependencies.**
2. **Core Domain Packages** (`@votion/db`, `@votion/acl`, `@votion/search`, `@votion/sync-client`, `@votion/editor`, `@votion/database-engine`): Depend on `@votion/types` (and peer client stores where documented), never on `apps/*`.
3. **Applications** (`apps/web`, `apps/server`, `apps/sync-worker`, `apps/task-worker`): Compose domain packages and bind environment configuration at runtime.

---

## 3. Branching & Commit Conventions

### Branch Naming

Create focused topic branches from `main`:

- `feature/<subsystem-or-description>` — New capabilities (e.g., `feature/board-swimlane-grouping`)
- `fix/<subsystem-or-issue>` — Bug fixes (e.g., `fix/outbox-retry-jitter`)
- `security/<topic>` — Security hardening or sanitizer updates
- `docs/<topic>` — Documentation improvements
- `chore/<topic>` — Tooling, CI, or dependency maintenance

### Conventional Commits

All commit messages and Pull Request titles must follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <concise imperative summary>
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `security`, `test`, `docs`, `ci`, `chore`.

Examples:
- `feat(editor): add keyboard shortcut for inline KaTeX equations`
- `fix(sync-client): preserve operation order when flushing offline outbox`
- `feat(deploy): implement Wasmer Edge deployment pipeline, GitHub Actions CI/CD, and docs`

---

## 4. Coding & Security Standards

1. **Strict TypeScript**:
   - All packages inherit `strict: true` and `noUncheckedIndexedAccess: true` from `@votion/typescript-config`.
   - Validate all external HTTP, WebSocket, and environment inputs at the boundary using Zod schemas or `@votion/types` type guards.
2. **XSS, CSP & Embed Hardening**:
   - Never pass unsanitized strings to `dangerouslySetInnerHTML`. All KaTeX rendering must flow through `renderSafeKatex` (`trust: false`, `sanitizeKatexExpression`, and `sanitizeKatexHtml`).
   - All user-supplied hyperlinks and media sources must be validated via `sanitizeUrl`, and embedded iframes must be validated via `sanitizeEmbedUrl` (restricted to YouTube, Figma, GitHub, and CodePen over HTTPS).
3. **Zero-Docker Deployment Rule**:
   - Do not introduce `Dockerfile`s, `docker-compose.yml`, or local container daemon requirements. Production builds target **Wasmer Edge** (`wasmer deploy --build-remote`).
4. **Secret Hygiene**:
   - Never commit real API keys, JWT secrets, database URLs, or Wasmer tokens to source files, tests, or documentation. Read secrets exclusively from environment variables or GitHub Actions encrypted secrets.

---

## 5. Pull Request Process & CI Gates

Every Pull Request targeting `main` automatically runs [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). Before opening a PR, verify locally that all gates exit with `0`:

```bash
pnpm turbo run build
pnpm turbo run lint
pnpm turbo run typecheck
pnpm turbo run test
./tooling/wasmer/deploy.sh --dry-run
```

Fill out the checklist in [`.github/pull_request_template.md`](./.github/pull_request_template.md) and include unit or integration tests covering any new behavior or bug fix.
