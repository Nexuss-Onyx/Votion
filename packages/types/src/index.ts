/**
 * Votion core type contract stubs (Phase 0 scaffold).
 *
 * The canonical Rich Text / Block / Collection / Transaction contracts are
 * introduced in Phase 1. These stubs exist to validate monorepo pipeline
 * integrity (build, lint, typecheck) across the workspace.
 */

/** Version of the shared type contract surface. */
export const VOTION_TYPES_VERSION = '0.1.0';

/** Canonical unique identifier used across all Votion records. */
export type UUID = string;

/** Shared lifecycle flag for soft-deletable records. */
export interface AliveRecord {
  alive: boolean;
}

/** Base record shape shared by every persisted Votion entity. */
export interface VotionRecord extends AliveRecord {
  id: UUID;
}

export {};
