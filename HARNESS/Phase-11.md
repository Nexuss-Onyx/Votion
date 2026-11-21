# Autonomous Agent Harness Prompt: Phase 11 (Developer API & Automations)

> **File Location**: `HARNESS/Phase-11.md`  
> **Target Subsystem**: Phase 11 — Developer API & Automations (`apps/server/v1`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-11 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 8 deliverables defined in **Phase 11** of `TODO.md`. You will create the public Developer Platform in `apps/server/src/api/v1/`: implementing a RESTful API conforming to Notion's official OpenAPI specification (`/v1/blocks`, `/v1/pages`, `/v1/databases`, `/v1/search`), API token authentication (`secret_...`), HMAC-signed webhook dispatching, and in-database event-driven automations.

### Operational Guardrails
- **Committer Identity**: You **MUST** commit, push, and open Pull Requests with identity:
  - Name: `Nexuss-Onyx`
  - Email: `tadd4212@gmail.com`
  - Setup command: `git config user.name "Nexuss-Onyx" && git config user.email "tadd4212@gmail.com"`
- **Automatic Pull Request (Zero-Approval Required)**: When all verification checks pass and work is complete, you **MUST automatically open a Pull Request against `main`** without waiting for manual approval.
1. **Notion API Compatibility**: Input payloads and JSON response schemas must mirror Notion's public API format so standard Notion SDKs and third-party tools (Zapier, Make, n8n) can connect seamlessly.
2. **Webhook Security**: All webhook requests must include an HMAC-SHA256 signature header (`X-Votion-Signature`) computed with the user's signing secret.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-11-developer-api-automations
```

### Step 1: Integration Tokens & Authentication (`src/api/v1/auth/`)
* Create `api_keys` database model storing internal integration tokens (`secret_...`) hashed with SHA-256.
* Middleware verifying `Authorization: Bearer secret_...` and attaching workspace and bot capabilities to the request.

### Step 2: REST v1 Resource Endpoints (`src/api/v1/`)
* **Blocks Endpoints** (`blocks/`):
  - `GET /v1/blocks/:id`: Retrieve block metadata and properties.
  - `PATCH /v1/blocks/:id`: Update block properties or format.
  - `DELETE /v1/blocks/:id`: Soft-delete block (`alive: false`).
  - `GET /v1/blocks/:id/children`: Paginated list of child block objects.
  - `PATCH /v1/blocks/:id/children`: Append child blocks to a parent.
* **Pages Endpoints** (`pages/`):
  - `POST /v1/pages`: Create a new page in a database or as a sub-page.
  - `GET /v1/pages/:id`: Retrieve page metadata and property values.
  - `PATCH /v1/pages/:id`: Update page properties and cover/icon.
* **Databases Endpoints** (`databases/`):
  - `POST /v1/databases`: Create a new collection schema.
  - `GET /v1/databases/:id`: Retrieve database schema and property definitions.
  - `POST /v1/databases/:id/query`: Filter, sort, and paginate database rows.
* **Search Endpoint** (`search/`):
  - `POST /v1/search`: Global search across pages and databases.

### Step 3: Webhook Dispatcher (`src/api/v1/webhooks/`)
* `WebhookDispatcher.ts`:
  - When records update, checks for active webhook subscriptions in `space_id`.
  - Generates payload: `{ event: 'page.updated', data: {...}, timestamp }`.
  - Computes `X-Votion-Signature = HMAC-SHA256(payload, secret)`.
  - Dispatches HTTP POST with exponential backoff (3 retries).

### Step 4: In-Database Automations Engine (`src/api/v1/automations/`)
* `AutomationEngine.ts`:
  - Evaluates triggers on database mutations:
    - Trigger: `page_added` or `property_edited (property == 'Status' && value == 'Done')`.
  - Executes configured actions:
    - Action: `update_property`, `create_page`, or `dispatch_webhook`.

---

## 3. Strict Verification & Gate Checklist

Run API and automation test suites. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/server run build` | Compiles API v1 routes. Exit 0. |
| **V-02** | `pnpm --filter @votion/server run test:api-v1` | Verifies `/v1/pages`, `/v1/blocks`, and `/v1/databases` endpoints. Exit 0. |
| **V-03** | `pnpm --filter @votion/server run test:webhooks` | Verifies HMAC-SHA256 signature computation and dispatch retry logic. Exit 0. |
| **V-04** | `pnpm --filter @votion/server run test:automations` | Verifies event trigger $\rightarrow$ action execution pipeline. Exit 0. |
| **V-05** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 11: Developer API & Webhooks** | `apps/server/v1` | ✅ Completed | 8 / 8 |
   ```
2. Check off all tasks under `## Phase 11: Developer API & Automations`.

---

## 5. Pull Request & Delivery Report Template

```bash
# 1. Enforce author & committer identity
git config user.name "Nexuss-Onyx"
git config user.email "tadd4212@gmail.com"

# 2. Stage, commit, and push
git add .
git commit -m "feat(api-v1): implement Notion-compatible REST API, HMAC webhooks, and database automations"
git push -u origin feature/phase-11-developer-api-automations

# 3. Automatically open Pull Request against main (Zero manual approval required)
if command -v gh >/dev/null 2>&1; then
  gh pr create --base main --head feature/phase-11-developer-api-automations \
    --title "feat(api-v1): implement Notion-compatible REST API, HMAC webhooks, and database automations" \
    --body "Automated delivery report for this phase. All verification gates passed with exit code 0."
else
  curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN:-$GH_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/Nexuss-Onyx/Votion/pulls \
    -d '{
      "title": "feat(api-v1): implement Notion-compatible REST API, HMAC webhooks, and database automations",
      "head": "feature/phase-11-developer-api-automations",
      "base": "main",
      "body": "Automated delivery report for this phase. All verification gates passed with exit code 0."
    }'
fi
```

Output format:
```markdown
# 🚀 Phase 11 Delivery Report & Pull Request

### PR Title
`feat(api-v1): implement Notion-compatible REST API, HMAC webhooks, and database automations`

### Branch
`feature/phase-11-developer-api-automations` ➡️ `main`

### Summary of Changes
- Built `/v1/` REST API conforming to the Notion OpenAPI specification.
- Implemented endpoints for blocks (`GET`, `PATCH`, `DELETE`, `children`), pages (`POST`, `GET`, `PATCH`), databases (`POST`, `GET`, `query`), and search.
- Implemented integration token authorization (`secret_...`) with workspace capability scopes.
- Built `WebhookDispatcher` with HMAC-SHA256 cryptographic signatures and automatic retry backoff.
- Built `AutomationEngine` supporting event triggers (`page_added`, `property_edited`) and automated actions.

### Verification Evidence
- [x] REST v1 endpoint integration test suite passed (Exit 0)
- [x] Webhook HMAC signature generation tests passed (Exit 0)
- [x] Automation engine trigger/action execution tests passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
