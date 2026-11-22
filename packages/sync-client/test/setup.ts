/**
 * Vitest global setup.
 *
 * Installs an in-memory IndexedDB (`fake-indexeddb`) so the Dexie persistence and
 * outbox layers are exercised exactly as they are in the browser — including real
 * IndexedDB transactions, key ordering and structured cloning. Nothing here mocks
 * Dexie itself; only the storage engine underneath it is virtualised.
 */

import 'fake-indexeddb/auto';

// `fake-indexeddb/auto` installs `indexedDB` and `IDBKeyRange` on globalThis.
// Dexie reads them lazily on first use, so import order is what matters.
