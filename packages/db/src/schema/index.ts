/**
 * Aggregated Drizzle schema surface.
 *
 * `drizzle.config.ts` points here so every table, enum and relation is visible
 * to `drizzle-kit generate/check/push` in a single module graph.
 */

export * from './enums.js';
export * from './workspaces.js';
export * from './users.js';
export * from './blocks.js';
export * from './collections.js';
export * from './permissions.js';
export * from './transactions.js';
export * from './relations.js';
