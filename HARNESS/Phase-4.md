# Autonomous Agent Harness Prompt: Phase 4 (Database & Collection Engine)

> **File Location**: `HARNESS/Phase-4.md`  
> **Target Subsystem**: Phase 4 — Database & Collection Engine (`@votion/database-engine`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-4 Implementation & Verification Agent**.

Your objective is to independently implement, verify, and complete all 20 deliverables defined in **Phase 4** of `TODO.md`. You will create `@votion/database-engine`, which turns pages into relational rows inside schema-backed collections: 6 view projections (Table, Board, Calendar, Timeline, Gallery, List), compound filtering (`AND`/`OR` trees), multi-column sorting, the Formula 2.0 AST evaluator, and the Relation/Rollup calculation engine.

### Operational Guardrails
- **Committer Identity**: You **MUST** commit, push, and open Pull Requests with identity:
  - Name: `Nexuss-Onyx`
  - Email: `tadd4212@gmail.com`
  - Setup command: `git config user.name "Nexuss-Onyx" && git config user.email "tadd4212@gmail.com"`
- **Automatic Pull Request (Zero-Approval Required)**: When all verification checks pass and work is complete, you **MUST automatically open a Pull Request against `main`** without waiting for manual approval.
1. **Relational Integrity**: Database rows are standard `page` blocks whose `parent_id` is the `collection_id`.
2. **Formula Safety**: Formula 2.0 expressions must be parsed into an AST and evaluated in a safe sandbox with zero `eval()` or code injection vectors.
3. **Strict Verification**: No checkbox in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-4-database-collection-engine
```

### Step 1: Package Scaffolding (`packages/database-engine`)
* Create `packages/database-engine/package.json` with dependencies: `react`, `@votion/types`, `@votion/sync-client`, `@tanstack/react-virtual`, `date-fns`, `lucide-react`.

### Step 2: Schema Management & Property Registry (`src/schema/`)
* `PropertyRegistry.ts`:
  - Definition of all property types (Title, Text, Number, Select, Multi-select, Status, Date, Person, Checkbox, URL, Email, Phone, Formula, Relation, Rollup).
  - Default values, cell formatters, and validation rules.
* `SchemaManager.ts`:
  - Helper functions to generate transactions that add, rename, reorder, and delete collection properties.

### Step 3: View Projections (`src/views/`)
Implement the 6 core Notion views:
* `TableView/`:
  - Virtualized spreadsheet grid with draggable and resizable column headers.
  - In-cell editing for text, numbers, select dropdowns, and dates.
  - Calculation footer (Sum, Average, Min, Max, Count, Percent Checked).
* `BoardView/`:
  - Kanban board grouped by Status or Select columns.
  - Drag-and-drop card movement between columns (updates record property value).
  - Collapsible columns and swimlanes.
* `CalendarView/`:
  - Monthly and weekly grid layout mapping rows to calendar cells via Date property.
  - Drag-and-drop date rescheduling.
* `TimelineView/`:
  - Gantt chart timeline with duration bars (start date $\rightarrow$ end date).
  - Zoom levels (hours, days, weeks, months).
* `GalleryView/`:
  - Visual card grid displaying page cover, embedded image preview, or custom file.
* `ListView/`:
  - Minimal high-density document list with toggleable property tags.

### Step 4: Query, Filter & Sort Engine (`src/query/`)
* `FilterEvaluator.ts`:
  - Recursively evaluates nested `AND`/`OR` condition trees against record properties.
  - Type-specific operators: `equals`, `contains`, `starts_with`, `is_empty`, `greater_than`, `less_than`, `is_checked`.
* `SortEngine.ts`:
  - Multi-level ascending/descending property comparator.
* `GroupingEngine.ts`:
  - Partitions database rows into buckets by select tag, status group, or date intervals.

### Step 5: Formula 2.0 Engine (`src/formula/`)
* `Lexer.ts`: Tokenizes formula strings into tokens (`PROP`, `NUMBER`, `STRING`, `IDENTIFIER`, `OPERATOR`, `LPAREN`, `RPAREN`).
* `Parser.ts`: Recursive descent parser generating an Abstract Syntax Tree (AST).
* `Evaluator.ts`: Safely evaluates AST nodes against record properties:
  - Math: `+`, `-`, `*`, `/`, `%`, `round`, `ceil`, `floor`, `abs`, `min`, `max`.
  - Strings: `concat`, `join`, `slice`, `length`, `replace`, `test`, `match`.
  - Dates: `now`, `dateAdd`, `dateSubtract`, `dateBetween`, `formatDate`.
  - Lists: `map`, `filter`, `find`, `some`, `every`.
* `StandardLibrary.ts`: Built-in function registry.

### Step 6: Relations & Rollup Engine (`src/relation/`)
* `RelationResolver.ts`:
  - Queries target collection records referenced in a Relation property.
  - Two-way relationship synchronizer.
* `RollupEngine.ts`:
  - Resolves relation pointers, retrieves target property values, and executes aggregations (`Count all`, `Sum`, `Average`, `Percent checked`).

---

## 3. Strict Verification & Gate Checklist

Run unit and formula evaluation tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/database-engine run build` | Compiles library and view components. Exit 0. |
| **V-02** | `pnpm --filter @votion/database-engine run test:formula` | Formula AST parser and evaluator test suite passes 100% of cases. Exit 0. |
| **V-03** | `pnpm --filter @votion/database-engine run test:query` | Filter evaluator (`AND`/`OR` tree) and multi-sort tests pass. Exit 0. |
| **V-04** | `pnpm turbo run typecheck` | Whole-monorepo TypeScript check succeeds. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 4: Database & Collection Engine** | `@votion/database-engine` | ✅ Completed | 20 / 20 |
   ```
2. Check off all tasks under `## Phase 4: Database & Collection Engine`.

---

## 5. Pull Request & Delivery Report Template

```bash
# 1. Enforce author & committer identity
git config user.name "Nexuss-Onyx"
git config user.email "tadd4212@gmail.com"

# 2. Stage, commit, and push
git add .
git commit -m "feat(database-engine): implement 6 view projections, filter/sort engine, Formula 2.0 AST, and rollups"
git push -u origin feature/phase-4-database-collection-engine

# 3. Automatically open Pull Request against main (Zero manual approval required)
if command -v gh >/dev/null 2>&1; then
  gh pr create --base main --head feature/phase-4-database-collection-engine \
    --title "feat(database-engine): implement 6 view projections, filter/sort engine, Formula 2.0 AST, and rollups" \
    --body "Automated delivery report for this phase. All verification gates passed with exit code 0."
else
  curl -s -X POST \
    -H "Authorization: token ${GITHUB_TOKEN:-$GH_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/Nexuss-Onyx/Votion/pulls \
    -d '{
      "title": "feat(database-engine): implement 6 view projections, filter/sort engine, Formula 2.0 AST, and rollups",
      "head": "feature/phase-4-database-collection-engine",
      "base": "main",
      "body": "Automated delivery report for this phase. All verification gates passed with exit code 0."
    }'
fi
```

Output format:
```markdown
# 🚀 Phase 4 Delivery Report & Pull Request

### PR Title
`feat(database-engine): implement 6 view projections, filter/sort engine, Formula 2.0 AST, and rollups`

### Branch
`feature/phase-4-database-collection-engine` ➡️ `main`

### Summary of Changes
- Built `@votion/database-engine` with full collection schema management and property registry.
- Implemented 6 core database view projections: Table (virtualized grid), Board (Kanban), Calendar, Timeline (Gantt), Gallery, and List.
- Built recursive `FilterEvaluator` supporting compound `AND`/`OR` trees and multi-level `SortEngine`.
- Implemented a complete Turing-complete **Formula 2.0 Engine** (Lexer, Parser, AST Evaluator) supporting string, date, math, and list operations (`map`, `filter`).
- Implemented Relation linking and Rollup aggregation calculations.

### Verification Evidence
- [x] Formula AST evaluator test suite passed (Exit 0)
- [x] Compound filter & sort comparator tests passed (Exit 0)
- [x] View projection component rendering passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
