# @votion/database-engine

Schema-backed collections and their six projections: Table, Board, Calendar,
Timeline, Gallery and List. Rows are ordinary `page` blocks parented to a
`collection`; the engine derives read-friendly row projections, executes
compound queries, evaluates Formula 2.0 expressions and resolves relations and
rollups.

## Layers

| Layer | Entry point | Contents |
| :--- | :--- | :--- |
| Schema | `@votion/database-engine/schema` | `PropertyRegistry`, `SchemaManager`, cell formatters/validators |
| Query | `@votion/database-engine/query` | `FilterEvaluator`, `SortEngine`, `GroupingEngine`, `Aggregations`, `SubItemEngine` |
| Formula | `@votion/database-engine/formula` | Lexer, recursive-descent parser, standard library, sandboxed AST evaluator |
| Relation | `@votion/database-engine/relation` | `RelationResolver`, `RollupEngine`, computed cell values |
| Views | `@votion/database-engine/views` | The six React projections + `CollectionViewRenderer` |

## Formula 2.0

```ts
import { evaluateFormula, createFormulaContext } from '@votion/database-engine';

const context = createFormulaContext(record, collection.schema);
evaluateFormula('if(prop("Amount") > 5, concat(prop("Name"), "!"), "small")', context);
```

The engine parses to an AST and interprets it with a registered standard
library (math, strings, dates, lists). It never calls `eval`/`Function`, so
formulas are safe to evaluate from untrusted collections.

List callbacks use quoted formula fragments:

```ts
evaluateFormula('map(prop("Nums"), "current * 2")', context);
evaluateFormula('filter(prop("Nums"), "current > 2")', context);
```

## Views

```tsx
import { CollectionViewRenderer } from '@votion/database-engine';

<CollectionViewRenderer
  collectionId={collectionId}
  viewId={viewId}
  engine={{ resolver, getSchema }}
  onChangeProperty={(recordId, propertyId, value) => /* submit transaction */}
/>;
```

Every projection also accepts explicit `collection`, `view` and `records` props,
which keeps them trivial to test and to embed in custom layouts.

## Scripts

```bash
pnpm --filter @votion/database-engine run build
pnpm --filter @votion/database-engine run test
pnpm --filter @votion/database-engine run test:formula
pnpm --filter @votion/database-engine run test:query
pnpm --filter @votion/database-engine run test:views
pnpm --filter @votion/database-engine run lint
```
