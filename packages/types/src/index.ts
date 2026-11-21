/**
 * `@votion/types` — canonical Votion data contracts.
 *
 * Shared by every app and package: the editor canvas, database engine, sync
 * client, backend transaction server, real-time gateway, ACL graph and workers.
 */

/** Version of the shared type contract surface. */
export const VOTION_TYPES_VERSION = '0.1.0';

export * from './common.js';
export * from './rich-text.js';
export * from './block.js';
export * from './collection.js';
export * from './collection-view.js';
export * from './transaction.js';
export * from './websocket.js';
export * from './permissions.js';
