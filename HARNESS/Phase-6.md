# Autonomous Agent Harness Prompt: Phase 6 (Real-Time Collaboration Gateway)

> **File Location**: `HARNESS/Phase-6.md`  
> **Target Subsystem**: Phase 6 — Real-Time Sync & WebSocket Collaboration Gateway (`apps/sync-worker`)  
> **Source Documents**:
> - [TODO.md](file:///home/nexuss0781/Desktop/Nex/Votion/TODO.md)
> - [Components.md](file:///home/nexuss0781/Desktop/Nex/Votion/Components.md)
> - [Architecture.md](file:///home/nexuss0781/Desktop/Nex/Votion/Architecture.md)

---

## 1. Agent Role & Mission Statement

You are the **Autonomous Votion Phase-6 Implementation & Verification Agent**.

Your objective is to independently build, verify, and complete all 9 deliverables defined in **Phase 6** of `TODO.md`. You will create `apps/sync-worker`, a high-concurrency WebSocket gateway that multiplexes persistent client connections, handles room subscriptions (`space:<space_id>`, `page:<page_id>`), bridges database mutation events from Redis Pub/Sub, and manages live presence (cursor trails, active block focus) with Redis TTL expiration.

### Operational Guardrails
1. **Low Latency**: Presence messages and delta invalidations must fan out to subscribed room clients with under 100ms latency.
2. **Ephemeral Presence**: Presence states must never touch persistent SQL databases. Store them exclusively in memory or Redis with short (10s) TTLs.
3. **Strict Verification**: No task in `TODO.md` may be marked complete without passing automated test checks with exit code `0`.

---

## 2. Step-by-Step Execution Plan

### Step 0: Git Branch Isolation
```bash
git checkout -b feature/phase-6-realtime-sync-worker
```

### Step 1: Application Setup (`apps/sync-worker`)
* Create `apps/sync-worker/package.json` with dependencies: `ws`, `ioredis` (or `@upstash/redis`), `jsonwebtoken`, `@votion/types`, `dotenv`.
* Configure `src/index.ts` initializing the WebSocket server with connection heartbeat and authentication hooks.

### Step 2: Connection & Handshake (`src/gateway/`)
* `WebSocketGateway.ts`:
  - Intercepts connection requests and extracts JWT token from query string or headers.
  - Validates JWT and attaches `user_id` and authorized `space_ids` to the socket context.
  - Sets up 30-second ping/pong heartbeat to terminate dead connections.

### Step 3: Room & Subscription Manager (`src/rooms/`)
* `SubscriptionManager.ts`:
  - Tracks rooms by key: `page:<page_id>` and `space:<space_id>`.
  - Methods:
    - `subscribe(socket, roomKey)`: Adds client to room set.
    - `unsubscribe(socket, roomKey)`: Removes client from room.
    - `broadcastToRoom(roomKey, message, excludeSocket?)`: Sends JSON envelope to active room peers.
    - `handleDisconnect(socket)`: Purges socket from all rooms automatically.

### Step 4: Redis Pub/Sub Bridge (`src/pubsub/`)
* `RedisSubscriber.ts`:
  - Connects a dedicated Redis subscriber client to pattern channel `space:*:events`.
  - On incoming message:
    1. Parse JSON payload: `{ type: 'record_updated', table, id, version, patch }`.
    2. Broadcast to all clients in room `space:<space_id>`.

### Step 5: Ephemeral Presence Hub (`src/presence/`)
* `EphemeralPresence.ts`:
  - Handles client message `{ type: 'presence', pageId, cursor: { x, y }, activeBlockId }`.
  - Writes key `presence:<page_id>:<user_id>` into Redis with 10s TTL.
  - Broadcasts presence delta to other peers currently active on `page:<page_id>`.
  - Emits peer leave notification when client disconnects.

---

## 3. Strict Verification & Gate Checklist

Run automated integration tests. All must exit with code `0`:

| Check # | Verification Command | Expected Outcome |
| :---: | :--- | :--- |
| **V-01** | `pnpm --filter @votion/sync-worker run build` | Compiles WebSocket gateway application. Exit 0. |
| **V-02** | `pnpm --filter @votion/sync-worker run test:auth` | Rejects unauthenticated connections; accepts valid JWTs. Exit 0. |
| **V-03** | `pnpm --filter @votion/sync-worker run test:pubsub` | Emitted Redis event successfully delivers delta to subscribed client socket. Exit 0. |
| **V-04** | `pnpm --filter @votion/sync-worker run test:presence` | Presence broadcast and 10s TTL cleanup verified. Exit 0. |
| **V-05** | `pnpm turbo run typecheck` | Monorepo typecheck passes with 0 errors. Exit 0. |

---

## 4. `TODO.md` Update Protocol

Once verified, update `TODO.md`:
1. Progress Dashboard:
   ```markdown
   | **Phase 6: Real-Time Gateway & Collab** | `apps/sync-worker` | ✅ Completed | 9 / 9 |
   ```
2. Check off all tasks under `## Phase 6: Real-Time Sync & WebSocket Collaboration Gateway`.

---

## 5. Pull Request & Delivery Report Template

```bash
git add .
git commit -m "feat(sync-worker): implement WebSocket realtime gateway, Redis PubSub bridge, and presence hub"
git push -u origin feature/phase-6-realtime-sync-worker
```

Output format:
```markdown
# 🚀 Phase 6 Delivery Report & Pull Request

### PR Title
`feat(sync-worker): implement WebSocket realtime gateway, Redis PubSub bridge, and presence hub`

### Branch
`feature/phase-6-realtime-sync-worker` ➡️ `main`

### Summary of Changes
- Built `apps/sync-worker` providing a dedicated WebSocket gateway.
- Implemented JWT authentication handshake on socket connection.
- Implemented `SubscriptionManager` supporting space and page level rooms.
- Built `RedisSubscriber` relaying backend transaction invalidations to active clients.
- Built ephemeral presence engine broadcasting cursor coordinates and active block focus with 10s Redis TTL expiration.

### Verification Evidence
- [x] Socket authentication & heartbeat tests passed (Exit 0)
- [x] Redis Pub/Sub message relay tests passed (Exit 0)
- [x] Ephemeral presence broadcast & timeout tests passed (Exit 0)
- [x] Monorepo typecheck passed with 0 errors (Exit 0)
```
