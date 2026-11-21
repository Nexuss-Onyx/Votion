# `@votion/types`

Canonical TypeScript contracts shared by every Votion app and package. No
runtime dependency, no `any`: all payloads are structurally typed so records can
cross the HTTP/WebSocket boundary as plain JSON.

| Module | Contracts |
| :-- | :-- |
| `common.ts` | `UUID`, `Timestamp`, `JsonValue`, `AuditedRecord`, `ParentTable`, `RecordTable`, `DeepPartial` |
| `rich-text.ts` | `RichText`, `RichTextSegment`, `TextModifier` (`b`, `i`, `s`, `_`, `c`, `h`, `a`, `e`, `u`, `p`, `d`) + guards |
| `block.ts` | `BlockType` (27 types), `Block`, `BlockProperties`, `BlockFormat` |
| `collection.ts` | `PropertyType` (21 types), `CollectionProperty`, `CollectionSchema`, `Collection` |
| `collection-view.ts` | `ViewType` (6 views), `CollectionViewQuery`, `CollectionViewFormat`, `CollectionView` |
| `transaction.ts` | `OperationCommand`, `Operation` variants, `OperationPointer`, `Transaction`, `saveTransactions` envelopes |
| `websocket.ts` | `subscribe`, `presence`, `record_updated` (plus ack/error/heartbeat) envelopes |
| `permissions.ts` | `WorkspaceRole`, `PermissionRole`, `PrincipalType`, `Permission`, role ranking |

## Usage

```ts
import type { Block, RichText, Transaction } from '@votion/types';

const title: RichText = [['Bold', [['b']]], [' and ', [['i']]]];
```

`Block['properties']` exposes strongly-typed hot keys (`title`, `checked`,
`language`, `source`, `caption`, ...) plus an `unknown` catch-all so
type-specific JSONB payloads stay addressable without widening to `any`.

## Verification

```bash
pnpm --filter @votion/types run build   # emits dist/index.d.ts
pnpm --filter @votion/types run test    # tsc type assertions + vitest runtime checks
```
