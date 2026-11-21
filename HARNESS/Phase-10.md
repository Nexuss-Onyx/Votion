# Autonomous Agent Harness Prompt: Phase 10 (Web Application Shell & Workspace UX)

> **File Location**: `HARNESS/Phase-10.md`  
> **Target Subsystem**: Phase 10 — Web Application Shell & Workspace UX (`apps/web`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-10 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 16 deliverables defined in **Phase 10** of `TODO.md`. You will create the main web user interface in `apps/web` using Next.js 14+ (App Router): the collapsible sidebar with recursive page tree navigation, workspace switcher, favorites, teamspaces, trash manager, top breadcrumb bar, cover/icon customizer, share modal, live presence user avatar badges, page discussion threads, inline text comments, and notification inbox.

### Operational Guardrails
- **Committer Identity**: You **MUST** commit, push, and open Pull Requests with identity:
  - Name: `Nexuss-Onyx`
  - Email: `tadd4212@gmail.com`
  - Setup command: `git config user.name "Nexuss-Onyx" && git config user.email "tadd4212@gmail.com"`
- **Automatic Pull Request (Zero-Approval Required)**: When all verification checks pass and work is complete, you **MUST automatically open a Pull Request against `main`** without waiting for manual approval.
1. **Pixel-Perfect Aesthetic**: Adhere strictly to Notion's clean design language, subtle gray tints, icon badges, and smooth collapsible tree transitions.
2. **Instant Navigation**: Page switches must read from `@votion/sync-client` local cache immediately without full-page loading flickers.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-10-web-app-shell
```

### Step 1: Next.js App Router Setup (`apps/web`)
* Configure `apps/web/package.json` with dependencies: `next`, `react`, `react-dom`, `@votion/types`, `@votion/sync-client`, `@votion/editor`, `@votion/database-engine`, `@votion/search`, `tailwindcss`, `lucide-react`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `emoji-picker-react`.
* Configure `tailwind.config.ts` matching Notion color palette.

### Step 2: Sidebar Navigation (`src/components/sidebar/`)
* `Sidebar.tsx`: Collapsible left navigation drawer.
* `WorkspaceSwitcher.tsx`: Dropdown to switch active workspace or create new workspace.
* `PageTree.tsx`: Recursive tree component displaying nested pages with expandable chevron toggles and drag-and-drop reordering.
* `FavoritesSection.tsx`: Quick-access links to pinned pages.
* `TeamspacesSection.tsx`: Departmental groupings (General, Engineering, Design).
* `PrivateSection.tsx`: Pages visible exclusively to the current user.
* `TrashModal.tsx`: Searchable list of soft-deleted pages (`alive: false`) with single-click restore or permanent purge.

### Step 3: Top Navigation Bar & Page Header (`src/components/header/`)
* `TopBar.tsx`: Sticky navigation bar containing:
  - Interactive breadcrumb navigation path.
  - Presence avatar badges displaying live connected collaborators.
  - Share button opening the `ShareModal.tsx`.
  - Page options menu (`...` menu for Export, Full width toggle, Small text toggle, Delete).
* `PageCoverAndIcon.tsx`:
  - Hover triggers to add custom cover image (from Unsplash, upload, or URL).
  - Emoji picker button to set page icon.

### Step 4: Discussions & Inline Comments (`src/components/comments/`)
* `PageDiscussion.tsx`: Threaded comments at the top of the page.
* `InlineCommentOverlay.tsx`: Floating comment popovers anchored to highlighted text spans in rich text.
* Comment resolution, edit history, and reaction emojis.

### Step 5: Notifications & Inbox (`src/components/inbox/`)
* `NotificationInbox.tsx`: Dropdown listing `@` mentions, comment replies, and page invite alerts with unread badges.

---

## 3. Strict Verification & Gate Checklist

Run build and component tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/web run build` | Next.js production build succeeds. Exit 0. |
| **V-02** | `pnpm --filter @votion/web run test` | Component unit tests for Sidebar, PageTree, and Header pass. Exit 0. |
| **V-03** | `pnpm turbo run lint` | ESLint passes across all UI components. Exit 0. |
| **V-04** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 10: Web Application Shell** | `apps/web` | ✅ Completed | 16 / 16 |
   ```
2. Check off all tasks under `## Phase 10: Web Application Shell & Workspace UX`.

---

## 5. Pull Request & Delivery Report Template

```bash
# 1. Enforce author & committer identity
git config user.name "Nexuss-Onyx"
git config user.email "tadd4212@gmail.com"

# 2. Stage, commit, and push
git add .
git commit -m "feat(web): implement Next.js workspace shell, recursive sidebar tree, top bar, and comments"
git push -u origin feature/phase-10-web-app-shell

# 3. Automatically open Pull Request against main (Zero manual approval required)
if command -v gh >/dev/null 2>&1; then
  gh pr create --base main --head feature/phase-10-web-app-shell \
    --title "feat(web): implement Next.js workspace shell, recursive sidebar tree, top bar, and comments" \
    --body "Automated delivery report for this phase. All verification gates passed with exit code 0."
else
  curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN:-$GH_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/Nexuss-Onyx/Votion/pulls \
    -d '{
      "title": "feat(web): implement Next.js workspace shell, recursive sidebar tree, top bar, and comments",
      "head": "feature/phase-10-web-app-shell",
      "base": "main",
      "body": "Automated delivery report for this phase. All verification gates passed with exit code 0."
    }'
fi
```

Output format:
```markdown
# 🚀 Phase 10 Delivery Report & Pull Request

### PR Title
`feat(web): implement Next.js workspace shell, recursive sidebar tree, top bar, and comments`

### Branch
`feature/phase-10-web-app-shell` ➡️ `main`

### Summary of Changes
- Built `apps/web` using Next.js 14 App Router and Tailwind CSS.
- Implemented collapsible Sidebar with recursive nested page tree, favorites, teamspaces, and trash manager.
- Implemented Top Navigation Bar with interactive breadcrumbs, cover/icon customizers, and live collaborator avatars.
- Implemented Share modal for managing member roles and public web sharing links.
- Implemented threaded page discussions, text-anchored inline comments, and notification inbox.

### Verification Evidence
- [x] Next.js production build passed (Exit 0)
- [x] UI component unit & interaction tests passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
