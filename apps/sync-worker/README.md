# @votion/sync-worker

Real-time collaboration gateway for Votion. A high-concurrency WebSocket server
that multiplexes persistent client connections, joins them to
`space:<space_id>` / `page:<page_id>` rooms, relays Redis pub/sub mutation
events to subscribed clients and fans out ephemeral presence (cursor trails
and focused blocks) backed by Redis with a 10-second TTL.

## Layout

```
src/
├── index.ts                        # Entrypoint: builds clients, wires subsystems
├── config.ts                       # Environment loading (dotenv)
├── redis.ts                        # Structural Redis client contracts
├── envelope.ts                     # Envelope send/error helpers
├── socket.ts                       # SocketContext + SyncWebSocket typing
├── gateway/
│   └── WebSocketGateway.ts         # Handshake (JWT), heartbeat, message router
├── rooms/
│   └── SubscriptionManager.ts      # Room membership + broadcast fan-out
├── pubsub/
│   └── RedisSubscriber.ts          # `space:*:events` pattern -> space rooms
└── presence/
    └── EphemeralPresence.ts        # Cursor/focus presence, 10s Redis TTL
test/                               # vitest integration tests (ioredis-mock)
```

## Handshake

Clients connect with a JWT presented either as a query parameter
(`?token=<jwt>`) or as an `Authorization: Bearer <jwt>` header. The token is
verified before the WebSocket upgrade completes; failures receive HTTP 401.
Recognized claims:

| Claim                          | Meaning                                        |
| ------------------------------ | ---------------------------------------------- |
| `sub` (or `userId`)            | Authenticated user id, attached to the socket  |
| `spaceIds` (or `space_ids`)    | Allow-list of subscribable spaces (optional)   |

After connecting, a 30-second server-side ping/pong heartbeat terminates
sockets whose pongs stop arriving.

Presence and mutation frames from a client are only trusted for its own
identity: the server always overwrites `userId` with the JWT subject.

## Rooms & subscriptions

Clients send:

```json
{ "action": "subscribe", "subscriptions": [{ "table": "space", "id": "<space_id>" }] }
```

`table: "space"` joins `space:<space_id>`; any other table joins
`page:<id>` (pages are blocks). The server acks with a
`{ "type": "subscribed", ... }` envelope. If the token carries a `spaceIds`
allow-list, space subscriptions outside of it are refused with a
`forbidden_space` error envelope.

On disconnect every room membership is purged automatically.

## Redis pub/sub bridge

The API/transaction server publishes mutation events to
`space:<space_id>:events`:

```json
{ "type": "record_updated", "table": "block", "id": "...", "version": 43, "patch": { ... } }
```

The worker subscribes to the pattern `space:*:events` on a dedicated
connection and relays well-formed events as `record_updated` envelopes to the
matching `space:<space_id>` room. Malformed frames are dropped and logged.

## Presence

Clients stream:

```json
{ "type": "presence", "pageId": "<page_id>", "cursor": { "x": 320, "y": 485 }, "activeBlockId": "<block_id>" }
```

The worker writes `presence:<page_id>:<user_id>` in Redis with a 10s TTL and
broadcasts the frame (with `action: "join" | "move"` and the server-merged
`userId`) to other peers in `page:<page_id>`. Peers join the room either by
subscribing to the page or by sending their own presence frame. Disconnecting
peers emit `action: "leave"` and their Redis key is deleted.

Presence never touches persistent SQL.

## Environment

| Variable                  | Default                            | Purpose                        |
| ------------------------- | ---------------------------------- | ------------------------------ |
| `SYNC_WORKER_PORT`        | `8080`                             | WebSocket listen port          |
| `SYNC_WORKER_HOST`        | `0.0.0.0`                          | WebSocket listen host          |
| `REDIS_URL`               | `redis://127.0.0.1:6379`           | Redis (pub/sub, presence)      |
| `WS_JWT_SECRET`           | dev fallback (see `config.ts`)     | JWT verification secret        |
| `WS_HEARTBEAT_INTERVAL_MS`| `30000`                            | Ping interval                  |
| `PRESENCE_TTL_SECONDS`    | `10`                               | TTL for presence keys          |

## Scripts

| Command               | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `pnpm build`          | Compile to `dist/`                               |
| `pnpm start`          | Run the compiled worker                          |
| `pnpm test`           | Run all integration tests                        |
| `pnpm test:auth`      | Handshake/JWT tests (V-02)                       |
| `pnpm test:pubsub`    | Redis pub/sub bridge tests (V-03)                |
| `pnpm test:presence`  | Presence relay & TTL tests (V-04)                |
| `pnpm typecheck`      | Typecheck src + tests                            |

Tests run the gateway in-process on an ephemeral port with `ioredis-mock`
injected in place of Redis; no external services are required.
