/**
 * `@votion/database-engine` — schema-backed collections and their projections.
 *
 * Public surface:
 *  - `types`     database row projections and property-value helpers
 *  - `schema`    property registry + schema manager (pure transforms & transactions)
 *  - `query`     recursive filter evaluator, multi-sort, grouping, aggregations, sub-items
 *  - `formula`   Formula 2.0 lexer, parser, standard library and sandboxed evaluator
 *  - `relation`  relation resolution, two-way sync and rollup aggregations
 *  - `views`     Table, Board, Calendar, Timeline, Gallery and List projections
 */

/** Version of the database-engine contract surface. */
export const VOTION_DATABASE_ENGINE_VERSION = '0.1.0';

export * from './types.js';
export * from './schema/index.js';
export * from './query/index.js';
export * from './formula/index.js';
export * from './relation/index.js';
export * from './views/index.js';
