# Autonomous Agent Harness Prompt: Phase 3 (Block Editor & Canvas Engine)

> **File Location**: `HARNESS/Phase-3.md`  
> **Target Subsystem**: Phase 3 — Block Editor & Canvas Engine (`@votion/editor`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-3 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 22 deliverables defined in **Phase 3** of `TODO.md`. You will create `@votion/editor`, which provides the core block-based document editing experience: the recursive `BlockCanvas`, block wrappers with 6-dot drag handles, multi-column layouts, 15+ block renderers, rich text formatting, the `/` slash menu, markdown auto-format triggers, and multi-block lasso selection.

### Operational Guardrails
1. **Block Purity**: Every element on the canvas must be represented as a pure Block record linked to `@votion/sync-client`.
2. **Aesthetic & Precision**: Replicate Notion's minimalist aesthetic, typography, and drag handle interactions.
3. **Strict Verification**: No checkbox in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-3-block-editor-canvas
```

### Step 1: Package Scaffolding (`packages/editor`)
* Create `packages/editor/package.json` with dependencies: `react`, `react-dom`, `@votion/types`, `@votion/sync-client`, `lucide-react`, `katex`, `prismjs` (or `shiki`), and `@radix-ui/react-popover`.
* Configure Tailwind CSS and PostCSS support.

### Step 2: Canvas & Wrapper Components (`src/components/`)
* `BlockCanvas.tsx`:
  - Takes `rootBlockId: UUID`.
  - Reads `content: UUID[]` from `@votion/sync-client` store.
  - Maps child IDs to `BlockWrapper` and block-type renderers recursively.
* `BlockWrapper.tsx`:
  - Renders floating 6-dot drag handle on hover.
  - Provides quick `+` button to open slash menu.
  - Right-click context menu (Delete, Duplicate, Copy Link, Turn Into).
* `ColumnLayout.tsx`:
  - Renders `column_list` and child `column` blocks.
  - Interactive percentage-based drag resize divider.

### Step 3: Block Component Library (`src/blocks/`)
Implement individual block components:
* `TextBlock.tsx`: Contenteditable paragraph with rich-text modifier support.
* `HeadingBlock.tsx`: H1, H2, H3 with optional toggle folding button.
* `TodoBlock.tsx`: Checkbox toggle updating `properties.checked` with strikethrough transition.
* `ListBlock.tsx`: `bulleted_list_item` and auto-incrementing `numbered_list_item`.
* `ToggleBlock.tsx`: Collapsible chevron revealing nested child block canvas.
* `QuoteBlock.tsx`: Stylized quote with left border bar.
* `CalloutBlock.tsx`: Background tint with emoji icon selector.
* `DividerBlock.tsx`: Minimal `<hr />`.
* `CodeBlock.tsx`: Multi-language code editor with syntax highlighting, language selector, and copy button.
* `MathBlock.tsx`: KaTeX LaTeX block formula renderer with editable formula modal.
* `MediaBlock.tsx`: Image, Video, Audio, File upload blocks with resize handles.
* `BookmarkBlock.tsx`: Card rendering OpenGraph metadata.
* `SyncedBlock.tsx`: Renders child blocks of a referenced master block ID.

### Step 4: Rich Text & Floating Toolbar (`src/richtext/`)
* `RichTextRenderer.tsx`: Renders `[string, TextModifier[]][]` tuples.
* `FloatingToolbar.tsx`: Selection-triggered bubble menu for Bold, Italic, Strikethrough, Underline, Code, Color, Link, and KaTeX.

### Step 5: Menus, Shortcuts & Drag-and-Drop (`src/shortcuts/`, `src/dnd/`)
* `SlashMenu.tsx`:
  - Triggered by typing `/`.
  - Filterable catalog of blocks with keyboard navigation (Up, Down, Enter, Escape).
* `MarkdownShortcuts.ts`:
  - Automatically transforms blocks upon typing: `# `, `## `, `### `, `- `, `1. `, `[] `, `>`, `---`, ` ``` `.
* `DragManager.ts`:
  - Calculates relative drop zones (above, below, left-column, right-column).
  - Emits `listAfter`, `listBefore`, or `set` (column conversion) operations.
* `MultiBlockSelection.ts`:
  - Shift + Click or mouse drag lasso selection across multiple blocks.
  - Bulk actions: indent (`Tab`), outdent (`Shift+Tab`), bulk delete (`Backspace`).

---

## 3. Strict Verification & Gate Checklist

Run unit and component tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/editor run build` | Compiles React components and styles. Exit 0. |
| **V-02** | `pnpm --filter @votion/editor run test` | Component unit tests (BlockCanvas, RichText, Shortcuts) pass. Exit 0. |
| **V-03** | Markdown shortcut parser test | Verifies `# ` converts to H1 and `[] ` converts to ToDo. Exit 0. |
| **V-04** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 3: Block Editor & Canvas** | `@votion/editor` | ✅ Completed | 22 / 22 |
   ```
2. Check off all tasks under `## Phase 3: Block Editor & Canvas Engine`.

---

## 5. Pull Request & Delivery Report Template

```bash
git add .
git commit -m "feat(editor): implement recursive block canvas, slash menu, drag-and-drop, and 15+ block types"
git push -u origin feature/phase-3-block-editor-canvas
```

Output format:
```markdown
# 🚀 Phase 3 Delivery Report & Pull Request

### PR Title
`feat(editor): implement recursive block canvas, slash menu, drag-and-drop, and 15+ block types`

### Branch
`feature/phase-3-block-editor-canvas` ➡️ `main`

### Summary of Changes
- Built `@votion/editor` with recursive `BlockCanvas` and multi-column layout engine.
- Implemented 15+ Notion block types (Text, Headings with fold, Todo, Lists, Toggle, Quote, Callout, Code, KaTeX, Media, Bookmark, Synced Block).
- Implemented `/` Slash Menu with dynamic fuzzy search and keyboard controls.
- Implemented inline markdown auto-conversions and floating bubble formatting toolbar.
- Implemented 6-dot drag handles, relative drop zone calculations, and multi-block lasso selection.

### Verification Evidence
- [x] Component rendering & interaction unit tests passed (Exit 0)
- [x] Markdown conversion parser tests passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
