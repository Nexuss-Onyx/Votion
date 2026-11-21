/**
 * Votion backend server entrypoint (Phase 0 scaffold).
 *
 * The full Fastify API & transaction server is introduced in Phase 5. This
 * stub validates workspace pipeline integrity (build, lint, typecheck).
 */

/** Backend service identifier. */
export const SERVER_NAME = 'votion-server';

/** Backend service version. */
export const SERVER_VERSION = '0.1.0';

/** Returns the service identifier used by health checks. */
export function getServerId(): string {
  return `${SERVER_NAME}@${SERVER_VERSION}`;
}
